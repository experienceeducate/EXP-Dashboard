# Secrets runbook — gitleaks, leaks, rotation

Security review DATA-888 (plan v1.3 §3–4). This file is the same in the EXP
Dashboard and EXP Training Toolkit repos. The Mshauri repo was the reference
implementation, and this one is updated to the current gitleaks command.

## 1. The four gates

| Gate | File | Runs | Can be bypassed? |
|---|---|---|---|
| Git pre-commit hook | `.pre-commit-config.yaml` | every `git commit`: `gitleaks git --pre-commit --staged` | Yes (`--no-verify`), so CI is the backstop |
| Claude Code hook | `.claude/hooks/*secret-scan*.ps1` / `.sh` | every `git commit` Claude runs | Per machine (opt-in) |
| CI | `.github/workflows/secret-scan.yml` | every push to any branch, every PR, weekly; **full history** | No: required status check (B03) |
| Self-test | `scripts/gitleaks-selftest.sh` / `.ps1` | in CI, and on demand | — |

All four use the same `.gitleaks.toml`: the default rules plus four custom GCP
service-account rules (`private_key_id`, `private_key` PEM, base64 key file,
`type: service_account` next to `private_key`). Coverage is JSON, YAML, TOML,
`.env` and k8s Secret manifests.

## 2. One-time setup per developer

```bash
# gitleaks >= 8.19 (CI pins 8.30.1)
#   macOS:   brew install gitleaks
#   Windows: winget install --id Gitleaks.Gitleaks   (or: scoop install gitleaks)
#   Linux:   download from https://github.com/gitleaks/gitleaks/releases
gitleaks version

pip install pre-commit
pre-commit install            # from the repo root, in every clone
pre-commit run gitleaks       # check it fires (no output = clean)
```

Optional Claude Code hook (Mshauri style, per machine, gitignored): copy
`.claude/settings.local.example.json` to `.claude/settings.local.json`. On
macOS/Linux, change the command to the `.sh` twin as the file's comment says.

## 3. Checks to run

```bash
# Prove the custom rules still catch a GCP key in every format (keys built at runtime, deleted after)
bash scripts/gitleaks-selftest.sh                                        # macOS / Linux / Git Bash
powershell -ExecutionPolicy Bypass -File scripts\gitleaks-selftest.ps1   # Windows

# Full-history scan, the same as CI
gitleaks git . --config .gitleaks.toml --baseline-path .gitleaks-baseline.json --redact --verbose
```

### Plan §4: confirm coverage on a test branch

The plan asks for a dummy key of each type to be committed to a test branch, to
watch the gates fire. The self-test above proves the same thing without
putting key-shaped data in the remote. If you want the branch demonstration as
well:

```bash
git switch -c chore/gitleaks-coverage-check
SELFTEST_OUT=gitleaks-coverage bash scripts/gitleaks-selftest.sh   # writes JSON/YAML/TOML/.env/k8s dummies
git add -f gitleaks-coverage && git commit -m "Test gitleaks coverage"   # the pre-commit hook BLOCKS this (expected)
git commit --no-verify -m "Test gitleaks coverage"                # bypass the hook only for this test
git push -u origin chore/gitleaks-coverage-check                   # the secret-scan job FAILS (expected)
# screenshot the failed job for DATA-959 / DATA-941, then delete the branch everywhere:
git push origin --delete chore/gitleaks-coverage-check
git switch main && git branch -D chore/gitleaks-coverage-check
```

The dummy keys are random and belong to no real account, so nothing needs
rotating afterwards. Even so, never use a real key for this.

## 4. One-off history scan: inventory (plan §4)

Run on a fresh full clone of **every** repo (`git clone` without `--depth`):

```bash
gitleaks git . --config .gitleaks.toml --redact --report-format json --report-path gitleaks-history.json
```

Results at review time:

| Repo | Commits | Findings |
|---|---|---|
| EXP Dashboard | 102 | 10 → all false positives (BigQuery column names), EXPSEC-D15; 0 with the new config |
| EXP Training Toolkit | 76 | 1 → false positive (dummy `jwt_secret` in an old test, commit a733e85480), EXPSEC-T17; baselined |
| Mshauri | 0 with its config | — |

Never commit `gitleaks-history.json`. Even redacted, it lists locations.

## 5. If a real secret is found

1. **Rotate first.** Ask Patrick to revoke or rotate the credential at its
   source: the GCP key, OAuth client secret, SMTP password, OpenRouter key or
   Docker Hub token. A leaked key stays compromised after a history rewrite.
2. Update the k8s Secret with the new value and restart the pod.
3. Remove the secret from the code. Load it from env or the k8s Secret instead.
4. Clean history only after rotation, with Patrick's agreement, because it
   rewrites everyone's clones:
   `git filter-repo --replace-text <(echo '<the-secret>==>REDACTED')`, then force-push and have everyone re-clone.
5. If history is not rewritten, add the finding to `.gitleaks-baseline.json`:
   regenerate it with `--report-path .gitleaks-baseline.json` on the old
   commit range. Log it in `FINDINGS_TRACKER.md` with the rotation date.
6. **Never** put a real secret in the `[allowlist]` of `.gitleaks.toml`. The
   allowlist is only for verified false positives. The baseline is for old,
   already-rotated findings.

## 6. Baseline

`.gitleaks-baseline.json` holds known historical findings, so the build fails
only on new ones. Dashboard: `[]` (its only historical hits are false positives
covered by one narrow allowlist regex). Toolkit: one entry, the dummy test
`jwt_secret` from commit a733e85480 (EXPSEC-T17). Each entry is pinned to a commit and line, so the same string
committed again is still caught.

## 7. Service-account inventory (plan §3)

| Credential | Where it lives | Rotation |
|---|---|---|
| Dashboard BigQuery SA key (`exp-dashboard-gcp-key`) | k8s Secret | 90 days (B04) |
| Toolkit BigQuery key (`gcp-service-account-key`, dbt-srvc-acc, shared) | k8s Secret | replace with dedicated SA (T11), then 90 days |
| E!nsight read-only SA (to create) | k8s Secret `exp-dashboard-ensight-key` | 90 days (D11) |
| Google OAuth client secrets (one per app) | k8s Secrets | on staff change / yearly |
| SMTP relay credential (new) | k8s Secrets | 90 days |
| OpenRouter API key (Dashboard) | k8s Secret | 90 days + spend cap |
| `JWT_SECRET`, `SESSION_SECRET` | k8s Secrets | rotating signs everyone out; do it on suspicion |
| Docker Hub token (CI) | GitHub Actions secret | 90 days |

Prefer keyless auth (workload identity federation / secret manager) when the
cluster supports it. DOKS has no GCP workload identity today, so a file-mounted
key plus rotation is the interim.

## 8. GitHub settings (Patrick, B03)

- Settings → Code security → **Secret scanning: on**, **Push protection: on**.
- Branch protection on `main`: require the `secret-scan / gitleaks` check and
  the backend test job; no force-push.
