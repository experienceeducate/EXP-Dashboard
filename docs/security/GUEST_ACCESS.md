# Guest access and sessions — EXP Programme Dashboard

This replaces the shared `DASHBOARD_PASSWORD` (security review DATA-894, plan
v1.3 §5, ADR-011). Code: `backend/app/core/guest_access.py` (the core, shared
verbatim with the EXP Training Toolkit), `app/core/access_runtime.py` (wiring),
`app/auth.py` (sign-in routes), `app/routers/guests_admin.py` (admin panel).

## 1. Who signs in how

| Who | How | Scope |
|---|---|---|
| Staff (`@experienceeducate.org`) | **Sign in with Google** | The access config (national / regional / CU / national-view-only), re-resolved on every request |
| Guests: partners, and field officers on personal addresses | **Request access**, then after approval an emailed **single-use sign-in link** | Exactly **one region or one CU**, chosen by the access manager at approval. Never national, admin or access manager |

## 2. Guest lifecycle

```
request access ──► PENDING ──approve (scope, days)──► APPROVED ─┐
  (or invite) ─────────────────────────────────────────────────┤ + on WHITELIST
                                                                ▼
                         sign-in link (15 min, single use) ──► session
                                                                │
  renew (one click, +90 days) ◄── EXPIRED (end date passed) ◄───┤
  revoke / remove from whitelist / reject ──► all sessions + links end NOW
```

- **Approval and whitelist are separate controls.** A guest needs both.
  Approving from the request list adds them to the whitelist by default. You can
  remove someone from the whitelist on its own, and that ends their sessions too.
- The **whitelist** holds exact, normalised emails (trimmed, lower-case). There
  are no domain wildcards.
- **Default access is 90 days** (1–365 allowed). The admin panel shows the end
  date and days left. **Renew** is one click.
- Every action is an audit event, and the panel's "Recent activity" list shows
  them. **No token or sign-in link is ever logged or stored.** Only SHA-256
  hashes of tokens are kept.

## 3. Sign-in links

- 32 random bytes, valid **15 minutes**, **single use**, bound to one email.
- Sent to `FRONTEND_URL/#magic=<token>`. The token sits in the URL fragment, so
  it never reaches a server log or Referer.
- The page shows a **Sign in** button. The link is redeemed only by
  `POST /api/auth/magic-link/redeem`, so email scanners that prefetch links
  cannot use it up.
- Asking for a new link **invalidates every earlier unused link** for that guest.
- `POST /api/auth/magic-link` and `POST /api/auth/request-access` always
  return the **same message**, whatever the email's state. The work happens on
  a background queue, so response time reveals nothing either.
- Rate limits: **10 requests/min and 40/hour per IP** (429), and **3 per 15
  min and 10 per day per email** (requests over the limit are silently
  dropped). The limits are in memory, for a single replica.

## 4. Sessions (staff and guests)

| Setting | Value | Env |
|---|---|---|
| Access token | 15 min JWT carrying the session id, **checked against the server session on every request** | — |
| Idle timeout | 60 min | `SESSION_IDLE_MINUTES` |
| Absolute lifetime | 8 h staff / 8 h guest. A guest session never outlives the guest's access end date | `STAFF_SESSION_HOURS`, `GUEST_SESSION_HOURS` |
| Refresh | `POST /api/auth/session/refresh` rotates the refresh token. Reusing an old one within 30 s returns 409 (a second tab); after that it **revokes the session** (theft signal) | — |
| Fixation | Every login creates a new session id | — |
| Google callback | Redirects to `#login_code=<one-time 60-s code>`, which the SPA exchanges via `POST /api/auth/session/exchange`. No token ever appears in a URL | — |
| Logout | `POST /api/auth/logout` revokes the server session | — |

Revoked or expired guests cannot refresh. Revocation takes effect on the very
next request, without waiting for the access token to expire.

## 5. Durability and failure behaviour

State is an **append-only event log** in BigQuery,
`<BQ_PROJECT_ID>.<DASHBOARD_APP_DATASET>.raw_exp_dashboard_access_events`
(DDL: `DATA_ENG_BIGQUERY_TABLES_REQUEST.md`, Table 6). The app writes it with
streaming inserts only and **never runs DML**. It replays the whole log into
memory at the first request after start-up, which is why there is a **single
replica** (as with the query cache).

| Situation | Behaviour |
|---|---|
| Log can't be read at start-up | Guests can't sign in (fail closed). Staff can sign in. The load is retried every 30 s |
| Log write fails on a **grant** (approve, invite, renew, whitelist add, link) | Not applied; the admin gets a 502 |
| Log write fails on a **removal** (revoke, reject, whitelist remove, logout) | Applied in memory immediately; the admin is told to repeat it so it survives a restart |
| Log write fails for a staff session | The session works in memory until the next restart |
| Mail not configured (`MAIL_BACKEND` unset) | Guest sign-in shows as unavailable; invites are recorded but no link is sent |

## 6. Admin guide (Admin → 🔑 Guest access)

Every admin can **view**. Only **access managers** (`access_managers` in the
access config) can **change** anything.

1. **Pending requests**: check the organisation and reason. **Approve** by
   picking one region or CU and the number of days (default 90), or **Reject**.
2. **Invite**: enter the email, scope and days. The guest is approved,
   whitelisted and emailed a link in one step.
3. **Guests**: see status, scope, end date, days left, whitelist state, last
   sign-in and live sessions. **Renew** (one click) or **Revoke** (immediate).
4. **Whitelist**: add or remove exact emails. Removing one ends that person's
   sessions.

Moving the three Gmail field officers from the static config (EXPSEC-D12):
invite each one with the CU or region they cover, confirm they can sign in, then
remove them from `ACCESS_CONFIG`.

## 7. Live verification checklist (DATA-941)

Run on production after deploy and record the results in the tracker:

- [ ] `POST /api/auth/login` returns 404/405.
- [ ] `https://exp-dashboard-api.educateapps.work/docs` returns 404.
- [ ] Staff Google sign-in works. The address bar never shows a token. `/api/auth/me` shows `authKind: staff`.
- [ ] Logout, then press Back: the dashboard asks you to sign in again.
- [ ] Request access with a test address: the generic message appears and the request shows in Admin → Guest access.
- [ ] Approve it with one CU: the emailed link opens the Sign-in page, and the guest sees only that CU.
- [ ] Open the same link again: "invalid, already used or expired".
- [ ] Request two links and use the first one: refused.
- [ ] Revoke the guest while they are signed in: their next click signs them out.
- [ ] Sign in as a colleague not on any list (national view only): there are no drill-downs, and Mentor Quality detail and task updates are refused.
- [ ] 11 quick sign-in requests from one IP: the 11th gets "Too many requests".
- [ ] The `raw_exp_dashboard_access_events` rows for the steps above contain no token or link.
