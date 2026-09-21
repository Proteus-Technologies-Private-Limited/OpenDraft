/**
 * Naming a face Word can actually draw the run in.
 *
 * Word does not give a run one font. It gives it four, and picks between them
 * per character: `w:ascii` for ASCII, `w:hAnsi` for the rest of Latin, `w:cs`
 * for the complex scripts — Devanagari and the other Brahmic ones, Arabic,
 * Hebrew, Thai — and `w:eastAsia` for CJK. Writing the document's family into
 * all four, which is what a single `font: 'Courier Prime'` does, tells Word
 * that the Hindi in the script is set in Courier Prime. Courier Prime has no
 * Devanagari; neither has Roboto, nor Times New Roman. The dialogue is drawn
 * in a face that has nothing to draw it with and the writer gets a page with
 * their Hindi missing from it.
 *
 * So the run's own family keeps `ascii` and `hAnsi`, and `cs`/`eastAsia` are
 * given a family that can write what is actually in the text. Because Word
 * chooses per character rather than per run, a line that mixes the two — «एक
 * लेखक CUT TO: टाइप» — needs no splitting: the Latin follows `ascii` and the
 * Devanagari follows `cs`, inside one run.
 *
 * This is the DOCX half of what `pdfUnicodeFont` does for PDF, and it is the
 * easier half: a PDF has to carry the glyphs, so that module embeds a subset
 * of a bundled file, while a DOCX only has to name the family and leave Word
 * to find it. The two therefore differ in what happens on a machine without
 * the face — the PDF always draws, the DOCX asks Word to substitute — but
 * Word substituting for a Devanagari family it hasn't got reaches a Devanagari
 * face, which is the whole difference from naming a Latin one.
 *
 * Nothing is overridden that might be right. A family the registry describes
 * is taken at its word about the scripts it covers; one it does not — a font
 * the writer installed, or found on this machine — is left alone, because its
 * `scripts` is a placeholder rather than a claim and a writer who chose their
 * own Devanagari font meant it.
 */
import type { IFontAttributesProperties } from 'docx';
import { findFont } from './fonts';

/** A half-open range of code points, inclusive at both ends. */
type Range = readonly [number, number];

function inRanges(codePoint: number, ranges: readonly Range[]): boolean {
  for (const [lo, hi] of ranges) {
    if (codePoint >= lo && codePoint <= hi) return true;
  }
  return false;
}

/** One script Word will not draw in the document's Latin face. */
interface ComplexScript {
  /** The tag `fonts.ts` files a family's coverage under; the two must agree. */
  tag: string;
  ranges: readonly Range[];
  /** The family to name when the document's own cannot write this script. */
  face: string;
}

/**
 * The scripts with an export face, in the order a run is searched.
 *
 * The same set `pdfUnicodeFont` carries a font file for, plus the three the
 * editor offers a family for but the PDF has no bundled subset of — Khmer, Lao
 * and Myanmar. A DOCX costs nothing to name a family it does not ship, so
 * there is no reason to leave those to a face that cannot write them either.
 *
 * Only one of these can win: Word has a single `w:cs` slot per run, so a run
 * mixing two complex scripts gets the first one found. Runs are split by
 * styling rather than by script, but a screenplay that changes script mid-run
 * without changing anything else about it is rare enough to leave.
 */
const COMPLEX_SCRIPTS: readonly ComplexScript[] = [
  { tag: 'devanagari', ranges: [[0x0900, 0x097f]], face: 'Noto Sans Devanagari' },
  { tag: 'bengali', ranges: [[0x0980, 0x09ff]], face: 'Noto Sans Bengali' },
  { tag: 'gurmukhi', ranges: [[0x0a00, 0x0a7f]], face: 'Noto Sans Gurmukhi' },
  { tag: 'gujarati', ranges: [[0x0a80, 0x0aff]], face: 'Noto Sans Gujarati' },
  { tag: 'oriya', ranges: [[0x0b00, 0x0b7f]], face: 'Noto Sans Oriya' },
  { tag: 'tamil', ranges: [[0x0b80, 0x0bff]], face: 'Noto Sans Tamil' },
  { tag: 'telugu', ranges: [[0x0c00, 0x0c7f]], face: 'Noto Sans Telugu' },
  { tag: 'kannada', ranges: [[0x0c80, 0x0cff]], face: 'Noto Sans Kannada' },
  { tag: 'malayalam', ranges: [[0x0d00, 0x0d7f]], face: 'Noto Sans Malayalam' },
  { tag: 'sinhala', ranges: [[0x0d80, 0x0dff]], face: 'Noto Sans Sinhala' },
  { tag: 'thai', ranges: [[0x0e00, 0x0e7f]], face: 'Noto Sans Thai' },
  { tag: 'lao', ranges: [[0x0e80, 0x0eff]], face: 'Noto Sans Lao' },
  { tag: 'myanmar', ranges: [[0x1000, 0x109f]], face: 'Noto Sans Myanmar' },
  { tag: 'khmer', ranges: [[0x1780, 0x17ff]], face: 'Noto Sans Khmer' },
  // Hebrew and Arabic carry their presentation blocks as well as their
  // letters, because an imported document may hold either.
  { tag: 'hebrew', ranges: [[0x0590, 0x05ff], [0xfb1d, 0xfb4f]], face: 'Noto Sans Hebrew' },
  {
    tag: 'arabic',
    ranges: [[0x0600, 0x06ff], [0x0750, 0x077f], [0x08a0, 0x08ff],
      [0xfb50, 0xfdff], [0xfe70, 0xfeff]],
    face: 'Noto Sans Arabic',
  },
];

/**
 * CJK, which unlike the scripts above cannot be read off one character.
 *
 * Han is written in Chinese, Japanese and Korean alike, so which family an
 * ideograph belongs to is a fact about the document rather than about the
 * character — the same reasoning as `pdfUnicodeFont`, and the same markers:
 * kana means Japanese, hangul means Korean, and Han on its own is taken as
 * Simplified Chinese.
 */
const HAN: readonly Range[] = [[0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xf900, 0xfaff],
  [0x3000, 0x303f], [0xff00, 0xffef]];
const KANA: readonly Range[] = [[0x3040, 0x30ff], [0x31f0, 0x31ff]];
const HANGUL: readonly Range[] = [[0x1100, 0x11ff], [0x3130, 0x318f], [0xac00, 0xd7af]];

/**
 * Whether a family is a CJK one at all.
 *
 * Coarser than the per-script question asked of the others, and deliberately:
 * all four CJK families carry both Chinese character sets, so a writer who
 * chose Noto Sans JP has a face that can draw the Han in front of it whatever
 * the markers say the document is. Asking whether that family declares
 * `cjk-zh-hans` would move a Japanese script into a Chinese face.
 */
function isCjkFamily(family: string): boolean {
  const entry = findFont(family);
  return !!entry && entry.scripts.some((tag) => tag.startsWith('cjk'));
}

function firstComplexScript(text: string): ComplexScript | undefined {
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    // Every one of these blocks is above Latin-1; skipping there keeps an
    // English screenplay — the overwhelming majority — off the table entirely.
    if (cp < 0x0590) continue;
    const found = COMPLEX_SCRIPTS.find((script) => inRanges(cp, script.ranges));
    if (found) return found;
  }
  return undefined;
}

/** The CJK family this text is written in, or nothing when it holds no CJK. */
function cjkFace(text: string): string | undefined {
  let han = false;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x1100) continue;
    if (inRanges(cp, KANA)) return 'Noto Sans JP';
    if (inRanges(cp, HANGUL)) return 'Noto Sans KR';
    if (inRanges(cp, HAN)) han = true;
  }
  return han ? 'Noto Sans SC' : undefined;
}

/**
 * Whether `family` can be relied on to write this script.
 *
 * True for anything the registry does not describe: see the note at the top
 * about fonts the writer installed.
 */
function covers(family: string, tag: string): boolean {
  if (isWriterOwn(family)) return true;
  return findFont(family)!.scripts.includes(tag);
}

/**
 * Whether this family is one the registry does not describe — a font the
 * writer installed, one found on the machine, or a name carried in from
 * another program. Its coverage is unknown rather than absent, so it is left
 * to write whatever it was chosen to write.
 */
function isWriterOwn(family: string): boolean {
  const entry = findFont(family);
  return !entry || entry.source === 'custom' || entry.source === 'device';
}

/**
 * The `font` to give a `TextRun` holding `text`, written in `family`.
 *
 * A plain string — exactly what was passed before this module existed — unless
 * the text holds a script `family` cannot write, which is the only case that
 * produces the four-attribute form. Latin output is therefore unchanged, byte
 * for byte.
 */
export function runFont(
  text: string,
  family: string,
): string | IFontAttributesProperties {
  if (!text) return family;

  const complex = firstComplexScript(text);
  const cs = complex && !covers(family, complex.tag) ? complex.face : undefined;

  const wantedCjk = cjkFace(text);
  const eastAsia = wantedCjk && !isCjkFamily(family) && !isWriterOwn(family)
    ? wantedCjk
    : undefined;

  if (!cs && !eastAsia) return family;
  return {
    ascii: family,
    hAnsi: family,
    cs: cs ?? family,
    eastAsia: eastAsia ?? family,
  };
}
