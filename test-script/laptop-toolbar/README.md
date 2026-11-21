# Laptop toolbar browser checks (WP10)

Start Vite and run:

```sh
OPENDRAFT_TEST_URL=http://127.0.0.1:5173/ python test-script/laptop-toolbar/regressions.py
```

Requires Python Playwright 1.62 and Chromium. `OPENDRAFT_CHROMIUM` selects an
executable; otherwise the shared fold fixture uses system or bundled Chromium.
The accessibility workflow runs these CDP checks in its Chromium job, alongside
the ordinary Chromium/WebKit controls and menu checks.

Uses synthetic text, actual Chromium CDP posture overrides and a synthetic
keyboard-geometry bridge. Covers above/below-crease placement, panel space,
customized controls/order, font and element choice semantics/focus, narrow
screen overflow/nested pickers, colors, Views, RTL, axe and posture changes.
No physical foldable, native IME, touch or screen-reader result is claimed.
Actual keyboard placement still needs device validation.
