# Jira tickets for Patrick: EXP Programme Dashboard (DATA-894)

> **Project:** DATA · **Type:** Sub-task of DATA-894 (epic DATA-888) · **Assignee:** Patrick ·
> **Labels:** security, security-review, exp-dashboard. Finding IDs (EXPSEC-D##, B##) refer to
> `docs/security/FINDINGS_TRACKER.md`. The Toolkit's equivalents are DATA-1049 to DATA-1059.

**Order:** DB-1 and DB-2 run **before** the PR is merged. Then merge, then DB-3, then DB-4.
DB-5 to DB-11 are independent.

**Why that order.** Merging deploys straight to production:
- The shared-password login disappears.
- Everyone is signed out once.
- Field officers on personal (Gmail) addresses, who used the shared password, can't get in until
  guest sign-in works. That needs DB-1 to DB-3.

**Shell needs:** `kubectl` (DOKS context, namespace `data-ingestion`), `gcloud` + `bq` (project
`educate-data-warehouse-test`), `gh`. Run the commands from the root of the EXP-Dashboard repo.

---

## DB-1: Create the access-event table `bronze_exp.raw_exp_dashboard_access_events`

**Priority:** High · **Due:** 2026-11-18 · **Blocks:** DB-3 · **Findings:** D01, D03

This table holds guest approvals, the whitelist and every sign-in session, as an append-only event
log. The app replays it at start-up, so **do not set a partition expiration**. Until the table
exists, guest access fails closed and staff sessions live only in memory (everyone is signed out
whenever the pod restarts).

```bash
bq query --use_legacy_sql=false --project_id=educate-data-warehouse-test < sql/raw_exp_dashboard_access_events.sql
bq show --format=prettyjson educate-data-warehouse-test:bronze_exp.raw_exp_dashboard_access_events | head -40
```

**Done when**
- [ ] The table exists, partitioned by `DATE(event_timestamp)`, with no expiration.
- [ ] `exp-dashboard-srvc-acc` can insert into it and read from it (same rights as the other five app tables in `bronze_exp`).

---

## DB-2: Email relay + `SESSION_SECRET` in `exp-dashboard-credentials`

**Priority:** High · **Due:** 2026-11-18 · **Blocks:** DB-3 · **Findings:** D01, D07

Sender: e.g. `no-reply@experienceeducate.org`, via the Workspace SMTP relay or an **app password**
for that account. Never use a person's own password. The same relay as the Toolkit (DATA-1050) is
fine. The pod loads this Secret with `envFrom`, so the new keys become environment variables.

```bash
NS=data-ingestion
read -rp  'SMTP host [smtp.gmail.com]: ' SMTP_HOST; SMTP_HOST=${SMTP_HOST:-smtp.gmail.com}
read -rp  'SMTP username: ' SMTP_USERNAME
read -rsp 'SMTP app password: ' SMTP_PASSWORD; echo
read -rp  'From (e.g. EXP Programme Dashboard <no-reply@experienceeducate.org>): ' SMTP_FROM

kubectl -n $NS patch secret exp-dashboard-credentials --type merge -p "$(cat <<EOF
{"stringData":{"SESSION_SECRET":"$(openssl rand -hex 32)","MAIL_BACKEND":"smtp",
"SMTP_HOST":"$SMTP_HOST","SMTP_PORT":"587","SMTP_USERNAME":"$SMTP_USERNAME",
"SMTP_PASSWORD":"$SMTP_PASSWORD","SMTP_FROM":"$SMTP_FROM"}}
EOF
)"
unset SMTP_PASSWORD

# keys only, no values
kubectl -n $NS get secret exp-dashboard-credentials -o jsonpath='{.data}' | tr ',' '\n' | cut -d: -f1
```
The running (old) code ignores these keys, so this step is safe before the merge.

**Done when**
- [ ] `SESSION_SECRET`, `MAIL_BACKEND`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD` and `SMTP_FROM` are in the Secret.

---

## DB-3: Apply the hardened Dashboard manifests (right after the merge)

**Priority:** High · **Due:** 2026-11-18 · **Blocked by:** DB-1, DB-2 · **Finding:** D08

What changes:
- **API Deployment:**
  - runs as non-root UID 10001, with `seccomp` RuntimeDefault, all capabilities dropped, no privilege escalation and a read-only root filesystem (plus a `/tmp` emptyDir);
  - `automountServiceAccountToken: false`;
  - new session env vars.
- **App Deployment:** `automountServiceAccountToken: false`.
- **New NetworkPolicy:** only the ingress controller can reach the API pod.
- **The new image** trusts `X-Forwarded-*` only from private (RFC 1918) addresses.

**1. Pre-checks**
```bash
# a) Ingress controller namespace label. k8s/backend/networkpolicy.yaml expects
#    kubernetes.io/metadata.name=ingress-nginx. If it differs, edit the file first.
kubectl get ns --show-labels | grep -i ingress

# b) Ingress pods MUST have private IPs (10.x / 172.16-31.x / 192.168.x). Google sign-in builds its
#    https:// redirect_uri from X-Forwarded-Proto, which the new image trusts only from those ranges.
kubectl get pods -A -o wide | grep -i ingress
```
If (b) shows a public IP, **stop and tell Lerroy before merging**. Google sign-in would fail with
`redirect_uri_mismatch`.

**2. Apply, keeping the live images.** A plain `kubectl apply` would reset the image to `:latest`.
```bash
NS=data-ingestion
apply_keep_image () {   # $1 = deployment name, $2 = manifest path
  IMG=$(kubectl -n $NS get deploy "$1" -o jsonpath='{.spec.template.spec.containers[0].image}')
  sed "s#^\(\s*image:\s*\).*#\1$IMG#" "$2" | kubectl apply -f -
  kubectl -n $NS rollout status deploy/"$1"
}

kubectl apply -f k8s/backend/networkpolicy.yaml
apply_keep_image exp-dashboard-server k8s/backend/deployment.yaml
apply_keep_image exp-dashboard-app    k8s/frontend/deployment.yaml
```

**3. Smoke test**
```bash
curl -s -o /dev/null -w '%{http_code}\n' https://exp-dashboard-api.educateapps.work/health                                      # 200
curl -s -o /dev/null -w '%{http_code}\n' https://exp-dashboard-api.educateapps.work/docs                                        # 404
curl -s -o /dev/null -w '%{http_code}\n' -H 'X-Exp-Client: dashboard-v1' https://exp-dashboard-api.educateapps.work/api/auth/me  # 403/401, never 200
curl -s -H 'X-Exp-Client: dashboard-v1' https://exp-dashboard-api.educateapps.work/api/auth/config                              # guest_sign_in_available: true
kubectl -n data-ingestion logs deploy/exp-dashboard-server --tail=50   # no errors; no tokens or links
```
Then sign in at https://exp-dashboard.educateapps.work with Google. An access manager (Afra,
Charlotte or John Bosco) opens **Admin → 🔑 Guest access**, which must say guest sign-in is available.

Rollback: `kubectl -n data-ingestion delete networkpolicy exp-dashboard-server`, and/or re-apply the
previous manifests from git history.

**Done when**
- [ ] The pre-checks pass and the pods are Running as non-root.
- [ ] Google sign-in works, and the guest panel says sign-in is available.
- [ ] A test guest was invited and signed in with the emailed link.

---

## DB-4: Delete the old shared `DASHBOARD_PASSWORD` (after the merge)

**Priority:** High · **Due:** 2026-11-18 · **Blocked by:** DB-3 · **Finding:** D01

⚠️ **Only after the PR is merged and deployed.** The old code refuses to start without
`DASHBOARD_PASSWORD`, so deleting it earlier crash-loops the pod.

```bash
NS=data-ingestion
kubectl -n $NS patch secret exp-dashboard-credentials --type json -p '[{"op":"remove","path":"/data/DASHBOARD_PASSWORD"}]'
kubectl -n $NS rollout restart deploy/exp-dashboard-server && kubectl -n $NS rollout status deploy/exp-dashboard-server
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'X-Exp-Client: dashboard-v1' -H 'Content-Type: application/json' \
  -d '{"email":"x@experienceeducate.org","password":"x"}' https://exp-dashboard-api.educateapps.work/api/auth/login   # 404 or 405
```

**Done when**
- [ ] The key is gone, the pod restarts cleanly, and `/api/auth/login` returns 404 or 405.

---

## DB-5: Read-only BigQuery identity for E!nsight

**Priority:** Medium · **Due:** 2027-01-03 · **Finding:** D11

Today E!nsight's generated SQL runs as the dashboard's main identity, which can write the app tables.
Give it a read-only one.

```bash
P=educate-data-warehouse-test
SA=exp-ensight-ro@$P.iam.gserviceaccount.com
gcloud iam service-accounts create exp-ensight-ro --project $P --display-name "EXP Dashboard E!nsight (read-only)"
gcloud projects add-iam-policy-binding $P --member "serviceAccount:$SA" --role roles/bigquery.jobUser --condition=None
bq query --use_legacy_sql=false --project_id=$P "GRANT \`roles/bigquery.dataViewer\` ON SCHEMA \`$P.gold_exp\` TO 'serviceAccount:$SA'"
bq query --use_legacy_sql=false --project_id=$P "GRANT \`roles/bigquery.dataViewer\` ON SCHEMA \`$P.silver_exp\` TO 'serviceAccount:$SA'"
# bronze_exp: grant per SOURCE table E!nsight needs, never the dataset. The app's raw_* tables
# (including the access-event log) must stay out of reach:
#   bq query --use_legacy_sql=false --project_id=$P "GRANT \`roles/bigquery.dataViewer\` ON TABLE \`$P.bronze_exp.<table>\` TO 'serviceAccount:$SA'"

umask 077
gcloud iam service-accounts keys create /tmp/ensight-key.json --iam-account "$SA"
kubectl -n data-ingestion create secret generic exp-dashboard-ensight-key --from-file=key.json=/tmp/ensight-key.json
shred -u /tmp/ensight-key.json 2>/dev/null || rm -P /tmp/ensight-key.json
```
Then Lerroy uncomments the three `ENSIGHT` / `gcp-ensight-key` blocks in
`k8s/backend/deployment.yaml` in a small PR. Apply it with `apply_keep_image` (DB-3).

**Done when**
- [ ] E!nsight answers questions, and `bq ls -j -a --max_results=5` shows its jobs running as `exp-ensight-ro`.

---

## DB-6: Inventory and rotate the Dashboard's credentials, 90-day cadence

**Priority:** High · **Due:** 2026-11-18, **or** approve an exception (proposed deadline 2026-12-04) · **Finding:** B04 (Dashboard part)

```bash
P=educate-data-warehouse-test
SA=exp-dashboard-srvc-acc@$P.iam.gserviceaccount.com
gcloud iam service-accounts keys list --iam-account "$SA" --managed-by=user --format='table(name.basename(),validAfterTime)'

# rotate the BigQuery key
umask 077
gcloud iam service-accounts keys create /tmp/dash-key.json --iam-account "$SA"
kubectl -n data-ingestion create secret generic exp-dashboard-gcp-key --from-file=key.json=/tmp/dash-key.json --dry-run=client -o yaml | kubectl apply -f -
kubectl -n data-ingestion rollout restart deploy/exp-dashboard-server && kubectl -n data-ingestion rollout status deploy/exp-dashboard-server
shred -u /tmp/dash-key.json 2>/dev/null || rm -P /tmp/dash-key.json
gcloud iam service-accounts keys delete <OLD_KEY_ID> --iam-account "$SA"
```
Also rotate:
- the Google OAuth client secret (`GOOGLE_CLIENT_SECRET`);
- the OpenRouter API key (`OPENROUTER_API_KEY`), and set a spend cap in OpenRouter;
- `JWT_SECRET` (this signs everyone out, so do it out of hours): `kubectl -n data-ingestion patch secret exp-dashboard-credentials --type merge -p "{\"stringData\":{\"JWT_SECRET\":\"$(openssl rand -hex 32)\"}}"`;
- the Docker Hub token used by the deploy workflow (GitHub repo → Settings → Secrets and variables → Actions).

Record the dates in `docs/security/SECRETS_RUNBOOK.md` §7, and set a 90-day reminder.

**Done when**
- [ ] The keys are rotated, the old keys are deleted and the cadence is set. **Or:** the exception is approved (B04).

---

## DB-7: Public exposure review: dashboard hosts + legacy Apps Script / GitHub Pages

**Priority:** Medium · **Due:** 2027-01-03 · **Findings:** D16, D14

```bash
for h in exp-dashboard.educateapps.work exp-dashboard-api.educateapps.work; do echo "== $h"; dig +short "$h"; done
doctl compute load-balancer list --format Name,IP,Status,ForwardingRules
doctl compute firewall list
kubectl get svc -A | grep -i -E 'LoadBalancer|NodePort'
kubectl -n data-ingestion get ingress
# from OUTSIDE the cluster/VPC:
nmap -Pn -sT --top-ports 1000 exp-dashboard.educateapps.work exp-dashboard-api.educateapps.work
gh api repos/experienceeducate/EXP-Dashboard/pages 2>&1 | head -5     # 404 = no Pages site
```
Expected: only ports 80 and 443 on the ingress load balancer, and no NodePort open to the internet.

**Legacy (D14).** `legacy/dashboard-v1.html` calls a public Google Apps Script web app. Open that
Apps Script project, go to **Deploy → Manage deployments**, and set "Who has access" to *Anyone
within Educate!*, or archive the deployment if nothing uses it. If a GitHub Pages site still exists,
unpublish it.

**Done when**
- [ ] The scan output is attached. Each public endpoint is listed with its auth.
- [ ] The Apps Script deployment is restricted or archived. Pages is off.

---

## DB-8: Enforce 2-Step Verification for Dashboard admins and access managers

**Priority:** High · **Due:** 2026-11-18 · **Finding:** B01

The admins (Afra, Charlotte, John Bosco, Evelyne) and access managers (Afra, Charlotte, John Bosco)
approve guests and change who sees what, so their accounts need MFA. The list is
`ACCESS_CONFIG["admin"]` / `["access_managers"]` in `backend/app/core/access.py`, or
`ACCESS_CONFIG_PATH` if that is set in the cluster.

In the Admin console, go to **Security → Authentication → 2-step verification** and turn on
**Enforce** for the OU or group that holds those accounts. One shared group for the Toolkit admins
(DATA-1056) and these accounts is fine.

**Done when**
- [ ] 2SV is enforced for every Dashboard admin and access manager. Screenshot attached.

---

## DB-9: GitHub push protection + branch protection on EXP-Dashboard

**Priority:** Low · **Due:** 2027-02-02 · **Finding:** B03

```bash
R=experienceeducate/EXP-Dashboard
gh api -X PATCH "repos/$R" \
  -f 'security_and_analysis[secret_scanning][status]=enabled' \
  -f 'security_and_analysis[secret_scanning_push_protection][status]=enabled'
gh api "repos/$R" --jq '.security_and_analysis'
```
Branch protection on `main` (Settings → Branches): require a PR, require the status checks
**`gitleaks`** (secret-scan workflow) and **`backend-tests`** (deploy workflow), and block force-pushes.

**Done when**
- [ ] Push protection is on, and `main` is protected with both checks required.

---

## DB-10: Alert on Dashboard sign-in failures

**Priority:** Medium · **Due:** 2027-01-03 · **Finding:** B02 · **Needs:** DB-1 and the merge

Every `auth_failed` event goes to `bronze_exp.raw_exp_dashboard_access_events` and to the `audit`
logger. Examples: a Google OAuth failure, a wrong domain, no access, or an invalid link. Set up
one of these:
- a log-based alert on `exp-dashboard-server` logs for `auth_failed`, plus HTTP 429 on `/api/auth/*`, at about 30 in 10 minutes;
- an hourly BigQuery scheduled query that alerts above a threshold:
  ```sql
  SELECT COUNT(*) AS failures
  FROM `educate-data-warehouse-test.bronze_exp.raw_exp_dashboard_access_events`
  WHERE event_type = 'auth_failed' AND event_timestamp > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 HOUR)
  ```
It can share the channel and the setup with the Toolkit alert (DATA-1058).

**Done when**
- [ ] The alert fires into the data-team channel (tested once).

---

## DB-11: Decisions for the Dashboard review

**Priority:** High · **Due:** 2026-11-11

- [ ] Severity targets (Critical 7 days, High 14, Medium 60, Low 90): same as the Toolkit, one decision.
- [ ] Approve or reject the **B04** exception (DB-6), with a deadline.
- [ ] Rate limits on sign-in endpoints are the same as the Toolkit: 10 per minute and 40 per hour per IP, and 3 links per 15 minutes per email.
- [ ] Confirm the new **"National view only"** rule. Colleagues on the domain who are not on any national, regional or CU list now see national aggregates only: no per-mentor scores, verbatim comments, school lists or task updates (EXPSEC-D02). Anyone who needs detail must be added to a list.

**DATA-894 is done when:** DB-1 to DB-11 are closed, the tracker rows are updated, and the live
checklist in `docs/security/GUEST_ACCESS.md` §7 passes (DATA-941).
