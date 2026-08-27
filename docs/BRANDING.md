# OpenDraft Branding

The logo is a fountain pen nib whose body opens into three feather planes — a pen
that takes flight. It replaced an earlier full-colour illustration that carried a
flock of birds, film strips, a painterly background and baked-in text, none of
which survived below about 128px.

## Source of truth

Everything ships from `images/brand/`. These SVGs are the only hand-maintained
logo files; every PNG, ICO and ICNS in the repo is generated from them.

| File | What it is |
|------|------------|
| `opendraft-mark.svg` | Full-colour mark, transparent, tight bounding box |
| `opendraft-mark-mono.svg` | Single colour via `currentColor` — for monochrome, engraving, stamps |
| `opendraft-mark-white.svg` | Flat white, for dark surfaces |
| `opendraft-icon.svg` | 1024 square plate: brand gradient + white mark. The app icon everywhere except macOS |
| `opendraft-icon-macos.svg` | 1024 canvas with an inset squircle plate, as macOS expects |
| `opendraft-icon-plate.svg` | The gradient plate alone, no mark — the Android adaptive background layer |
| `opendraft-icon-android-foreground.svg` | 432 canvas, white mark inside the 66% adaptive safe zone |
| `opendraft-lockup-horizontal.svg` | Mark and wordmark side by side |
| `opendraft-lockup-stacked.svg` | Mark above the wordmark |
| `opendraft-lockup-*-mono.svg` | Both lockups in a single `currentColor` |

## Wordmark

"OpenDraft" is set in **Figtree SemiBold** and converted to outline paths, so the
lockup SVGs carry no font dependency and render identically everywhere. Figtree
is SIL Open Font Licensed with **no Reserved Font Name**, which is what makes
shipping its outlines from an MIT repo clean; the licence travels with them in
`images/brand/FONT-LICENSE.txt`. Set any new wordmark text in Figtree SemiBold
to match.

Proportions come from the brand sheet, expressed against the mark's height:

| | Cap height | Gap | Alignment |
|---|---|---|---|
| Horizontal | 0.34 | 0.152 | Cap-height box centred on the mark, nudged 6.2% down |
| Stacked | 0.207 | 0.03 | Both centred on their own bounding boxes |

Regenerate the lockups (needs a one-off network fetch for the font):

```bash
./venv/bin/python test-script/generate_lockups.py
```

## Palette

| Swatch | Hex | Role |
|--------|-----|------|
| Indigo | `#2B2A86` | Primary. The nib, wordmark, and flat fallback background |
| Purple | `#5D3FB3` | Blade transition |
| Pink | `#E35CA7` | Lower blade tip |
| Orange | `#FF8A1F` | Middle blade tip |
| Teal | `#22B8C5` | Upper blade tip |

## Regenerating every raster

```bash
./venv/bin/python test-script/generate_brand_assets.py
```

That rewrites over a hundred files: `src-tauri/icons/` (including `icon.ico` and
`icon.icns`), both Android icon trees, `images/ios-icons/`, the Xcode asset
catalogue at `src-tauri/gen/apple/Assets.xcassets/`, the favicons and splash logo
under `frontend/public/` and `backend/static/`, the Vite-bundled copies in
`frontend/src/assets/`, and the marketing images in `images/`.

Note that `src-tauri/gen/apple/` is **tracked**, unlike `src-tauri/gen/android/`.
The `AppIcon.appiconset` there is what actually compiles into the iOS app, so
updating `images/ios-icons/` alone leaves the shipped icon stale.

The Play Store feature graphic is a separate composition and is built after:

```bash
./venv/bin/python test-script/generate_feature_graphic.py
cp test-script/output/feature_graphic_1024x500.png images/feature_graphic_1024x500.png
cp test-script/output/feature_graphic_1024x500.png fastlane/metadata/android/en-US/images/featureGraphic.png
```

## Platform notes

- **iOS** icons are flattened to RGB. App Store Connect rejects an app icon that
  carries an alpha channel.
- **Android** uses an adaptive icon: the plate is the background layer and the
  white mark the foreground layer. The mark must never appear in both, and it is
  sized to the central 66% because launchers crop and animate the two layers
  independently.
- **macOS** gets the squircle variant for `icon.icns` only. Windows and Linux use
  the full-bleed square, which is what their shells expect.
- **Favicons** are SVG first with an ICO fallback, declared in
  `frontend/index.html`.

## Usage

Give the mark clear space of at least one nib-width on every side. Don't recolour
the blades, rotate it, add effects, or set the wordmark in a face other than a
geometric sans. Below 32px prefer the plate icon over the transparent mark — the
white-on-gradient version holds together where the coloured blades stop
separating.
