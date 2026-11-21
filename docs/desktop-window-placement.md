# Desktop window placement (issue #281, Part 1)

The startup editor window restores its normal size, display and position before
it is shown, then restores its maximized/full-screen state. The splash screen
keeps its existing centered configuration and is never tracked.

File → New Window opens a **normal** window on the invoking editor's current
display, using its normal dimensions and a small cascade offset fitted to that
display's work area. This also works when the caller is maximized or full-screen.
Opening a file while the app is running uses the focused editor as the origin,
with the startup window as a fallback. This does not reopen all of the previous
session's editor windows or add panel pop-outs.

## Persistence and display changes

The official desktop-only `tauri-plugin-window-state` saves size, maximized and
full-screen state in its normal app-config file. Visibility and decorations are
excluded: they belong to the splash transition and native title-bar handling.
Startup restoration is explicit so bounds are applied before window modes.
Secondary windows skip automatic restoration: an explicit New Window request
must not inherit a reused counter label's old full-screen state or display.

`window-displays.json`, in the same app-config directory, supplements the plugin
with each editor's normal inner/outer bounds, display name, usable work area and
scale. Moving/resizing updates the in-memory snapshot; close/exit writes it.
Maximized, minimized and full-screen bounds never replace normal bounds. The
file contains no document contents or file paths. Invalid/missing metadata falls
back to the plugin's size and the native window's current display.

Display matching prefers name plus work-area origin, then a unique matching
name. Native APIs do not provide a stable hardware ID on every platform, so
identical/unnamed displays with ambiguous changed arrangements fall back to the
primary display. If the saved display is gone, the window is centered and fitted
inside the primary work area. Existing displays retain the logical dimensions
and offset across scale changes, with clamping for changed resolution, docks and
taskbars. The usual 800×600 logical minimum is reduced when necessary to fit a
smaller work area.

On **Linux Wayland**, the compositor owns placement. Detection uses GTK's actual
backend, not just `WAYLAND_DISPLAY` (which may coexist with XWayland). No position
getter/setter is requested there; size and window mode still restore. The desktop
modules and plugin are excluded from mobile builds.

No frontend window-state commands are called, so **no new webview capabilities
are granted**. The existing `open_new_window` command obtains its invoking
webview from Tauri command injection, rather than a caller-supplied window label.

## Automated checks

```sh
rustc --edition=2021 --test src-tauri/src/window_placement.rs -o /tmp/window-placement-tests
/tmp/window-placement-tests
cd src-tauri
cargo test --locked --lib desktop_windows::tests
```

The portable policy runs on Linux, macOS and Windows in CI, without monitors or
a display server. It covers secondary/negative-coordinate displays, unplugging,
DPI and layout changes, smaller work areas, ambiguous names, invalid metadata
and originating-display New Window placement. Native metadata tests cover
serialization, splash exclusion and the selected plugin flags. Existing Linux
and macOS native jobs compile the Tauri integration; the Android job checks that
desktop-only code/dependencies remain excluded.

These tests do not prove native placement, fullscreen transitions or OS-specific
frame metrics on physical multi-monitor hardware.

## Native validation checklist

Run on macOS, Windows and Linux X11; use a disposable OS profile/config directory.

- Move/resize the startup window on display 2; quit/relaunch. Check the same
  display, size and position, with no visible move after the splash.
- Quit on display 2, disconnect it, and relaunch on a smaller primary display.
  Check all window edges and the title bar remain inside the work area.
- Repeat after rearranging monitors or changing display scaling/resolution.
- Quit/relaunch maximized and full-screen, then leave that mode. Check the
  normal window's previous size is retained and visible.
- Minimize before quitting; relaunch must show the window, rather than preserve
  minimization or hidden state.
- From display 2, use New Window, including from a maximized/full-screen caller.
  Check the new window is normal and on display 2. Close and create several
  windows; quit/relaunch and create another, checking stale slots do not restore.
- Cancel a document-close confirmation; check the existing window remains open.
- Open a file through the OS while an editor on display 2 is focused. Check its
  new window follows that display and receives the file.
- On Linux Wayland, check size/window-mode restoration and let the compositor
  choose placement. Check native title-bar controls on startup and new windows.
- Remove or corrupt the supplemental file and relaunch; startup must still work.

Physical native multi-monitor checks remain pending unless recorded in the PR.
