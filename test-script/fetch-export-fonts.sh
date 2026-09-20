#!/usr/bin/env bash
#
# Rebuild the PDF export fallback fonts in frontend/public/fonts.
#
# Why these exist
# ---------------
# jsPDF draws in the PDF Standard 14 faces, which are WinAnsi-encoded: outside
# that repertoire there is no byte to write, and a script that reaches one
# comes out of the exporter mangled or blank.  The fix is a real embedded font
# per script, and `src/utils/pdfUnicodeFont.ts` decides which one draws what.
#
# Every face here is a *subset*: cut to the blocks its script needs, with
# hinting dropped (these glyphs are only ever embedded in a PDF, never
# rasterised on screen) and — for the Indic faces — GSUB/GPOS dropped too.
# That last one is what takes Devanagari from 159 kB a weight to 16 kB.  It is
# not a saving so much as an acknowledgement: jsPDF addresses a font through
# its `cmap`, one character to one glyph, so a conjunct glyph has no character
# to be looked up by and could never be drawn however large the file was.  See
# frontend/public/fonts/README.md for what closing that gap would take.
#
# The ranges here are the source of truth for the ones repeated in
# pdfUnicodeFont.ts.  Change one, change the other, or a face will be asked to
# draw a character its subset does not carry.
#
# CJK is deliberately absent: Noto Sans SC/TC/JP/KR are 5–10 MB apiece, far too
# large to ship in a mobile bundle, and they cannot be subset ahead of time
# because which hanzi a screenplay uses is not known until it is exported.
# Those are fetched at export time instead — see REMOTE_FACES in
# pdfUnicodeFont.ts.
#
#   ./test-script/fetch-export-fonts.sh            # all faces
#   ./test-script/fetch-export-fonts.sh Tamil Thai # just these
#
# Needs python3 with fontTools (`pip install fonttools`) and a network.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="$root/frontend/public/fonts"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# The Google Fonts CSS API serves woff2 to anything that advertises support for
# it, and jsPDF cannot parse woff2.  A bare UA gets TrueType instead.
UA="Mozilla/5.0"

# family | file prefix | unicode ranges
#
# U+0020 and U+00A0 are in every range so a line in that script keeps its own
# word spacing rather than dropping back to Courier's cell between words, and
# U+25CC (dotted circle) so a matra with no consonant still shows something.
FACES=(
  "Noto Sans Thai|NotoSansThai|U+0E00-0E7F,U+0020,U+00A0,U+25CC"
  "Noto Sans Tamil|NotoSansTamil|U+0B80-0BFF,U+200C-200D,U+0020,U+00A0,U+25CC"
  "Noto Sans Bengali|NotoSansBengali|U+0980-09FF,U+200C-200D,U+20B9,U+0020,U+00A0,U+25CC"
  "Noto Sans Gujarati|NotoSansGujarati|U+0A80-0AFF,U+200C-200D,U+20B9,U+0020,U+00A0,U+25CC"
  "Noto Sans Gurmukhi|NotoSansGurmukhi|U+0A00-0A7F,U+200C-200D,U+20B9,U+0020,U+00A0,U+25CC"
  "Noto Sans Kannada|NotoSansKannada|U+0C80-0CFF,U+200C-200D,U+20B9,U+0020,U+00A0,U+25CC"
  "Noto Sans Malayalam|NotoSansMalayalam|U+0D00-0D7F,U+200C-200D,U+20B9,U+0020,U+00A0,U+25CC"
  "Noto Sans Oriya|NotoSansOriya|U+0B00-0B7F,U+200C-200D,U+20B9,U+0020,U+00A0,U+25CC"
  "Noto Sans Telugu|NotoSansTelugu|U+0C00-0C7F,U+200C-200D,U+20B9,U+0020,U+00A0,U+25CC"
  "Noto Sans Sinhala|NotoSansSinhala|U+0D80-0DFF,U+200C-200D,U+0020,U+00A0,U+25CC"
)

# Hebrew and Arabic are deliberately not here yet, though both subset cleanly
# (14 kB and 35 kB a weight).  A font is not what those scripts are waiting on:
# they are right-to-left, and text stored in logical order and drawn left to
# right comes out reversed — a worse failure than the blank page, because it
# looks like text.  They need the Unicode bidirectional algorithm applied at
# the line level, above the per-face splitting this module does, and Arabic
# needs its letters substituted for the joined forms in Presentation Forms-B
# as well.  Restore these two lines when that work is taken on:
#
#   "Noto Sans Hebrew|NotoSansHebrew|U+0590-05FF,U+FB1D-FB4F,U+200E-200F,U+0020,U+00A0"
#   "Noto Sans Arabic|NotoSansArabic|U+0600-06FF,U+0750-077F,U+FE70-FEFF,U+200E-200F,U+0020,U+00A0"

want=("$@")
wanted() {
  [[ ${#want[@]} -eq 0 ]] && return 0
  local needle="$1" w
  for w in "${want[@]}"; do [[ "$needle" == *"$w"* ]] && return 0; done
  return 1
}

for face in "${FACES[@]}"; do
  IFS='|' read -r family prefix ranges <<<"$face"
  wanted "$prefix" || continue

  for weight in 400:Regular 700:Bold; do
    css_weight="${weight%%:*}"
    name="${weight##*:}"
    query="${family// /+}:wght@${css_weight}"

    url="$(curl -sS --max-time 60 -A "$UA" \
      "https://fonts.googleapis.com/css2?family=${query}" \
      | grep -o 'https://fonts.gstatic.com[^)]*' | head -1)"
    if [[ -z "$url" ]]; then
      echo "!! no TrueType source for $family $name" >&2
      exit 1
    fi

    raw="$work/$prefix-$name.raw.ttf"
    curl -sS --max-time 120 -o "$raw" "$url"

    # Every face drops GSUB/GPOS.  Arabic can because its joined forms are
    # substituted as Presentation Forms-B, which are real characters the cmap
    # reaches; Hebrew because unpointed Hebrew asks for no substitution at all.
    features=""

    python3 -m fontTools.subset "$raw" \
      --unicodes="$ranges" \
      --layout-features="$features" \
      --no-hinting \
      --output-file="$out/$prefix-$name.ttf"

    printf '%-28s %-8s %8s bytes\n' "$family" "$name" \
      "$(stat -c%s "$out/$prefix-$name.ttf" 2>/dev/null || stat -f%z "$out/$prefix-$name.ttf")"
  done
done

echo
echo "Written to $out — the coverage ranges above must match pdfUnicodeFont.ts."
