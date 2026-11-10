# Foldable implementation and validation

Tracks implementation against [the design](foldable-support-design.md) and
[#231](https://github.com/Proteus-Technologies-Private-Limited/OpenDraft/issues/231).
The proposal remains the acceptance checklist; this document does not mark
untested native behavior as complete.

| Package | Implemented here | Remaining work |
| --- | --- | --- |
| WP1–WP2 | Responsive menu, Location overlay and live swipe checks are in PR #235. | Merge #235 before the layout PR; it is a separate prerequisite. |
| WP3 | Browser posture, current `window.viewport.segments`, legacy fallback, size fallback, segment media queries, 150 ms debounce, HTML classes and crease variables. Capability is remembered only after observing two valid segments. | Verify System WebView on Android; add WindowManager integration if those browser APIs are absent. A first launch on a cover screen cannot establish capability from size alone. |
| WP4 | No native bridge is included. | Implement and compile the iOS 27.1 bridge against the actual SDK, then exercise the Duo simulator. UIKit calls the region `division`, not `fold`; Objective-C uses `reservedRegionsOfKind:options:`. Read it in `updateConstraints`, where UIKit tracks changes; include inactive regions to establish capability while flat. |
| WP5 | iPhone uses the window short side; iPad and other devices retain the screen rule. | Native/simulator Split View validation. |
| WP6 | Independent folded/open preferences; one-time migration into folded; selecting an already-active layout still records a choice. Automatic geometry changes do not overwrite choices or reset zoom in the same layout. | Native posture-event validation after WP4. |
| WP7 | On confirmed folded foldables, Hidden keeps the phone-sized toolbar; the existing draggable menu button starts below it at the right. Focus Mode and ordinary-device Hidden retain their behavior. | Native safe-area validation. |
| WP8 | Fit-width page with 70% minimum, Navigator docking at 80%, one 300 px panel column with tabs, Table Read in that column, plugin panels, and Story Timeline as a bottom band. Stable portal hosts preserve mounted panel subtrees. | Long-script reading position, selection, typing/undo, panel focus (including the appendChild fallback), plugin activation and browser keyboard/ARIA regressions are covered. Physical touch targets, screen readers and native keyboard behavior still need device validation. |
| WP9 | No split-screen implementation duplicated. | Merge #214, then connect its companion panes and crease default. |
| WP10 | No replacement toolbar or element selector added. | Merge #217, then arrange the writer's items in two rows and implement the accessible horizontal choice line. Measure the native keyboard before deciding which side of the crease holds the rows. |
| WP11 | Browser book/laptop detection, book script reflow, right/lower panel slots, larger current Table Read line. | Book companion panes and empty-companion continuation; writing pad placement; final laptop/flip layout together with WP10. The current toolbar remains at the top. This package is partial. |
| WP12 | Browser Media Session controls are prepared separately. | Native iOS remote commands/audio-session/background-mode support and Android MediaSession/background service. Browser Media Session alone cannot guarantee playback after a web view is suspended. |
| WP13 | No hardware capability is inferred from a model name. | Native Pencil capability and native refusal of New Window on a cover screen, after WP4. |

## Reproduce browser checks

Start Vite, install Python Playwright and system Chromium, then run:

```sh
OPENDRAFT_TEST_URL=http://127.0.0.1:5173/ python test-script/foldables/posture.py
OPENDRAFT_TEST_URL=http://127.0.0.1:5173/ python test-script/foldables/regressions.py
# From PR #235:
OPENDRAFT_TEST_URL=http://127.0.0.1:5173/ python test-script/foldables/responsive.py
```

The posture check uses Chromium CDP screen metrics, display features and device
posture overrides, including the browser's real segments API. Its experimental
web-platform flag enables foldable emulation in the installed Chromium. It
checks independent preference restoration, phone toolbar/FAB geometry, panel
tabs and the same editor/Table Read DOM instances across fold/unfold.
The additional regression suite loads a 240-block script and checks the reading
position and selection across book, laptop, cover and open postures, followed by
typing and undo. A test-only plugin exercises repeated open requests, switching,
unregistering, focused text selection and the older-browser reparenting fallback.
Keyboard checks cover roving focus, Home/End, RTL arrows, labelled tab panels,
hidden controls and focus after closing a panel. The tests are run by
`.github/workflows/test-foldables.yml`; they also support `OPENDRAFT_CHROMIUM`
for a chosen executable, or Playwright's bundled Chromium when no system copy
is available. These checks do not simulate native background execution,
Pencil, UIKit or a system keyboard.

Unit coverage includes crease geometry, invalid segment data, capability
retention, debounce/cleanup, iPhone/iPad sizing, page fit, preference migration
and actual store updates. No physical Mac, iPhone, iPad or foldable is available
for this contribution. Native and physical-device checks remain explicitly
unverified; contributors who have those tools should record their results
against the design's acceptance checklist before claiming native support.
