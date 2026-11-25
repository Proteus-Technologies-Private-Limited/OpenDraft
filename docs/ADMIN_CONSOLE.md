# Admin Console

Live health and sign-in view for the collab server, at `https://<collab-host>/admin`.

## Enable
Set `ADMIN_EMAILS=you@example.com,other@example.com` in the collab server environment and restart.
Admins are ordinary, email-verified OpenDraft accounts; sign in with the normal password.
Unset = `/admin` returns 404. If an admin account has new-device 2FA enabled, sign in to OpenDraft once from that browser first.

## What it shows
- **CPU / RAM**: whole machine and the server process, plus event-loop lag (stalls here make every client hang). 1-hour sparklines, sampled every 10 s.
- **Resource usage**: stacked used-vs-free bars for RAM, CPU and disk, split by OpenDraft component (collab server, Python backend, Vite dev server, PostgreSQL when `DB_TYPE=postgresql`), found by scanning the process table on the same host. A component on another host shows "not found".
- **Database**: size of whichever database is configured, plus per-table size and row count. SQLite: file + WAL, with free space on its disk. PostgreSQL: `pg_database_size` and `pg_total_relation_size` (free space on the DB server's disk is not visible). `audit_log` is pruned daily to `AUDIT_RETENTION_DAYS` (365 by default); nothing prunes `refresh_tokens`, so watch it.
- **Pages**: the Overview tiles drill down. *Registered users* opens `#/users` (search, sort, paging, verified / Google / 2FA, sessions, sign out). *Collaboration sessions* opens `#/collab` (live sessions per script with participants and roles, open invites by role, every live connection). Invite tokens are never sent to the page.
- **Account summary** (`#/account/<id>`, click any name in either user list): profile and sign-in methods; last active / last sign-in; a 30-day activity chart and per-event counts (30 days and all time) from `audit_log`; devices with last IP and whether each is still signed in; scripts the account shared and who it invited; collaborations it joined; a filterable activity log of the latest 500 events. Failed sign-ins are matched by email, last 30 days only. Opening an account is itself audited as `admin_view_account` under the admin's id. "Sign out everywhere" is on this page too.
- **Projects and files** (on the account summary): every project the account has stored on the server, with its scripts (title, author, pages, size, created, last saved), uploaded files (name, type, size), note and saved-version counts, disk size and last change, plus a filter. Titles, sizes and dates only — script text, notes and uploads are never read or sent. Only the web app stores files on the server; desktop and mobile apps keep them on the device, so those accounts show nothing here.
- **Users**: signed-in users and devices (one live refresh token = one device), status `connected` (live WebSocket) / `active` (refreshed in last 20 min) / `idle`. "Sign out" revokes all of a user's sessions.
- **Live connections**: who is in which document, role, IP.
- **Why people get signed out**: refused refreshes by reason, rate-limit hits, 24 h login/refresh/logout counts.

## Answering support questions
The account summary opens with a **Support summary**: last sign-in, failed sign-in, sign-out (with device), refused renewal, password reset requested (and whether the email went out), password reset completed, last deletion, last thing created, and what is in the trash. Below it the **Activity log** can be narrowed to *Projects and scripts*, *Password*, *Sign-in and devices*, *Collaboration* or *Admin actions*, and searched by name, title or IP. Each row gives the time, what happened ("Night Shift › Pilot", "was “Pilot”"), the device and the IP.

| Question | Where to look |
|---|---|
| "My script / project disappeared" | Activity log → Projects and scripts: `Script deleted` / `Project deleted` with time and device. Then **Recently deleted** under Projects and files → **Restore** |
| "I never got the reset email" | Support summary → Password reset requested: `email sent`, or `email NOT sent` with the SMTP error |
| "I can't sign in" (no account found) | Users page → **Look up an email**: failed sign-ins, reset requests and account deletions logged under that address in the last 90 days, whether or not an account has it now |
| "Who changed this?" | Rename, upload and version rows name the device and IP |

### What is logged
- **Collab server** (as before): register, sign-ins (password and Google) and failures, sign-out (now on the account's own timeline, with the device), session renewals and refusals, email verification, new-device checks, password change / reset requested / reset / refused reset link, device removed, account deleted, collaboration joins.
- **Backend → collab** (new): `project_created`, `project_renamed`, `project_deleted`, `script_created` (also duplicates and device sync), `script_renamed`, `script_deleted`, `asset_uploaded`, `asset_deleted`, `version_saved`, `version_restored`, `version_deleted`. Each carries names and ids only (project, script title, file name, version message), the device (the account's registered device name when the client sends `X-Device-Id`, else a "Chrome on macOS"-style description) and IP. Never script text.
- **Admin**: `admin_view_account` (under the admin) and `admin_restore` (on the account's timeline, naming the admin).

The backend posts each event to `POST <COLLAB_SERVER_URL>/internal/audit` with a 60-second JWT signed with the shared secret (`type: backend_audit`, audience `opendraft-collab-audit`, `sub` = the account). Only the backend actions above are accepted there; a user's own token, a token for the admin audience, or one living over 2 minutes is refused. Sending happens in the background and never fails the writer's request; if the collab server is unreachable the event is written to the backend's log instead. `AUDIT_TO_COLLAB=0` turns it off.

### Trash and restore
Deleting a project or script on the server moves it to `users/<id>/.trash/` instead of erasing it. It stays restorable for `TRASH_RETENTION_DAYS` (backend env, 30 by default) and is purged after that (checked at startup and every 6 hours). `0` deletes immediately, as before. The trash is not counted against the free-plan file limit, is not listed as a project, and is removed with the account.

**Recently deleted** on the account summary lists each item with its deletion and purge dates. **Restore** puts it back where it was: a script needs its project to exist (restore the project first), and nothing is overwritten — if a project with the same id was created again, or the script exists again, the restore is refused with the reason. The collab server signs a one-entry `type: admin_restore` token for this; the inventory token cannot restore.

### Retention
| Setting | Server | Default | Effect |
|---|---|---|---|
| `AUDIT_RETENTION_DAYS` | collab | 365 | `audit_log` rows older than this are deleted daily; `0` keeps everything |
| `TRASH_RETENTION_DAYS` | backend | 30 | deleted projects/scripts stay restorable this long; `0` disables the trash |

Test: `./test-script/admin_support_activity.sh` (own servers on ports 4198/8198, scratch data; `KEEP=1` leaves them up).

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
