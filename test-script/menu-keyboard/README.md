# Keyboard menu checks

Start Vite in `frontend`, install Python Playwright (`pip install playwright`),
and run from the repository root:

```sh
OPENDRAFT_TEST_URL=http://127.0.0.1:5173 python test-script/menu-keyboard/regressions.py
```

The harness uses `/usr/bin/chromium`; set `OPENDRAFT_CHROMIUM` to use another
Chromium executable. It creates an isolated browser context for each case and
uses synthetic script text and a temporary plugin with four menu levels.

The nine cases cover roving focus, wrapping, Home/End, repeated-letter search,
disabled items and separators, nested Escape/arrow handling, single activation,
checkbox/radio states, Tab/Shift+Tab exit, formatting a selected range and undo,
pointer selection, dialogs, the hidden-toolbar button, toolbar layout changes,
plugin removal, language changes, a 390px inline layout and RTL navigation.

For manual verification, use F10 or Tab to enter the application menu, then
navigate Format → AV Script and the plugin menus without a pointer. Check focus
visibility in light and dark themes, and repeat with hidden toolbars. Screen
readers should announce the menu name, expanded/collapsed state, disabled items
and checked/unchecked options. Test touch/hover switching after keyboard use.

Chromium checks do not replace physical WebView or screen-reader testing.
VoiceOver on macOS/iOS and NVDA on Windows remain manual validation; no physical
Mac or iPhone was available for this change.
