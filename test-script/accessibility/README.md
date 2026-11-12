# Accessibility browser regressions

See [the accessibility behavior and validation guide](../../docs/accessibility.md)
for setup, coverage, W3C references and the limits of automated evidence.

The shared bootstrap comes from the existing menu regression fixture; only this
suite's test methods run. Tests require Vite and Chromium, not native devices,
speech assets, or a screen reader. They never save or upload user documents.
