# Bundled fonts

## Courier Prime

The screenplay face, shown in the editor and named in exported DOCX files.
SIL Open Font License 1.1 — <https://quoteunquoteapps.com/courierprime/>.

## DejaVu Sans Mono

A PDF export fallback. jsPDF's built-in faces are the PDF Standard 14, which
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
symbols. It has no Hebrew or CJK and its Arabic is unshaped, so those scripts
are still beyond PDF export. Devanagari is covered by the face below.

The coverage ranges are repeated in `pdfUnicodeFont.ts`, which uses them to
decide what this face is asked to draw; re-subsetting to a different set of
blocks means changing them there too.

Upstream: <https://dejavu-fonts.github.io/> — Bitstream Vera license, see
`LICENSE-DejaVu.txt`. The license permits subsetting; the family name is
unchanged and carries neither "Bitstream" nor "Vera".

## Noto Sans Devanagari

The PDF export fallback for Devanagari — Hindi, Marathi, Nepali, Sanskrit
(issue #128). DejaVu has no Devanagari at all, so before this was bundled a
Hindi script reached a face with nothing to draw it with and came out of the
exporter **blank**: not mangled, absent.

It is the same family the editor already offers under *Indian / Indic*, so a
script written in it exports looking like the one on screen.

No monospaced Devanagari face exists — the script's conjuncts are too wide for
a fixed cell — so unlike DejaVu this one is drawn at its own advances. That is
safe for the page geometry: Devanagari at 12pt measures around 60% of the
Final Draft cell the layout reserved for the same number of characters, so a
line drawn in it finishes well inside the margins the script was paginated to,
and no page break moves.

These files are subsets of the `devanagari` cut Google Fonts serves, itself a
subset of Noto Sans Devanagari; 16 kB per weight. Only Regular and Bold are
bundled, because the family has no italic — `pdfUnicodeFont.ts` backs a style a
family hasn't got with its regular weight. Regenerate with fontTools:

```sh
RANGES="U+0900-097F,U+200C-200D,U+20B9,U+25CC,U+0020,U+00A0"

for pair in "NotoSansDevanagari-Regular:Regular" "NotoSansDevanagari-Bold:Bold"; do
  python3 -m fontTools.subset "${pair%%:*}.ttf" \
    --unicodes="$RANGES" --layout-features= --no-hinting \
    --output-file="NotoSansDevanagari-${pair##*:}.ttf"
done
```

Upstream: <https://github.com/notofonts/devanagari> — SIL Open Font License
1.1, see `LICENSE-Noto.txt`, which covers every Noto face here.

## The other Indic scripts, and Thai

Bengali, Gujarati, Gurmukhi, Kannada, Malayalam, Odia, Sinhala, Tamil, Telugu
and Thai, on exactly the same terms as Devanagari above: a Noto Sans subset cut
to the script's block, regular and bold, 12–28 kB a weight. Ten scripts for
around 400 kB in total, which is what dropping the layout features buys.

Cut them with `./test-script/fetch-export-fonts.sh`, which holds the ranges and
does every face in one pass. The same ranges are repeated in
`src/utils/pdfUnicodeFont.ts` and have to agree with it.

Nine of the ten need the vowel reordering in `src/utils/indic.ts` — the pre-base
sign is a different code point in each, and Tamil, Bengali, Malayalam, Odia and
Sinhala also have vowels written as one character and drawn as two, which are
split before the left half is moved. Telugu and Kannada draw no sign to the
left of its consonant and so pass through untouched. Thai needs no reordering
at all: it stores its pre-base vowels before the consonant already.

All ten are SIL Open Font License 1.1 — `LICENSE-Noto.txt`, which covers every
Noto face here.

## CJK — fetched, not bundled

Chinese, Japanese and Korean are **not** in this directory. Noto Sans SC, TC,
JP and KR are 5–10 MB apiece and no subset helps: which ideographs a screenplay
uses is not known until it is exported, so there is nothing to cut to. Shipping
even one would more than double the size of the app for every writer, almost
none of whom would ever draw a glyph from it.

They are fetched from Google's font CDN on first use instead, and kept in the
Cache API afterwards, so the download happens once per machine rather than once
per export. `pdfUnicodeFont.ts` holds the pinned URLs and
`./test-script/fetch-export-fonts.sh --cjk-urls` refreshes them.

Which of the four a document gets is decided by what is in it: kana means
Japanese, hangul means Korean, a handful of traditional-only characters mean
Traditional Chinese, and Han on its own is taken as Simplified. All four carry
both Chinese character sets, so a misread document is drawn in the other one's
glyph shapes rather than left blank.

Two consequences worth knowing:

- **A CJK export needs a network the first time.** Every other script here
  works offline, as they always have. When the fetch fails the export still
  happens and the writer is told which face is missing.
- **CJK is drawn double-width**, two cells of the Final Draft grid per
  character — `textColumns` in `src/utils/wrapText.ts` is what keeps a Chinese
  line inside the margin. Measured at 12pt, jsPDF gives exactly 12pt per
  character against the grid's 6.97pt, which is where that rule comes from.

What is not done is kinsoku shori: the rules that stop a line beginning with a
closing bracket or a full stop. Lines break at the margin wherever it falls.

## Hebrew and Arabic

Noto Sans Hebrew and Noto Sans Arabic, 10 kB and 49 kB a weight. Arabic's
subset is the larger because it carries the presentation-form blocks as well as
the letters, and that is not decoration: it is how the script gets drawn at all.

**Both are reordered before drawing.** They are written right to left and
stored in the order they are read, and jsPDF paints characters in the order it
is handed them, so שלום would go out as םולש. `src/utils/bidi.ts` runs the
Unicode bidirectional algorithm over each wrapped line first — via `bidi-js`,
which implements the whole of UAX #9 — so what reaches the drawing code is
already in the order it is painted.

**Arabic is also shaped.** Its letters take four different shapes depending on
what they join to, and an OpenType engine normally picks between them. There is
no OpenType engine here, so `src/utils/arabicShaping.ts` substitutes each letter
for the Presentation Forms character that *is* the shape it needs — a code
point the `cmap` can reach. The table is generated from Unicode's own
decomposition data, 76 letters, which is Arabic plus what Persian and Urdu add.
The one mandatory ligature, lam-alef, is substituted too; the decorative ones
are not.

Two things to know about the result:

- **The page is not mirrored.** Margins, indents and alignment stay where Final
  Draft puts them, so a Hebrew line reads correctly but starts at the left
  margin of its block rather than the right. A conventionally laid-out RTL
  screenplay reaches the editor and every other exporter, and is its own piece
  of work.
- **jsPDF has a bidi engine of its own**, which runs on every `text()` call. It
  reorders Arabic and ignores Hebrew, so left alone it reversed Arabic a second
  time and the two scripts contradicted each other. `pdfExporter.ts` passes
  `isInputVisual: false` to switch that half off, and
  `pdfExporter.rtl.test.ts` asserts the painted order end to end so a jsPDF
  upgrade cannot quietly undo it.

Mark positioning is left to the font's default anchors, since GPOS is as
unreachable as GSUB. Arabic screenplays are normally written without harakat.
