# Keyboard menu checks

Start Vite in `frontend`, install Python Playwright (`pip install playwright`),
and run from the repository root:

```sh
OPENDRAFT_TEST_URL=http://127.0.0.1:5173 python test-script/menu-keyboard/regressions.py
```

The harness defaults to system Chromium when present, or Playwright Chromium;
set `OPENDRAFT_CHROMIUM` to choose an executable. `OPENDRAFT_BROWSER=webkit`
uses Playwright's Linux WebKit build. Install that browser and its dependencies
with `python -m playwright install --with-deps webkit`. CDP foldable emulation
requires Chromium. It creates an isolated browser context for each case and
uses synthetic script text and a temporary plugin with four menu levels.

The sixteen cases cover roving focus, wrapping, Home/End, repeated-letter search,
focusable but inert disabled items and separators, nested Escape/arrow handling, single activation,
checkbox/radio states and named radio groups, Tab/Shift+Tab exit, formatting a selected range and undo,
pointer selection, immediate and delayed dialogs, returning to the originating editor/input after commands, the hidden-toolbar button, toolbar layout changes,
plugin removal, language changes, a 390px inline layout and RTL navigation. They also check ARIA shortcut metadata for the current platform and an emulated Mac keyboard, Hindi typeahead with separate vowel signs, conjuncts and IME composition, and a full application load and Latin/Indic menu search with `Intl.Segmenter` removed.

The segmenter is guarded and cached once, using the same helper as #254. Without the API, menu search accepts a single code point or a base plus combining signs (at most four code points); it conservatively rejects more complex multi-base grapheme keys. Ordinary successive key events still build the search prefix.

Set `OPENDRAFT_SCREENSHOTS` to capture the zoom command/radio group for review.
Pure typeahead and shortcut-conversion regressions run with the frontend unit tests.

For manual verification, use F10 or Tab to enter the application menu, then
navigate Format → AV Script and the plugin menus without a pointer. Check focus
visibility in light and dark themes, and repeat with hidden toolbars. Screen
readers should announce the menu name, expanded/collapsed state, disabled items
and checked/unchecked options. Test touch/hover switching after keyboard use.

Chromium checks do not replace physical WebView or screen-reader testing.
VoiceOver on macOS/iOS and NVDA on Windows remain manual validation; no physical
Mac or iPhone was available for this change.

Plugin-removal checks wait for the removed row to leave the DOM and for focus
to reach the surviving menu before sending Escape. Registry changes schedule
a React commit; an Escape delivered before that commit correctly closes the
old submenu first. A focus-event trace reproduced this ordering once in 35
attempts on unchanged main. The check uses observable DOM/focus conditions,
not a delay or an increased assertion timeout.

Synthetic editor setup uses synchronous view focus. Tiptap's queued focus can
otherwise arrive after the next popup has opened, stealing its input focus in
WebKit; browser-event traces cover that ordering.

The native Chromium accessibility-tree assertion for shortcut exposure uses CDP
and runs only there. Both engines still check shortcut attributes, accessible
roles/names, radio grouping and all keyboard interactions. Playwright WebKit
does not expose an equivalent native AX-tree API; no speech result is inferred.
