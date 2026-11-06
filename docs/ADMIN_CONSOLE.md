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
- **Users**: signed-in users and devices (one live refresh token = one device), status `connected` (live WebSocket) / `active` (refreshed in last 20 min) / `idle`. "Sign out" revokes all of a user's sessions.
- **Live connections**: who is in which document, role, IP.
- **Why people get signed out**: refused refreshes by reason, rate-limit hits, 24 h login/refresh/logout counts.

## Reading the logout diagnostics
| Reason | Likely cause |
|---|---|
| `already_used_or_revoked` | Refresh tokens are single-use. A reply lost on a flaky network, or two devices sharing a token, leaves the client holding a spent token |
| `rate_limited` | More than 60 refreshes / 15 min from one IP (offices, schools, NAT) |
| `unknown_token` | Database reset/restored, or `JWT_SECRET`/DB changed between deploys |
| `expired` | Idle past `JWT_REFRESH_EXPIRY` (7d) |

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
