# Cloud sync: whole-project sync and git-style merging

Builds on offline cloud scripts (#291) and device project sync (#292), and
finishes #289: a project syncs as a whole, and a script changed on two devices
is merged rather than one version replacing the other.

## What syncs

| | Offline cloud scripts (`offlineCloud.ts`) | Device project sync (`deviceProjectSync.ts`) |
|---|---|---|
| Screenplay body and its notes, tags, profiles, beats, settings | yes, merged | yes, merged |
| Treatments | yes | yes (were skipped before) |
| Script renames | (cloud is the only copy) | yes; on a double rename this device's title wins |
| Project details (name, colour, properties) | (cloud is the only copy) | yes (`deviceProjectExtras.ts`), merged, device wins a clash |
| Location Database | (cloud is the only copy) | yes, merged by location id, device wins a clash |
| Pictures and other assets | (cloud is the only copy) | yes, union by asset id; deletions are not copied |
| Version history, linked-folder projects | no | no |

Character profiles, notes and so on are part of each script's content (the
`_`-prefixed keys in `utils/saveContent.ts`), so they travel with the script.

## The merge (`utils/scriptMerge.ts`)

A three-way merge of the **base** (the copy both sides last agreed on), this
**device**'s copy and the **cloud**'s:

- **Script body**: diff3 over top-level paragraphs, compared whole (text,
  attributes and marks). A region changed on one side only is taken from it;
  the same change on both is taken once; different changes are a conflict.
  Inside a region that changed on both sides, each side is diffed against the
  base on its own and only changes that truly overlap (the same base
  paragraphs, or insertions at the same spot) become a conflict, so a dialogue
  line edited here and its parenthetical edited there do not clash. Paragraphs
  are never paired by position: equal counts on all three copies say nothing
  about which paragraph an edit belongs to.
- **Merge dialog**: the merge is uploaded only onto the cloud revision it was
  built from. If the cloud (or, for device projects, the device copy) changed
  while the dialog was open, nothing is written; the dialog rebuilds the merge
  from the new copies and tells the writer.
- **Metadata** (`_notes`, `_characterProfiles`, …): per key. Lists of records
  with an `id` merge record by record; lists of words as sets; anything else is
  one value.
- **Track changes**: inputs are restored with `restoreReviewContent`, so
  suggestions merge with the paragraphs they mark; the result is wrapped again
  with `prepareReviewSave`.
- **No base** (rows saved before this change): the paragraphs both copies share
  anchor the alignment and every difference is a conflict; a record on one side
  only is kept, never read as a deletion.

`autoMerge()` returns the merged script only when nothing conflicts.

### Where the base comes from

- Offline cloud scripts: `OfflineScript.base` in IndexedDB — the cloud's content
  at `revision`, set on download, on every acknowledged upload, and on a
  resolution. A row saved before this change gets it from its synced content on
  the first edit.
- Device project sync: `device_script_sync.base_content` (and `base_title`) in
  SQLite, written with every acknowledged base. `readScriptBases` does not read
  the bodies; `readScriptBaseContent` reads one when a merge needs it.
- Project-level: `device_project_sync.details_base`, `locations_base`,
  `locations_revision`, `assets_synced`.

### When it merges by itself

On a 412 (offline cloud) or when both sides moved on (device sync), if the base
is known, the changes do not overlap, **Settings → Saving & Backups → Merge
edits on different lines automatically** is on (`autoMergeEdits`, the
default), and the script is not open in an editor in any window
(`scriptOpenAnywhere`). With the setting off, every screenplay changed on both
sides waits in the merge dialog for review.

"Open" means an editor is showing it: the screenplay and treatment editors mark
the script while mounted (`markDocumentShowing`), and other windows are found
through their open-document claims. It used to be the project store's current
script, which stays set after the writer goes back to the project page — so the
script just edited, the one most likely to have changed in both places, was
never merged automatically. The merge is written to the device first,
only over the exact body that was read, then uploaded on the cloud's current
revision. Otherwise the script is reported as a conflict.

An open editor is never written under: its next autosave would undo the merge.
The writer settles those in the merge dialog, and the editor reloads the result.

## The merge dialog (`components/MergeConflictDialog.tsx`)

Opened from **Review and merge** — on the editor's cloud-conflict banner, and
beside each conflicting screenplay in a synced project's sync panel.

- **Merge** tab: one card per conflict, this device's text beside the cloud's
  with changed words highlighted, and **Keep this device / Keep the cloud / Keep
  both**. Bulk choices, a list of what merged automatically, and **Save merged
  script** once every conflict has an answer.
- **Compare** tab: `ScriptDiffView` (the version-history diff) between any two
  of cloud, device, last synced and the merged result.
- **Keep this device's version / Use the cloud version** keep one whole version;
  the other is saved as a new screenplay, as before.

## Server

Two routes, used only by device project sync:

- `GET/PUT /api/projects/{id}/location-list` — the whole list with a revision;
  PUT replaces it only from the expected revision (412 otherwise).
- `PUT /api/projects/{id}/device-assets/{asset_id}` — store an asset under the
  device's id, so documents that refer to a picture by id resolve in the cloud.
  Idempotent; the id is validated before it is used in a file name.

A server without them answers 404/405 and that part is skipped; screenplays
still sync. **Deploy the backend** for locations and pictures to sync.

### Binary bodies on desktop and mobile

On the apps every cloud request goes through the Rust `http_fetch` command
(`platformFetch` in `services/platform.ts`), which used to carry text only: a
multipart upload arrived with no body (FastAPI answered 422) and a downloaded
picture came back with its bytes replaced by U+FFFD. `platformFetch` now sends a
non-string body (FormData, Blob, bytes) as base64 in `bodyBase64`, with the
multipart Content-Type the web view gives it, and `http_fetch` returns a body
that is not UTF-8 as base64 (`encoding: "base64"`). Picture transfers get a
300-second budget (`timeoutSecs`) instead of the usual 10. This also fixes the
picture upload when a script with images is saved to the cloud from the apps
(`cloudApi.uploadAsset`), which had never worked there.

## Tests

- `frontend/src/utils/scriptMerge.test.ts` — the merge.
- `frontend/src/services/offlineCloud.test.ts` — base tracking, auto-merge after
  a 412, a merge uploaded from the dialog, the losing side kept as a copy.
- `frontend/src/services/deviceProjectExtras.test.ts` — details and locations.
- `test-script/test_project_sync_endpoints.py` — the two server routes.
- `frontend/src/services/platformFetch.test.ts` — binary bodies across `http_fetch`.
- `test-script/built-app-sync/run.py` — the built app end to end (sections M, P,
  G1b), including screenshots of the dialog and its Compare tab.
  `OPENDRAFT_BROWSER_CHANNEL=chrome` uses an installed Chrome.
