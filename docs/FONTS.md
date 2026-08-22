# Fonts

OpenDraft ships a large font library, works with the fonts already on your
machine, and lets you install your own TrueType and OpenType files. Courier
12 pt remains the default for screenplay text — everything here is about what
you can reach for when you want something else.

## The library

The picker (toolbar, **Format → Font…**, and the formatting-template editor)
groups fonts by what they are:

| Group | What's in it |
|---|---|
| **Custom Fonts** | TTF/OTF files you installed yourself |
| **Screenplay Standard** | Courier Prime, Courier New, Courier, Arial, and the Couriers Final Draft installs |
| **Typewriter** | Special Elite, Cutive Mono, Xanh Mono, VT323 and other typed-page faces |
| **Serif** | Times New Roman, Georgia, EB Garamond, Merriweather, Playfair Display, … |
| **Sans Serif** | Helvetica, Calibri, Segoe UI, Open Sans, Montserrat, Inter, … |
| **Monospace** | Consolas, Menlo, Roboto Mono, IBM Plex Mono, JetBrains Mono, … |
| **Display & Titles** | Bebas Neue, Cinzel, Abril Fatface, Orbitron, Rye, Creepster, … |
| **Handwriting** | Caveat, Permanent Marker, Great Vibes, Rock Salt, … |
| **Latin Extended**, **Indian / Indic**, **Arabic & Hebrew**, **CJK**, **Other** | Noto families covering Cyrillic, Greek, Devanagari, Bengali, Tamil, Arabic, Hebrew, Japanese, Chinese, Korean, Thai and more |
| **On This Device** | Fonts found installed on this machine |

The list is searchable and every entry is drawn in its own face, so you can see
what you are choosing. Web-hosted families are fetched only as you scroll past
them, so opening the picker does not download a hundred fonts.

Where a font comes from is recorded in `frontend/src/utils/fonts.ts`:

- `local` — bundled with the app (Courier Prime). Always available, online or
  not.
- `system` — expected from the operating system. Availability is measured, not
  assumed; a face this platform hasn't got is greyed out and marked *not
  installed*.
- `google` — fetched from Google Fonts on first use. Needs a network the first
  time; after that the browser cache serves it.
- `device` — found installed on this machine.
- `custom` — a font file you added.

## Using fonts already on your device

**Format → Fonts…** has a button for this.

- On Chromium-based browsers (and the Windows/Linux desktop builds) OpenDraft
  can ask the browser for the machine's whole font book, with your permission.
  Every family it reports becomes selectable.
- Everywhere else — Safari, and the WebKit views the macOS and iOS builds use —
  there is no such API, so OpenDraft measures a list of common Word, Final Draft
  and OS faces (including the ones iPadOS ships) to see which are really
  installed. This runs automatically at startup.
- A font that list doesn't know about — one installed on iPadOS through a font
  app or a configuration profile — can be added by name in the same dialog.
  OpenDraft checks the device can actually render it before adding it, and
  remembers the name, so it only has to be typed once. This is the only way to
  reach such a font: no web API can enumerate them.

## Installing your own fonts

**Format → Fonts…** → *Choose Font Files…*. TTF, OTF, TTC, WOFF and WOFF2 are
accepted, up to 20 MB each. On desktop and on the web you can also drop files
onto the dialog.

Each platform reaches its picker a different way, and `pickFontFiles()` in
`frontend/src/utils/fileOps.ts` is where that lives:

| Platform | How the files are chosen |
|---|---|
| macOS / Windows / Linux desktop | The native dialog (`@tauri-apps/plugin-dialog`), read back through the `read_binary_file` command. A `<input type="file">` gets no usable panel from a `tauri://` page. |
| iPadOS / iOS | A file input with **no** `accept` — iOS maps `accept` through UTIs, and an extension list leaves every font greyed out in the Files picker. |
| Android | `ACTION_OPEN_DOCUMENT` with `*/*`, read back through ContentResolver (`android_pick_file` → `read_content_uri_bytes`). One file at a time, which is what the intent offers. |
| Web browser | A filtered, multi-select file input. |

Drag-and-drop follows the same split: on desktop the webview swallows OS file
drops, so the paths arrive via the editor's native drag-drop listener and are
read with `read_binary_file`; in a browser the ordinary `drop` event carries the
files; on iPadOS and Android there is nothing to drop, so the drop zone is not
shown.

- The family name is read from the font file itself, not from the filename, so
  `SourceSerif4-Semibold.otf` installs as *Source Serif 4* and groups with its
  other weights.
- Add each weight as its own file to get real bold and italic rather than the
  browser's synthesised ones.
- Fonts are stored in the browser's IndexedDB, per device. They survive
  restarts; they do not sync between devices.
- Because OpenDraft holds the actual bytes, an installed font is **embedded in
  exported PDFs** — a title page set in your own font comes out of the PDF
  looking like the one on screen. Google-hosted and system fonts cannot be
  embedded and are approximated by the closest PDF Standard 14 face.

## Opening a script somewhere the font isn't installed

A document records the *name* of the font each run is set in — nothing more.
That is what makes a script portable: open it on a machine where the font
exists and it renders in that font; open it anywhere else and the name is still
there, so it comes back the moment you return to a machine that has it.

In between, OpenDraft substitutes by kind rather than dropping everything to
Courier. Each family in the registry is classified `monospace`, `serif`,
`sans-serif`, `cursive` or `fantasy`, and `fontStack()` in
`frontend/src/utils/fonts.ts` turns a family name into a CSS stack ending in
that generic:

```
Playfair Display  →  'Playfair Display', 'Times New Roman', Times, serif
Bebas Neue        →  'Bebas Neue', Arial, Helvetica, sans-serif
Courier Prime     →  'Courier Prime', 'Courier New', Courier, monospace
```

A family OpenDraft has never heard of — imported from Final Draft, Fade In or
Word — is classified from its name, and falls back to Courier when that gives no
answer, which is how OpenDraft has always rendered unknown fonts.

The same stacks are used for the page font, for formatting-template rules, and
for individual runs, so all three behave the same way.

## Adding a font to the built-in library

Add an entry to `FONT_REGISTRY` in `frontend/src/utils/fonts.ts`:

```ts
web('Libre Caslon Text', 'Serif', 'serif', { axes: ROMAN_AND_ITALIC }),
```

- The name must match the Google Fonts family name exactly.
- `axes` requests real bold and italic cuts. If the family hasn't got them
  Google answers 404 and the stylesheet is silently retried without the axes,
  so a wrong guess costs a request, not a broken font.
- `generic` decides both the fallback stack and which PDF Standard 14 face the
  exporter approximates it with.

`frontend/src/utils/fonts.test.ts` checks that names are unique, that every
entry is filed under a declared category, and that the fallback stacks come out
right.
