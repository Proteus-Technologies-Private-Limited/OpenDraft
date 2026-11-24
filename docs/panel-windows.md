# Panel windows — moving any panel into its own window (issue #281, Part 2)

Every panel can be moved out of the editor window into a window of its own, and
put on another display: each Navigator tab (Scenes, Pages, Locations, Structure,
Bookmarks), Notes, Character Profiles, Tags, Location Profiles, Scene Details,
the Dialogue Tuner, Suggestions, Table Read and the add-on panel strip.

This replaces the first version (#285), which moved only the Scenes list, as a
read-only copy fed by snapshots through a native broker, from a View › Panels
menu command.

## Writer flow

- The pop-out button sits in each panel's own header, beside its close button.
  There is no menu command. In a tab group where a Navigator tab has no header
  of its own, the button sits at the end of the group's tab strip.
- The panel in the window is the same live panel: editing, search, dropdowns,
  dialogs and click-through to the script all work there, and it follows the
  script as it changes.
- In the window, the same button reads **Return … to the main window** and puts
  the panel back in its dock. Closing the window does the same. Closing the
  panel itself (its ×, or its toolbar/menu toggle) closes the window.
- **Several panels can share a window.** Once a panel window is open, the
  pop-out button opens a short menu instead of acting at once: **Move … to a
  new window**, or **Add to the … window** for each open window. In a window,
  the menu also has **Return … to the main window**, and "new window" when the
  panel shares it. A shared window shows its panels as tabs, as a dock's tab
  group does: Navigator tabs together are one Navigator; other panels get a tab
  strip, and every one stays mounted (a Table Read keeps playing behind another
  tab). A window whose last panel moves away closes; closing a shared window
  puts all its panels back.
- App shortcuts typed in a panel window (Save, Find, …) work as in the editor.
  A field's own editing keys (copy, paste, undo, select all) stay with the field.
- The first time, a panel's window opens right where the panel was in its
  dock, at the same size, so it lifts off the script in place. After that it
  reopens where it was left (size and place, per panel); one whose display has
  gone opens beside the editor window instead.
- In the desktop app panel windows float above the script windows, like
  palettes, and hide while another app is in front (macOS: the floating window
  level, hidesOnDeactivate, and they can sit beside a full-screen script;
  Linux: a utility window kept above its script window). In a browser, and in
  the Windows app, they are ordinary windows.
- Panel windows close with their editor window, on reload, and when the
  editor leaves (start screen, sign-out). Without a dock (the fold layout,
  history mode, a narrow window) popped-out panels go back.
- Available in the desktop app (macOS, Windows, Linux) and desktop browsers.
  Phones and tablets have no button: they have no second window to use.

## How it works

A panel window is opened by the editor window with `window.open('')`. It shares
the editor's page, so the editor renders the panel's own React tree into it
through a portal (`PanelWindows` in `PanelPopout.tsx`). One React tree, one set
of stores, one TipTap editor: nothing is sent between windows, so there is no
snapshot protocol to keep in step with the panels, and every panel works there
without changes of its own.

| Piece | Where |
|-------|-------|
| Opening, closing, grouping, remembering bounds | `frontend/src/stores/panelPopoutStore.ts` (`withPanelIn`, `withoutPanel`) |
| Button and its menu, place context, portal host, a window's tabs | `frontend/src/components/PanelPopout.tsx`, `panelPlace.ts` |
| Closing and titling the native windows | `src-tauri/src/panel_windows.rs` |
| Copying styles/theme, forwarding shortcuts, placement maths | `frontend/src/utils/panelPopoutDom.ts` |
| Dock hides popped-out panels; window host mounted | `ScreenplayEditor.tsx` (`dockedPanels`, `panelWindows`) |
| Native new-window handler | `src-tauri/src/desktop_windows.rs` (`with_panel_windows`, `create_main`) |

### The window's document

`window.open('')` gives a blank document. `mirrorDocument` copies the editor's
stylesheets into it — the parsed rules of each loaded same-origin sheet as a
`<style>`, so the window is styled at once and nothing is fetched again; a
`<link>` for a cross-origin sheet (web fonts) — plus a `<base>` so relative
`url()`s resolve. It copies the `<html>` and `<body>` attributes (theme class,
`dir`, `lang`, inline CSS variables) and keeps both in step with a
MutationObserver, which also catches stylesheets loaded later by lazy chunks.

### Code that assumed one document

A panel in a window renders elements that belong to the window's document and
its JavaScript realm. Code a panel uses had to stop assuming the editor's:

- **Popups** (Select, FontPicker) measure against, listen on, and portal into
  the trigger's own window and document (`anchor.doc`).
- **Modal dialogs** (`useModalAccessibility`, `modalPortalContainer`) trap
  focus and handle Escape in the dialog's own document.
- **`instanceof HTMLElement` / `Node`** is false for another window's elements.
  Use `nodeType`, or the element's own `defaultView` constructors.
- **ResizeObserver**: use `observeSize(element, …)`, which takes the element's
  own window's observer. One from the editor window watching the panel window's
  elements makes WebKit report "ResizeObserver loop completed with undelivered
  notifications" as the window settles (found by the browser test).

Keydowns in the window that are app shortcuts are re-dispatched on the editor's
document, where the app's shortcut listeners live.

### Desktop app (Tauri / wry)

WebKit, WebView2 and WebKitGTK only give a `window.open` window the opener's
page when the webview's own new-window path creates it. Each editor window
therefore gets `on_new_window`, answering **`Allow`** for `about:blank` and
**`Deny`** for anything else, so a link or script asking for another URL still
gets no window.

- `Allow` lets wry create the window with the opener's configuration (on macOS
  a plain `NSWindow` + `WKWebView`). It has no Tauri IPC of its own, which it
  does not need: all code runs in the editor window's page.
- `Create` (a Tauri window built on the shared configuration) aborts the app on
  macOS with wry 0.55: wry registers its `ipc` script handler on that
  configuration a second time and WebKit throws.
- `on_new_window` can only be attached by a builder, so the startup window is
  built in code: the desktop platform configs (`tauri.macos.conf.json`,
  `tauri.windows.conf.json`, `tauri.linux.conf.json`) mark it `"create": false`
  and `create_main` builds it from that config first thing in `setup`. File ›
  New Window windows get the handler in `create_window`. Mobile builds keep the
  base config's window and have no handler (and no button).

The page opens `about:blank`, not `''`: WebKit passes `window.open('')` to
the handler as an empty URL, which Tauri cannot parse, so it refuses the
window before the handler is asked ("Could not open a new window").

wry's `Allow` window is bare. On macOS it is an `NSWindow` whose content is a
`WKWebView` with no UI delegate, so `window.close()` does nothing (returning a
panel left an empty window) and the title bar stays blank. On Linux
`window.close()` destroys the web view but leaves its GTK window, titled
"about:blank". `panel_windows.rs` adopts each new window just after wry builds
it (queued on the main thread from the handler): on macOS a delegate closes the
window on `webViewDidClose:` and keeps its title in step with the page's,
passing `windowWillClose:` on to wry's own delegate, which releases the window;
on Linux the web view's `close` closes its window and its title is followed.
When an editor window is destroyed, its panel windows are closed from here too,
in case its page could not close them. WebView2 builds its own popup window,
which does all of this already.

The macOS web view also tells the page nothing about where windows are:
`screenX`, `outerWidth` and the rest come from a delegate wry does not
implement, so the editor and every panel window read as 0, 0. Panel windows
then all opened in one spot, on top of each other, and none came back where it
was left; `window.focus()` did nothing either. So in the desktop app:

- The page names each window it opens (`panel_window_opened`, with the place it
  chose); the app tags the window it just adopted with that id and puts it
  there exactly, on whichever display (window.open's features cannot, across
  displays, in the macOS web view).
- Every second while any are open, the page asks where they are
  (`panel_window_frames`) and remembers each one's place.
- Adding a panel to a window brings it forward through `focus_panel_window`.
- The editor window's own place comes from the Tauri window API.
- A new window is stepped down and right off any window already in its spot
  (`cascade`).

Where the app does not manage the window (`panel_window_opened` answers false:
Windows), the page uses `screenX` and friends, as in a browser.

**One click between windows (macOS).** AppKit spends the first click on a
window that is not key making it key, so with a panel window in front, a
button in the script window needed two clicks (and the same the other way). A
local mouse-down monitor (`install_click_through`) makes the clicked window key
just before AppKit handles the click when the app is already active and the
click goes from or to a panel window. Clicking into OpenDraft from another app
still only brings it forward, as usual on a Mac.

**Logs.** The web view's console cannot be read in a release build, so the
page's panel-window messages (`panelLog` in panelPopoutStore.ts) also go to the
app's log through `panel_window_log`, with the native side's own `[panels]`
lines: a window opened, named and placed, closed, and its panels returned.

A panel window opened from inside another (a panel moved on to a new window)
is opened by the editor window in the desktop app, which has the handler; in a
browser it is opened by the window clicked in, since only that window has the
click's user activation.

Panel windows are not Tauri windows, so they are not in the Window menu and
their placement is remembered by the page (localStorage), not by
`window-displays.json`. Monitor work areas come from `availableMonitors()`, read
ahead of time because a window must be opened synchronously inside the click.

### Browsers

Desktop browsers block a window that is not opened inside the click, which is
why `popOut` opens it synchronously. If one is blocked anyway, the writer is
told to allow pop-ups for the site. The browser keeps windows on screen itself,
so a remembered position is used as it is.

## Tests

- `test-script/panel-popout/regressions.py` — the real built app in Chromium or
  WebKit (`OPENDRAFT_BROWSER=webkit`): every panel out and back, its own button,
  the dock, styles, live updates, a dropdown in the window, a shortcut from the
  window, theme mirroring, closing, panels sharing a window (joining, tabs,
  moving on, a Navigator of two tabs, an emptied window closing, a shared
  window closed), and no page errors. Runs in the accessibility workflow
  against the dev server.
- `frontend/src/utils/panelPopoutDom.test.ts` — shortcut forwarding and window
  placement. `frontend/src/stores/panelPopoutStore.test.ts` — the grouping
  rules.
- Desktop: checked by hand in the macOS test app — windows open, return and
  close (button, red button), show the panel's title, follow scene clicks, and
  close with their editor window (a File › New Window window closed takes its
  own panel windows only).
