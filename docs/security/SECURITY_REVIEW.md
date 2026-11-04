# Security review — EXP Programme Dashboard

| | |
|---|---|
| Jira | DATA-894 (parent DATA-888) — subtasks DATA-935 review · DATA-936 triage · DATA-937 critical/high · DATA-939 remainder · DATA-941 verify |
| Plan | *EXP Security Review and Guest Access Plan* v1.3 |
| System | SPA `exp-dashboard.educateapps.work`, API `exp-dashboard-api.educateapps.work`. FastAPI (`backend/app`) + React 19 (`frontend/`), namespace `data-ingestion` |
| Reviewed | 2026-11-04, code as delivered in this release (git history: 102 commits) |
| Findings | `docs/security/FINDINGS_TRACKER.md`, shared with the Toolkit (IDs `EXPSEC-D##`, `EXPSEC-B##`) |
| Sister review | EXP Training Toolkit repo → `docs/security/SECURITY_REVIEW.md` |

## 1. Summary

The most serious problem was the **shared dashboard password**. Anyone who knew
it could sign in as **any email in the access config**, national users, admins
and access managers included (EXPSEC-D01, Critical). The "National view only"
tier, which any colleague on the domain gets automatically, could open
**every CU's schools, every mentor's scores and every verbatim observer
comment** (D02). Sessions were long-lived, non-revocable JWTs delivered in the
redirect URL (D03). E!nsight's export **trusted SQL and answers sent back by
the browser** (D04).

All of these are fixed in this release. Staff sign in with Google only. Guests
(partners, field officers on personal addresses) get individual, time-limited,
audited access to exactly one region or CU (`docs/security/GUEST_ACCESS.md`).
What remains is infrastructure: applying the manifests, a read-only E!nsight
identity, the external scan, the legacy endpoints, service-account rotation,
Workspace MFA and GitHub settings. All of it is in the Patrick Jira ticket.

## 2. OWASP Top 10 (2021) assessment

| ID | Category | Result | Evidence / findings |
|---|---|---|---|
| A01 | Broken Access Control | **Findings — fixed** (D01, D02, D05, D06); **open infra** (D14, D16) | Row-level scoping is still applied server-side on every query (`access_clause`, re-resolved per request). Person- and school-level routes now need an explicit grant (`auth.person_level_user`; tested for every route in `tests/test_sessions_and_guests.py`). Guests get exactly one known region or CU and are never national, admin or access manager, even if their address is on those lists (`test_guest_on_admin_lists_still_gets_only_their_scope`). Admin panel: every admin can view, only access managers can change. Task keys are bound to their CU. Mapping is domain-only. |
| A02 | Cryptographic Failures | **Findings — fixed** (D03, D07) · Passed | TLS via cert-manager on both hosts. No token in any URL. Refresh and link tokens are stored only as SHA-256 hashes. The OAuth state cookie has its own key (`SESSION_SECRET`), is `https_only` and `SameSite=Lax` and lasts 10 minutes. JWT is HS256 with `alg=none` rejected (`test_alg_none_token_is_refused`). E!nsight signatures are HMAC. |
| A03 | Injection | **Finding — fixed** (D04) · Passed | Dashboard queries use `core/sql.py` parameter helpers only (CLAUDE.md rule; `test_overview_query.py`). E!nsight's generated SQL goes through a GoogleSQL lexer: a single SELECT, an allowlisted dataset, no DML/DDL/scripting, a dry-run byte cap. Exports accept only server-signed SQL and answers. FastAPI typed params give 422, not 500. |
| A04 | Insecure Design | **Findings — fixed** (D01, D06) · Passed | Guest flow per plan §5. Approval and whitelist are separate. Links are single-use, last 15 minutes and are redeemed by POST from a landing page. A new link invalidates the old ones. Responses are generic, with equal timing from the background mail queue. Rate limits: 10/min and 40/h per IP (429); 3 per 15 min and 10 per day per email (silent). Grants fail closed if the log is down. |
| A05 | Security Misconfiguration | **Findings** — fixed (D09); open infra (D08, D11) | API docs off (`ENABLE_API_DOCS=false`). Client-header guard on every `/api/*`. CORS limited to the app origin. Security headers in `frontend/security-headers.conf`. Repo now has a non-root image, `--forwarded-allow-ips` limited to RFC 1918, securityContext, a read-only root FS, `automountServiceAccountToken: false` and a NetworkPolicy; these still need applying. E!nsight still runs as the main identity until the read-only SA exists (D11). |
| A06 | Vulnerable and Outdated Components | **Finding — fixed** (D13) | `dependency-audit.yml` runs pip-audit and npm audit (high+). Pinned `uvicorn`, `python:3.14-slim`. Actions are pinned to commit SHAs. |
| A07 | Identification and Authentication Failures | **Findings — fixed** (D01, D03); **open** (B01, D12) | No shared password. Staff: Google SSO, verified and restricted to `@experienceeducate.org`. Sessions: 15-min access token checked against the server session on every request, 60-min idle timeout, 8 h absolute lifetime, rotating refresh with reuse detection (409 grace for a second tab), and a new session id on every login. Workspace MFA for admins is pending (B01). The three Gmail field officers move to guest access (D12). |
| A08 | Software and Data Integrity Failures | **Findings — fixed** (D04, D10) · Passed · open (B03) | gitleaks runs in pre-commit, in the Claude hook, and in CI on every push and PR with full history, a pinned and checksum-verified binary, a baseline and a self-test. The deploy workflow pins image digests. E!nsight exports are HMAC-signed. Push protection is pending (B03). |
| A09 | Security Logging and Monitoring Failures | **Passed** · open (B02) | Every access event is appended to `raw_exp_dashboard_access_events` and the `audit` logger: requests, approvals, invites, renewals, rejections, revocations, whitelist edits, link issue/redeem/invalidate/deny, session create/refresh/revoke and `auth_failed` (OAuth failure, wrong domain, no access). Tokens and links are never logged. E!nsight has its own audit table. Alerting is pending (B02). |
| A10 | Server-Side Request Forgery | **N/A** | No user-supplied URL is ever fetched. Outbound calls go to fixed hosts only: Google OAuth, BigQuery, OpenRouter (E!nsight, fixed base URL) and SMTP. The NetworkPolicy limits egress to DNS, 443 and 587/465. No cloud-metadata path (DOKS; the GCP key is file-mounted). |

## 3. Public exposure (plan §3)

| Endpoint | Exposure | Auth | Action |
|---|---|---|---|
| `exp-dashboard.educateapps.work` | Public by design (static SPA) | none needed | — |
| `exp-dashboard-api.educateapps.work` | Public by design (the SPA calls it cross-origin) | Session on every data route + client header; sign-in endpoints rate-limited | External scan (D16) |
| `exp-dashboard-server` Service (in-cluster) | Any pod could reach it and set its own X-Forwarded-For | Session auth | NetworkPolicy + RFC 1918 proxy trust (D08) |
| Legacy Google Apps Script web app / old GitHub Pages site | Unknown | Possibly anonymous | Confirm and unpublish or restrict (D14) |

Interim control for D14 until it is confirmed: the Apps Script deployment
owner sets "Who has access" to *Anyone within Educate!*.

## 4. Shared passwords and admin accounts

- `DASHBOARD_PASSWORD` and `POST /api/auth/login` are removed (ADR-011 in
  `docs/DECISION.md`). Patrick deletes the key from `exp-dashboard-credentials`.
- Admins and access managers act only from a Google session, which is an
  individual Workspace account. A guest session can never hold either role.
  2-Step Verification is enforced in Workspace (B01).

## 5. Service accounts

| Identity | Used for | Concern | Action |
|---|---|---|---|
| `exp-dashboard-srvc-acc` (Secret `exp-dashboard-gcp-key`) | All BigQuery reads + writes to the six app tables in `bronze_exp` | Long-lived JSON key; E!nsight's LLM SQL also runs as it | Rotate, 90-day cadence (B04); separate read-only E!nsight SA (D11) |
| Google OAuth client | Staff sign-in | Secret in the k8s Secret | Rotate on staff change |
| OpenRouter API key | E!nsight | Third-party key in the k8s Secret | Rotate 90 days; spend cap at OpenRouter |
| SMTP relay credential | Guest sign-in links | New | Relay/app password only |
| Docker Hub token (CI) | Image push | Long-lived | Short-lived token, rotate (B04) |

History scan (102 commits): **no live credential has ever been committed**.
The 10 hits are BigQuery column names (D15, verified false positive).

## 6. Guest access (plan §5)

Guest access works as plan §5 specifies. The design, endpoints, admin guide and
the live verification checklist are in `docs/security/GUEST_ACCESS.md`. The
five revocation tests are in `backend/tests/test_guest_access_core.py::TestRevokeAllFor`:

| # | Requirement | Test |
|---|---|---|
| 1 | Revokes all sessions of the selected guest only | `test_1_revokes_all_sessions_of_the_selected_guest_only` |
| 2 | Invalidates refresh tokens | `test_2_invalidates_refresh_tokens` |
| 3 | Revoked sessions can't be renewed | `test_3_revoked_sessions_cannot_be_renewed` |
| 4 | Invalidates pending magic links | `test_4_invalidates_pending_magic_links` |
| 5 | Immediate, not at expiry | `test_5_takes_effect_immediately_not_at_expiry` |

HTTP-level coverage is in `tests/test_sessions_and_guests.py`: revoke and
whitelist removal end the session on the next request.

## 7. Verification at handover

- Backend: `pytest` → 338 passed.
- gitleaks 8.30.1: full history scan with the new config → 0 findings. The
  working tree is clean. `scripts/gitleaks-selftest.sh` passes all seven cases.
- Frontend: changed files parse cleanly. Run `npm run lint` and `npm run build` locally.
- Live verification (DATA-941) happens after deploy, using the checklist in
  `GUEST_ACCESS.md` §7.
