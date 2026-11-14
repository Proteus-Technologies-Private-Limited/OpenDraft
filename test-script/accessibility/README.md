# Accessibility browser regressions

See [the accessibility behavior and validation guide](../../docs/accessibility.md)
for setup, coverage, W3C references and the limits of automated evidence.

The shared bootstrap comes from the existing menu regression fixture; only this
suite's test methods run. Tests require Vite and Chromium or Playwright WebKit, not native devices,
speech assets, or a screen reader. They never save or upload user documents.

The fixture reuses both the menu suite's `setUp` and its `start_page` loader.
Keep these together: `setUp` delegates to `self.start_page()`. The accessibility
class intentionally does not inherit the menu test class, so unittest collects
only accessibility cases here; the workflow runs the menu cases separately.

Use `OPENDRAFT_BROWSER=webkit` for Linux WebKit; the default remains Chromium.
The same 24 test methods run in both engines, including Settings, project
management and PDF import/export states. No axe rules are disabled; the existing
viewport restriction remains explicitly deferred in the complete reports.
The CI matrix runs this suite, the menu suite and the long-script suite on each
engine, plus the CDP-only plugin profile on Chromium.
