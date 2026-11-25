# Admin Console

Live health and sign-in view for the collab server, at `https://<collab-host>/admin`.

## Enable
Set `ADMIN_EMAILS=you@example.com,other@example.com` in the collab server environment and restart.
Admins are ordinary, email-verified OpenDraft accounts; sign in with the normal password.
Unset = `/admin` returns 404. If an admin account has new-device 2FA enabled, sign in to OpenDraft once from that browser first.

## What it shows
- **CPU / RAM**: whole machine and the server process, plus event-loop lag (stalls here make every client hang). 1-hour sparklines, sampled every 10 s.
- **Resource usage**: stacked used-vs-free bars for RAM, CPU and disk, split by OpenDraft component (collab server, Python backend, Vite dev server, PostgreSQL when `DB_TYPE=postgresql`), found by scanning the process table on the same host. A component on another host shows "not found".
- **Database**: size of whichever database is configured, plus per-table size and row count. SQLite: file + WAL, with free space on its disk. PostgreSQL: `pg_database_size` and `pg_total_relation_size` (free space on the DB server's disk is not visible). Watch `audit_log` and `refresh_tokens`: nothing prunes them.
- **Pages**: the Overview tiles drill down. *Registered users* opens `#/users` (search, sort, paging, verified / Google / 2FA, sessions, sign out). *Collaboration sessions* opens `#/collab` (live sessions per script with participants and roles, open invites by role, every live connection). Invite tokens are never sent to the page.
- **Account summary** (`#/account/<id>`, click any name in either user list): profile and sign-in methods; last active / last sign-in; a 30-day activity chart and per-event counts (30 days and all time) from `audit_log`; devices with last IP and whether each is still signed in; scripts the account shared and who it invited; collaborations it joined; the latest 100 events. Failed sign-ins are matched by email, last 30 days only. Opening an account is itself audited as `admin_view_account` under the admin's id. "Sign out everywhere" is on this page too.
- **Projects and files** (on the account summary): every project the account has stored on the server, with its scripts (title, author, pages, size, created, last saved), uploaded files (name, type, size), note and saved-version counts, disk size and last change, plus a filter. Titles, sizes and dates only — script text, notes and uploads are never read or sent. Only the web app stores files on the server; desktop and mobile apps keep them on the device, so those accounts show nothing here.
- **Users**: signed-in users and devices (one live refresh token = one device), status `connected` (live WebSocket) / `active` (refreshed in last 20 min) / `idle`. "Sign out" revokes all of a user's sessions.
- **Live connections**: who is in which document, role, IP.
- **Why people get signed out**: refused refreshes by reason, rate-limit hits, 24 h login/refresh/logout counts.

## How the file list is fetched
Files live in the Python backend, accounts in the collab server. On each account view the collab server signs a 60-second JWT (`type: admin_inventory`, audience `opendraft-backend-admin`, `sub` = that one account) with the shared `JWT_SECRET` and calls `GET <BACKEND_URL>/admin/accounts/<id>/inventory`. The backend accepts nothing else there: ordinary sign-in tokens, tokens for another account, or tokens living over 2 minutes are refused, and the admin token is refused by every other route. `ADMIN_EMAILS` only needs setting on the collab server.
- Backend address: `BACKEND_URL` when set. Unset, it is the console's own address without the `collab.` prefix — `https://collab.open-draft.com/admin` asks `https://open-draft.com/api` — then the dev defaults `http://localhost:8008/api` and `http://localhost:18321/api`. The browser's `Host` header is used (not `X-Forwarded-Host`), so the token only goes to the site the admin opened. Set `BACKEND_URL` (e.g. `http://localhost:8080/api` in the combined image) to keep the call inside the container.
- If it cannot, the rest of the summary still loads and the Projects section says which URL failed and why.
- Test: `./test-script/admin_account_summary.sh` (own servers on ports 4199/8199, scratch data; `KEEP=1` leaves them up to look at).

## Reading the logout diagnostics
| Reason | Likely cause |
|---|---|
| `already_used_or_revoked` | Refresh tokens are single-use. A reply lost on a flaky network, or two devices sharing a token, leaves the client holding a spent token |
| `rate_limited` | More than 60 refreshes / 15 min from one IP (offices, schools, NAT) |
| `unknown_token` | Database reset/restored, or `JWT_SECRET`/DB changed between deploys |
| `expired` | Device unused for longer than `JWT_REFRESH_EXPIRY` (90d since Nov 2026; was 7d). The sign-in forms then pre-fill that account's email and offer a password reset |

## Platforms
Tested on macOS (dev) and Linux in the production Docker image (`node:20-slim`, cgroup v2, 512 MB / 1 CPU limits); numbers matched `docker stats`.
- **Linux**: RAM from `MemAvailable`, processes from `/proc` (slim images have no `ps`), per-process CPU from `/proc/<pid>/stat` deltas.
- **Containers** (Docker, Cloud Run): when a cgroup limit is below the host, CPU and RAM are shown against the container's quota and limit, labelled "(container limit)", with host totals alongside. cgroup v1 and v2 are both read.
- **macOS**: RAM from `vm_stat`, processes from `ps`.
- **Windows**: untested. Expected to fall back to `os.freemem()` for RAM and to report component detection as unavailable (there is no `ps`).

## Caveats
- Stats are in memory and reset on restart; durable counts come from `audit_log`.
- Components only show when they run on the same host or in the same container; on Cloud Run each service is its own container, so the backend appears as "not found" there; "RAM used" is total minus memory the OS can reclaim (`MemAvailable` on Linux, `vm_stat` on macOS), so cache does not count as used.
- Multiple server instances each show only their own connections and metrics.
