# Foldable implementation and validation

Tracks implementation against [the design](foldable-support-design.md) and
[#231](https://github.com/Proteus-Technologies-Private-Limited/OpenDraft/issues/231).
The proposal remains the acceptance checklist; this document does not mark
untested native behavior as complete.

| Package | Implemented here | Remaining work |
| --- | --- | --- |
| WP1–WP2 | Responsive menu, Location overlay and live swipe checks were merged in PR #235. | Included by the merge of main into this branch. |
| WP3 | Browser posture, current `window.viewport.segments`, legacy fallback, size fallback, segment media queries, 150 ms debounce, HTML classes and crease variables. Capability is remembered only for the current document after observing two valid segments. | Verify System WebView on Android; add WindowManager integration if those browser APIs are absent. A first launch on a cover screen cannot establish capability from size alone. |
| WP4 | No native bridge is included. | Implement and compile the iOS 27.1 bridge against the actual SDK, then exercise the Duo simulator. UIKit calls the region `division`, not `fold`; Objective-C uses `reservedRegionsOfKind:options:`. Read it in `updateConstraints`, where UIKit tracks changes; include inactive regions to establish capability while flat. |
| WP5 | The original screen-based phone rule and its explanation are retained for all ordinary devices. Confirmed browser foldables use the separate window-based posture state. | Defer any iPhone-specific sizing change until there is native/device evidence to test. |
| WP6 | Independent folded/open preferences; one-time migration of explicit legacy choices into both postures; selecting an already-active layout still records a choice. Automatic geometry changes do not overwrite choices or reset zoom in the same layout. | Native posture-event validation after WP4. |
| WP7 | On confirmed folded foldables, Hidden keeps the phone-sized toolbar; the existing draggable menu button starts below it at the right. Focus Mode and ordinary-device Hidden retain their behavior. | Native safe-area validation. |
| WP8 | Fit-width page with 70% minimum, Navigator docking at 80%, one 300 px panel column with tabs, Table Read in that column, plugin panels, and Story Timeline as a bottom band. Stable portal hosts preserve mounted panel subtrees. | Long-script reading position, selection, typing/undo, panel focus (including the appendChild fallback), plugin activation and browser keyboard/ARIA regressions are covered. Physical touch targets, screen readers and native keyboard behavior still need device validation. |
| WP9 | No split-screen implementation duplicated. | Merge #214, then connect its companion panes and crease default. |
| WP10 | No replacement toolbar or element selector added. | Merge #217, then arrange the writer's items in two rows and implement the accessible horizontal choice line. Measure the native keyboard before deciding which side of the crease holds the rows. |
| WP11 | Browser book/laptop detection, book script reflow, right/lower panel slots, larger current Table Read line, and a writing pad sharing the book/laptop companion tabs without losing its draft or selection. | Book companion panes and empty-companion continuation; final laptop/flip layout together with WP10. The current toolbar remains at the top. This package is partial. |
| WP12 | Browser Media Session controls were merged separately in #237. | Native iOS remote commands/audio-session/background-mode support and Android MediaSession/background service. Browser Media Session alone cannot guarantee playback after a web view is suspended. |
| WP13 | No hardware capability is inferred from a model name. | Native Pencil capability and native refusal of New Window on a cover screen, after WP4. |

## Resetting browser emulation

Detection is kept in JavaScript memory for the current page load only. To reset
it, turn off Chrome DevTools dual-screen/foldable emulation and reload the page.
The legacy `opendraft:foldable` localStorage marker is removed on startup and is
never read or written as detection evidence. The same loaded page still retains
its detection when moving to a cover screen; a reload without live segment
evidence uses the ordinary-device fallback. Saved posture choices remain in
view state, but ordinary devices use their original single preferences.

## Zoom and reading position

Ordinary desktop, tablet and phone resizes do not emit fold changes unless the
phone/wide size class actually changes. Confirmed foldables still report viewport
changes so docking and page fitting follow the available space. An expired zoom
anchor is never restored after the writer has moved elsewhere in the script.

In cover-screen Page view, entering the posture or changing its viewport/page
layout fits the page once. Opening panels, resizing the Navigator or changing
the toolbar preserves the writer's custom zoom. Open-posture Page view still
refits when its docked panels change the space available to the script.

## Reproduce browser checks

Start Vite, install Python Playwright and system Chromium, then run:

```sh
OPENDRAFT_TEST_URL=http://127.0.0.1:5173/ python test-script/foldables/posture.py
OPENDRAFT_TEST_URL=http://127.0.0.1:5173/ python test-script/foldables/regressions.py
OPENDRAFT_TEST_URL=http://127.0.0.1:5173/ python test-script/foldables/review_regressions.py
OPENDRAFT_TEST_URL=http://127.0.0.1:5173/ python test-script/foldables/writing_pad.py
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
typing and undo. It tracks the viewport reading point independently of the text
selection; the test-only editor probe is closed during this reading check. A test-only plugin exercises repeated open requests, switching,
unregistering, focused text selection and the older-browser reparenting fallback.
Keyboard checks cover roving focus, Home/End, RTL arrows, labelled tab panels,
hidden controls and focus after closing a panel. The tests are run by
`.github/workflows/test-foldables.yml` for the listed fold-specific
paths, or by `workflow_dispatch`. Changes to shared editor, menu, toolbar, store,
startup and stylesheet files alone do not start it; use the manual workflow when
those changes need foldable integration coverage. The
review regression checks cover preserved custom zoom on ordinary desktop, iPhone
and iPad windows, discarded legacy markers, resetting emulation by reloading,
the inherited Comfortable toolbar size in both postures, scroll-after-zoom
resizing on ordinary desktop/tablet/phone windows and genuine size-class
transitions, and custom zoom on a confirmed foldable cover screen.
The scripts also support `OPENDRAFT_CHROMIUM`
for a chosen executable, or Playwright's bundled Chromium when no system copy
is available. These checks do not simulate native background execution,
Pencil, UIKit or a system keyboard.

Unit coverage includes crease geometry, invalid segment data, capability
retention, debounce/cleanup, iPhone/iPad sizing, page fit, preference migration
and actual store updates. No physical Mac, iPhone, iPad or foldable is available
for this contribution. Native and physical-device checks remain explicitly
unverified; contributors who have those tools should record their results
against the design's acceptance checklist before claiming native support.

## Writing-pad placement

On confirmed browser foldables, Handwriting shares the companion tabs on the
right in book posture and below the crease in laptop/tabletop posture. Repeating
the open request selects its tab. Switching panels hides the writing draft
without discarding it; Escape closes the pad only from within it while docked.
The same textarea, text selection and live editor insertion target survive
posture changes, including the appendChild fallback. Insert still clears only
the pad and is undoable in the editor.

In Focus Mode, open-flat, cover screens and ordinary devices it floats. Its
floating home is mounted before the dock and outside the editor layout so
Focus Mode cannot hide it. Escape from the script still closes the floating
pad; docked Escape is limited to unhandled events inside its pane. The docked
pad is a labelled region inside the tabpanel, rather than a nested dialog. Docking
does not overwrite the saved floating size/position; floating dimensions are
clamped to the available viewport. Short dock slots scroll to keep tools and
Insert reachable. This is browser layout coverage, not native Pencil or system
keyboard validation. WP10's keyboard-aware toolbar placement remains separate.

## Review follow-ups from #236 and #247

Book posture uses the Phone zoom bucket for rendering and pinch changes even
when the saved layout choice is Page. Returning to laptop/open Page view uses
its separate Page zoom. Cover-screen Page fitting follows width, posture and
page-layout changes; height-only changes preserve custom zoom, including a
layout viewport resized for a keyboard. Navigator docking and rendering share
the 240px width, independently of an earlier manual Navigator resize. Docked
Story Timeline ignores Escape already handled by a popup or sent outside it.

A reduced visual viewport (over 120px less height than the layout viewport) or
a lower slot shorter than 240px temporarily floats the same writing pad. The
floating pad follows visual-viewport offsets and scrolls its controls; restoring
space docks it again without losing text/selection or overwriting floating
preferences. Browser tests supply viewport geometry and exercise the Keyboard
toggle; this is not a physical keyboard or IME validation. WP10 still owns the
native keyboard-aware toolbar layout. A Mac, iPhone, iPad and physical foldable
remain unavailable, so native checks remain unverified.

The writing-pad suite also checks ordinary-device Focus Mode and Escape from
the script, foldable Focus Mode, book pinch persistence, cover height-only
resizes, a previously widened Navigator, short tabletop slots, visual viewport
reduction/offsets, and docked Timeline Escape. Dependency manifest changes alone
no longer start foldable browser CI; manual dispatch remains available.
