# PDF export fonts

jsPDF's built-in faces (Courier, Helvetica, Times) can only write WinAnsi. Every
other character is routed, per character, to a font that is embedded in the PDF.
`frontend/src/utils/pdfUnicodeFont.ts` owns the routing; `pdfExporter.ts` calls it.

## Order of preference

1. **The writer's own installed font**, when they chose one (`pdfCustomFonts.ts`).
2. **A bundled or fetched Noto/DejaVu/Courier Prime/Cousine face** for the script
   (the `FALLBACKS` table, narrowest coverage first).
3. **An installed system font** — desktop app only — for characters no face above
   covers: symbols, arrows, emoji, rare scripts (`systemFonts.ts` →
   `src-tauri/src/system_fonts.rs`). Only single-face TrueType files can be
   embedded by jsPDF, so macOS's TTC/CFF fonts (e.g. its Devanagari) are skipped.
4. Otherwise the script is **named in a warning** and drawn blank
   (`unsupportedScripts`). Syriac, Thaana, N'Ko and Mongolian are here: they are
   right-to-left joined or vertical and need shaping that is not wired up.

## Rules that keep a line looking like one font

- A line one embedded face can write end to end is drawn in it whole
  (`segmentByFace`), so Latin words are not handed to the document face in the
  middle of a Cyrillic or Polish sentence.
- Courier text in a document that needs Latin Extended is drawn in Courier Prime
  (or Cousine, for Vietnamese) throughout, not just at the accented letters.
- Faces that are not on the Final Draft cell (all Noto) are measured; faces that
  are (Courier Prime, Cousine, DejaVu) are stretched to it, so line breaks do
  not move.

## File size

Fetched faces (CJK 5–15 MB, Ethiopic, Cherokee) and system fonts are cut down to
the characters the document draws with HarfBuzz's subsetter (`fontSubset.ts`),
so a Chinese script is tens of kB, not megabytes. Bundled shaped/RTL faces are
embedded whole: their text is rewritten after the document is collected (joined
Arabic forms, Indic reordering), so a subset built from the typed text would
miss glyphs.

## Adding a script

1. Add the font file (or a pinned URL) and a `FALLBACKS` entry with its Unicode
   ranges and, if it needs shaping, its ISO 15924 tag.
2. Remove it from `UNSUPPORTED_SCRIPTS`.
3. Add a sentence to `pdfUnicodeFont.coverage.test.ts`. It fails if a character
   has no face, or if a bundled font's glyph table lacks it.
4. Add the script's name under `pdfFonts` in every `locales/*/messages.json`.

## Not done

Printing through the native webview (`WKWebView.createPDF`, WebView2) would give
every script for free, but cannot guarantee Final Draft's character grid and
differs per platform, so it is not the exporter.

A document mixing Japanese and Korean draws one CJK family for the whole file
(chosen by kana/hangul), so the other language's glyphs are missing.
