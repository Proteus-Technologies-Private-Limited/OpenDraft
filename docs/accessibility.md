# Keyboard and accessibility foundations

OpenDraft's interface supports keyboard operation without a foldable, Apple
device, microphone, or another person. This document describes the implemented
behavior and the automated checks; it is not a claim of complete WCAG or
screen-reader conformance.

## Using the interface

- Custom modal overlays have an accessible name, contain Tab/Shift+Tab focus,
  and make the background inert and hidden from the accessibility tree. Existing
  autofocus choices are preserved; otherwise focus starts on the dialog title.
  Escape uses the existing dismissal handler, including busy and mandatory-choice
  guards. Closing returns focus when the command has not deliberately moved it
  elsewhere. Nested dialogs restore their parent's scope. Native dialogs keep
  browser modality and participate in the same popup/notification layering.
- Grammar tabs use Left/Right, Home and End; directions mirror in RTL. Plugin
  tabs use Up/Down, Home and End. Enter/Space selects a plugin tab; the close
  button collapses it. Tabs reference labelled panels, including inactive shells
  for lazily rendered plugin content. Removal of a focused plugin returns focus
  to a surviving tab, or the editor if none remain. The existing foldable dock
  continues moving its stable portal hosts without remounting panel content.
- Focusable sidebar splitters support Left/Right in 10-pixel steps, Home for
  minimum width, and End for maximum width. Their ARIA values match pointer
  limits and directions mirror with the interface.
- Formatting controls have a translated group name and retain normal Tab order.
  Text fields and comboboxes need their editing keys, so the mixed control strip
  is deliberately a `group`, rather than claiming the APG composite `toolbar`
  role with an incompatible arrow-key model. Formatting toggles expose their
  pressed state. The screenplay has a translated multiline textbox name.
- Select and font popups expose the active option without moving DOM focus out
  of their combobox. Escape cancels the popup first. Font search retains native
  text editing keys and IME composition. Color pickers have names, keyboard
  entry, validation, and Escape/return focus. Icon controls retain their translated
  titles and native button semantics. Zoom values are keyboard-editable buttons;
  Enter/Escape returns focus after committing/cancelling an edit. The floating
  zoom palette has named controls and Escape/return focus.
- Explicit operation feedback uses polite status messages; failures use alerts.
  Toast messages stay until dismissed and can be dismissed with a keyboard,
  without an arrival moving focus. Persistent live-region hosts move into modal
  scopes without remounting, including native top-layer dialogs. Dictionary
  installation announces start/completion and exposes failures as alerts. The
  editor's per-keystroke word counts and autosave cycles are not live regions.
- Focus rings remain visible, forced colors retain control boundaries and
  selected states, and reduced motion suppresses interface animation. Browser
  zoom is permitted by the viewport metadata. Contrast corrections cover the
  audited editor, dialog buttons, selected options and grammar severity badges.

## Automated verification

From the repository root, install frontend dependencies and Python Playwright,
then run Vite in a separate terminal:

```sh
npm ci --prefix frontend
python -m pip install playwright==1.62.0
python -m playwright install chromium
npm run dev --prefix frontend -- --host 127.0.0.1 --port 5173
```

Run the browser checks:

```sh
OPENDRAFT_TEST_URL=http://127.0.0.1:5173/ python test-script/accessibility/regressions.py
```

`OPENDRAFT_CHROMIUM` optionally selects a Chromium executable. Otherwise the
suite uses system Chromium when available, then Playwright's bundled Chromium.
All script text and notifications are synthetic. `OPENDRAFT_A11Y_OUTPUT` selects
the directory for axe JSON evidence; the default is a temporary directory.

The suite uses real Chromium keyboard events and pinned axe-core 4.14.0 with
WCAG 2 A/AA, 2.1 AA and 2.2 AA tags. It audits defined editor/dialog/popup states,
including light/dark editor themes, Page Setup, Header & Footer, Diagnostics,
grammar tabs, reports, Script Health, font/color popups and feedback. Additional
checks cover nested scopes, unavailable native `inert`, busy dismissal guards,
active-descendant targets, splitter values, plugin removal, reduced motion and
forced colors. The 200% reflow check uses CSS zoom; it does not claim browser-UI
zoom or physical-device validation. Existing menu and foldable browser suites
provide the integration coverage for their own interactions.

The accessibility workflow runs without device credentials. An axe pass does
not establish speech output, braille behavior, native WebView compatibility,
every possible document/theme state, or full WCAG conformance. Actual assistive
technology interoperability remains a separate validation activity and is not
required to run these regressions.

## WAI-ARIA sources

The implementation was checked against the official repositories rather than
adding ARIA roles without their required behavior:

- [w3c/aria](https://github.com/w3c/aria): normative roles, states and properties.
- [w3c/aria-practices](https://github.com/w3c/aria-practices):
  [modal dialog](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/),
  [tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/),
  [combobox](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/) and
  [toolbar](https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/) guidance.
- [w3c-cg/aria-at](https://github.com/w3c-cg/aria-at): assistive-technology
  interoperability tests. Its initial scope is manual testing of desktop screen
  readers, so those results are kept separate from these browser checks.
- [axe-core](https://github.com/dequelabs/axe-core): automated rules, with the
  limits above. No screen-reader test result is inferred from an axe result.
