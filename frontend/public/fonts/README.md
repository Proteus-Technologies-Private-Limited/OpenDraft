# Bundled fonts

## Courier Prime

The screenplay face, shown in the editor and named in exported DOCX files.
SIL Open Font License 1.1 — <https://quoteunquoteapps.com/courierprime/>.

## DejaVu Sans Mono

The PDF export fallback. jsPDF's built-in faces are the PDF Standard 14, which
are WinAnsi-encoded and so cannot write a single Cyrillic, Greek, Armenian or
Georgian character; text that needs one of those is drawn in this face instead
(see `src/utils/pdfUnicodeFont.ts`). It is monospaced at the same 0.6em cell as
Courier, so the Final Draft page geometry is unchanged by the substitution.

These files are **subsets** of DejaVu Sans Mono 2.37, cut down from ~1.2 MB to
~370 kB because only the PDF exporter reads them and a screenplay never needs
the box-drawing or maths blocks. Regenerate them with
[fontTools](https://github.com/fonttools/fonttools):

```sh
RANGES="U+0000-024F,U+0250-02AF,U+02B0-02FF,U+0370-03FF,U+0400-052F,U+0530-058F,\
U+10A0-10FF,U+1E00-1EFF,U+2000-206F,U+20A0-20BF,U+2100-214F,U+2190-2193,U+2212"

for pair in "DejaVuSansMono:Regular" "DejaVuSansMono-Bold:Bold" \
            "DejaVuSansMono-Oblique:Italic" "DejaVuSansMono-BoldOblique:BoldItalic"; do
  python3 -m fontTools.subset "${pair%%:*}.ttf" \
    --unicodes="$RANGES" --layout-features='*' --no-hinting \
    --output-file="DejaVuSansMono-${pair##*:}.ttf"
done
```

Hinting is dropped because these glyphs are only ever embedded in a PDF, never
rasterised on screen. The kept blocks are Latin (with Extended-A/B/Additional),
IPA, Greek, Cyrillic, Armenian, Georgian, punctuation, currency and letterlike
symbols — everything DejaVu Sans Mono covers that a screenplay is likely to
use. It has no Hebrew, Devanagari or CJK, and its Arabic is unshaped, so those
scripts are still beyond PDF export.

Upstream: <https://dejavu-fonts.github.io/> — Bitstream Vera license, see
`LICENSE-DejaVu.txt`. The license permits subsetting; the family name is
unchanged and carries neither "Bitstream" nor "Vera".
