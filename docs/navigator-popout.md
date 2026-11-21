# Navigator pop-out — issue #281, Part 2 (first panel)

This builds on #284's desktop placement work. It implements the issue's proposed
**snapshot + commands** approach for the read-only **Scenes** Navigator. Index
Cards, Beat Board, Outline, Page View and the other Navigator tabs remain in the
owner window. They can be considered separately after this first panel is reviewed.

## Writer flow

In the desktop app, use the button beside the Navigator's Scenes heading or
View → Panels → Move Scene Navigator to New Window. A separate, movable window
shows the script title, searchable headings and synopses. Scene clicks move the
owner's selection and scroll it into view; owner caret changes highlight the
current scene in the panel. The panel follows the owner's appearance and language.

Return to Main Window or the native close control restores the Scenes pane,
reopening the Navigator if it was hidden while its separate window was open. No
workspace layout, group, tab placement or expansion preference is rewritten.
The owner window is brought forward for the explicit Return action and keyboard
focus returns to the original control, a replacement pop-out button or the editor.

The panel has no editor menu/toolbar; the shared system menu remains on macOS.
The native window remembers normal placement per owner/Scenes panel, including
safe display-disconnect fallback from Part 1. New panel instances have unique
native labels so a late destruction event cannot affect a replacement instance.

## Ownership and persistence

Rust creates panels only for injected editor-window callers (`main`, `main-N`).
The registry binds each panel to one owner and a fresh document-session token.
Snapshots and navigation are brokered to that relationship; a panel cannot pick
an arbitrary owner by passing a label. Reloading/closing the owner revokes its
panels natively. Route/script changes and full-document replacements revoke them
from the owner hook. In-flight creation is also revoked, avoiding orphan windows.
Cancellation of an owner close does not close its panels: native teardown waits
for destruction, rather than the cancellable CloseRequested event.

Panel startup bypasses storage initialization, recovery housekeeping and the
editor route. It does not instantiate a TipTap editor, claim an open document,
join collaboration, save or own undo history. Panel labels are also filtered out
of editor-window lists and document claims as a second guard. Its capability file
only allows event listener registration/removal; it adds no SQL/filesystem access.
Native custom commands perform the broker operations.

The owner sends heading/synopsis summaries (not document bodies or paths), plus
appearance, language and selected scene. While a panel is open, updates are
coalesced at 100 ms; a selection-only update reuses the last document summary.
Commands carry the document revision and scene index. A stale command requests a
fresh snapshot and cannot jump using outdated positions after edits/reordering.
Snapshot sequence numbers prevent out-of-order updates. Both ends await native
listener registration before creating/requesting a snapshot, so slow IPC cannot
lose the initial handshake. Navigation only changes
selection; it does not add document IDs, undo entries or another save path.

## Automated verification

- Portable Rust placement tests include narrow panels, remembered placement and
  disconnected-display fitting. Ownership tests cover owner isolation, revocation
  of an in-flight reservation, old-session cleanup and late destruction events.
- `panelProtocol.test.ts` checks summary contents, immutability, validation and
  stale navigation rejection. The existing translation suite checks all 19 locales.
- `test-script/panel-popout/regressions.py` runs real Chromium/WebKit windows,
  the actual panel startup entry, React components/hooks and TipTap with an **explicitly simulated
  native IPC broker**. It checks keyboard navigation, unchanged document/undo,
  caret/heading/search sync, stale revisions and snapshots, theme/language changes,
  return, document switch/replacement and the absence of SQL/save initialization.
  It creates/removes temporary Vite entries; none ship in the product build.

Run with the normal Vite server, Python Playwright and its browser installed:

```sh
OPENDRAFT_TEST_URL=http://127.0.0.1:5173 \
  python test-script/panel-popout/regressions.py
OPENDRAFT_BROWSER=webkit OPENDRAFT_TEST_URL=http://127.0.0.1:5173 \
  python test-script/panel-popout/regressions.py
```

The browser workflow runs both engines and uploads screenshots/results. Native
Linux/macOS Rust checks compile the broker; mobile checks cover the desktop-only
boundary. Automated browser transport tests do **not** establish native monitor
placement, operating-system focus, native menus or physical display hot-plug.

## Native checks still required

On macOS, Windows and Linux X11, verify opening from each display, panel resize /
move / reopen, disconnecting a remembered display, native close and Return, owner
close cancellation, owner reload and switching scripts while a panel is opening.
Check the owner's existing autosave/recovery and undo/redo while a panel is open.
On Wayland, verify normal size restoration and let the compositor choose position.
Physical multi-monitor checks remain pending unless the PR explicitly records them.
