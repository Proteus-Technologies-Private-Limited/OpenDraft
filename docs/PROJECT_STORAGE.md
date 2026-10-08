# Project Storage Locations (issue #135)

Status: implemented — phases 1–3, not yet in a release. Tested by hand on
8 Oct 2026 in the macOS desktop app, the Android emulator, the iPad simulator and
the browser (see *Manual test run* below).

## The request

A writer keeps all their work on a RAID / network drive and wants OpenDraft to
save there directly:

- a default folder for new projects, and
- a per-project folder, e.g. an existing `MyFilm/scripts/`,

so the newest copy of every script is already on the RAID with no manual
backup step.

## Why the database does not move

SQLite runs in WAL mode (`services/db.ts`). WAL needs a shared-memory file that
is not safe on SMB/NFS, and SQLite's locking over network filesystems is
unreliable even without it. A movable database would put exactly these users at
risk of corruption, so the library stays on local disk and the scripts are
*also* written as files where the writer wants them.

## Design

**Any library script can be linked to a file; a project can be linked to a
folder, which links all its scripts.** The library copy stays the working copy
(versions, notes, assets, project list keep working); every save also writes
the file.

| Concern | Behaviour |
|---|---|
| Saving | `local-storage` calls the `after…` hooks in `services/linkedFiles.ts` after every create / save / rename / duplicate / delete / version restore, so every save path reaches the file. |
| Formats | `.odraft` (keeps everything), `.fountain`, `.fdx`; `.osf` files found in a folder too. Treatments and AV scripts are always `.odraft`. `.fadein` is not linkable (binary, non-atomic write). Serialising lives in `utils/linkedFileFormat.ts`, which Save on a file opened from disk now uses as well. |
| Atomic writes | `save_text_atomic` (temp file + rename), with a 10 s timeout. |
| Drive offline | The library save succeeds; the link is marked pending and retried every minute and on window focus (`LinkedFileSync`). The status bar says "not saved to file". |
| Changed elsewhere | Before writing, the file's mtime/hash is compared with what OpenDraft last wrote. A changed file is never overwritten: the link goes to `conflict`. On open and on window focus the file is re-checked — loaded if the library has nothing new, otherwise the writer is asked. |
| Conflict | "Use the file's version" → the library's version (with unsaved edits) is checked into Version History first. "Keep OpenDraft's version" → the file's version is saved beside it as `Name (changed outside OpenDraft <date>).ext`. |
| Lossy formats | Reloading a `.fountain`/`.fdx` keeps the library's notes, beats, profiles etc. that the format cannot carry (`mergeKeptMetadata`). |
| Unchanged saves | A save that does not change what the file says is not written: the file is read back and re-serialised, and if that matches, it is left alone. Without this, merely opening a script rewrote its file in OpenDraft's own style (the first save after opening stores the editor's normalised copy). |
| Rename | In a folder project the file follows the title (`rename_path`, never overwrites). |
| Delete | Asks "Also delete the file?" (default no). A kept file is remembered in `project_folder_ignores` so the next scan does not re-add it. |
| Folder scan | On opening a folder project, new files in the folder become scripts. |
| Project name | *Open Folder as Project* names the project after the folder — or after its parent when the folder is called `scripts`, `drafts`, `screenplays` etc., so `MyFilm/scripts` becomes "MyFilm". |
| Same file twice | "Open File from Disk" on a linked file opens the library script instead; Save to File As refuses a file another script uses. |
| Main thread | The folder commands run on Tauri's async pool, so a hung network share cannot freeze the window. |

### Data

- `script_files(script_id, project_id, path, format, synced_hash, synced_mtime, pending, last_error)` — no FK, because restoring a version deletes and re-inserts scripts.
- `project_folder_ignores(project_id, name)`.
- `projects.properties.folder_path` / `file_format`.
- Settings (localStorage): `autoSaveLibrary`, `autoSaveFiles`, `autoSaveIntervalSeconds`, `defaultProjectFolder`, `defaultFileFormat`.
- Rust: `stat_path`, `rename_path`, `read_text_path` (new); `list_dir_entries`, `ensure_dir`, `delete_file`, `save_text_atomic`, `probe_directory` moved off the main thread.

### Auto-save

- **Library scripts** — including linked ones — follow "Auto-save scripts in my
  OpenDraft library" (default on).
- **Files opened from disk** follow "Auto-save files opened with Open File from
  Disk" (default off).
- With auto-save off nothing is written unasked: no timed or metadata saves,
  and leaving the editor, switching scripts or closing the window asks
  (Save / Discard / Cancel). The crash-recovery snapshot still runs.

## Where it shows up

- **Settings → Saving:** auto-save toggles and interval; *Project folders*:
  where new projects are saved (library / a folder), the projects folder, the
  file format.
- **Projects → New Project:** Save in library / a folder (defaults from
  Settings), folder with Change…, file format. Folder projects show a *Folder*
  badge; deleting one says the files stay on disk.
- **Project screen:** folder path in the header, **Storage** dialog (Save to a
  Folder…, Show in Folder, Check for New Files, Move to Another Folder…, Save
  in Library Only…, file format), file badge per script, script menu *Show
  File* / *Save to File…* / *Stop Saving to File*.
- **File menu:** *Open Folder as Project…*, *Save to File As…* (desktop).
- **Save As** into a new project uses the default projects folder.
- **Status bar:** the linked file's name, and any problem with it.

## Platforms

Desktop only for linking (iOS/Android pickers give per-file handles, not folder
paths). The auto-save settings apply everywhere.

## Known limits

- The treatment editor still auto-saves on its own 1.2 s debounce regardless
  of the auto-save setting (it has no unsaved-changes prompt to fall back on).
- Linked `.odraft` files do not embed images (they would be rewritten on every
  save); images stay in the library's assets.
- Two projects cannot share one folder file; a scan skips files another
  project already links.
- Android's Back button with auto-save off sends the app to the background
  without asking; the work stays in the editor and in the recovery copy.


## Manual test run (8 Oct 2026)

**macOS (release build):** projects folder in Settings; New Project into a
folder (Fountain); Save As into it wrote the file; auto-save rewrote it; an
outside edit was loaded on window focus; outside edit + unsaved edits raised
the conflict dialog, and *Keep OpenDraft's Version* kept the other copy as
`… (changed outside OpenDraft …).fountain`; Open Folder as Project on an
existing folder (files untouched); opening a script left its file untouched;
a read-only folder (stand-in for an offline drive) marked the file pending
with the status bar showing it, and it was written on refocus once writable;
rename renamed the file; delete kept the file and a rescan did not re-add it;
auto-save off + close window asked, and Save & Continue wrote library and
file; Save to File As wrote `.fdx`.

**Android / iPad:** new tables created on upgrade; desktop-only UI hidden;
auto-save on writes, off writes nothing and leaving asks (Save / Discard /
Cancel); a force-quit with auto-save off offers the work back on relaunch.

**Browser:** Saving settings without the desktop sections; New Project has no
folder options; save tests blocked by the account's 5-file plan limit.

Bugs found and fixed in this run:

- *Discard* on leaving the editor left the crash-recovery copy behind, so the
  next launch offered to "recover" the discarded text.
- Project ▸ New Document opened the last-opened script instead (the
  "reopen last session" step ran because no script was set), and the format
  prompt then blanked the page while the editor was still bound to that
  script. Closing the tab would have saved the blank page over it: the
  save-on-close paths lacked the empty-body guard the timed auto-save has.
  Both fixed — the reopen step skips a project with no script, and every
  save on leaving refuses an empty body over saved text.
- Opening a script rewrote its file (see *Unchanged saves*).
- File names and folder paths were shown upper-cased; the Storage dialog's
  buttons were unstyled; a long folder path in New Project hid its end.
- *Keep OpenDraft's Version* wrote only the last saved copy; edits still on
  screen now go into the library and the file with it, and the status shows
  Saved.
- *Save to File As* on an untitled draft left it called "Untitled
  Screenplay"; it now takes the file's name (a title the writer set is kept).

Retested after those fixes (8 Oct 2026): New Document, the empty-page guard
and Discard on Android and iPad; Keep OpenDraft's Version and Save to File As
on macOS.

## Tests

`utils/linkedFileFormat.test.ts`, `services/linkedFiles.test.ts` (real service
against fake tables / filesystem / library), `services/pendingSave.test.ts`,
`stores/autoSaveSettings.test.ts`, `stores/documentOrigin.test.ts`.
