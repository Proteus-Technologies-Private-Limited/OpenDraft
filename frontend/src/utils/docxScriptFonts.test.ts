/**
 * The face a Word run is named in, per script.
 *
 * A DOCX that writes the document's family into all four `w:rFonts` slots
 * tells Word that the Hindi in the script is set in Courier Prime — a face
 * with no Devanagari in it — and the dialogue comes back missing from the
 * page. These check that the complex-script slot gets a family that can write
 * what is in the run, and that a Latin screenplay is left exactly as it was.
 *
 * @vitest-environment node
 */
import { describe, it, expect, afterEach } from 'vitest';
import { runFont } from './docxScriptFonts';
import { setDynamicFonts } from './fonts';

afterEach(() => {
  setDynamicFonts('custom', []);
  setDynamicFonts('device', []);
});

describe('a Latin run', () => {
  it('is named with a plain family, as it always was', () => {
    // Not the four-attribute form: an English screenplay's XML must not change
    // because this module exists.
    expect(runFont('INT. LIBRARY - DAY', 'Courier Prime')).toBe('Courier Prime');
  });

  it('is left alone for the scripts a Latin face does carry', () => {
    // Cyrillic and Greek are not complex scripts; Word draws them from hAnsi,
    // and DejaVu covers them in the PDF for the same reason.
    expect(runFont('Привет', 'Courier Prime')).toBe('Courier Prime');
    expect(runFont('Καλημέρα', 'Courier Prime')).toBe('Courier Prime');
  });

  it('keeps the family for empty text', () => {
    expect(runFont('', 'Roboto')).toBe('Roboto');
  });
});

describe('a Hindi run', () => {
  it('is drawn in a Devanagari face, not the document Latin one', () => {
    expect(runFont('जीवन से भरी', 'Courier Prime')).toEqual({
      ascii: 'Courier Prime',
      hAnsi: 'Courier Prime',
      cs: 'Noto Sans Devanagari',
      eastAsia: 'Courier Prime',
    });
  });

  it('is fixed for Roboto too — a Latin face is a Latin face', () => {
    expect(runFont('नमस्ते', 'Roboto')).toMatchObject({
      ascii: 'Roboto',
      cs: 'Noto Sans Devanagari',
    });
  });

  it('keeps the Latin half of a mixed run on the document face', () => {
    // Word chooses per character, not per run, so one run carries both: the
    // ASCII follows `ascii` and the Devanagari follows `cs`. Nothing has to be
    // split.
    expect(runFont('एक लेखक CUT TO: टाइप', 'Courier Prime')).toMatchObject({
      ascii: 'Courier Prime',
      hAnsi: 'Courier Prime',
      cs: 'Noto Sans Devanagari',
    });
  });

  it('is left alone when the document font is already Devanagari', () => {
    expect(runFont('नमस्ते', 'Noto Sans Devanagari')).toBe('Noto Sans Devanagari');
  });
});

describe('the other scripts Word will not draw in a Latin face', () => {
  it.each([
    ['Bengali', 'বাংলা', 'Noto Sans Bengali'],
    ['Gurmukhi', 'ਪੰਜਾਬੀ', 'Noto Sans Gurmukhi'],
    ['Gujarati', 'ગુજરાતી', 'Noto Sans Gujarati'],
    ['Odia', 'ଓଡ଼ିଆ', 'Noto Sans Oriya'],
    ['Tamil', 'தமிழ்', 'Noto Sans Tamil'],
    ['Telugu', 'తెలుగు', 'Noto Sans Telugu'],
    ['Kannada', 'ಕನ್ನಡ', 'Noto Sans Kannada'],
    ['Malayalam', 'മലയാളം', 'Noto Sans Malayalam'],
    ['Sinhala', 'සිංහල', 'Noto Sans Sinhala'],
    ['Thai', 'ภาษาไทย', 'Noto Sans Thai'],
    ['Hebrew', 'שלום', 'Noto Sans Hebrew'],
    ['Arabic', 'مرحبا', 'Noto Sans Arabic'],
  ])('names a %s face', (_script, text, face) => {
    expect(runFont(text, 'Courier Prime')).toMatchObject({ cs: face });
  });
});

describe('CJK', () => {
  it('goes in the eastAsia slot rather than the complex-script one', () => {
    expect(runFont('こんにちは', 'Courier Prime')).toEqual({
      ascii: 'Courier Prime',
      hAnsi: 'Courier Prime',
      cs: 'Courier Prime',
      eastAsia: 'Noto Sans JP',
    });
  });

  it('reads Han with no marker as Chinese', () => {
    // 日本語 is Han throughout — the word "Japanese" written without a kana in
    // it. No per-character rule can call that Japanese, and the PDF exporter
    // takes the same view.
    expect(runFont('日本語', 'Courier Prime')).toMatchObject({ eastAsia: 'Noto Sans SC' });
  });

  it('reads kana as Japanese, hangul as Korean, and bare Han as Chinese', () => {
    // The same markers pdfUnicodeFont uses: which family an ideograph belongs
    // to is a fact about the document, not about the character.
    expect(runFont('ひらがな', 'Courier Prime')).toMatchObject({ eastAsia: 'Noto Sans JP' });
    expect(runFont('한국어', 'Courier Prime')).toMatchObject({ eastAsia: 'Noto Sans KR' });
    expect(runFont('中文', 'Courier Prime')).toMatchObject({ eastAsia: 'Noto Sans SC' });
  });

  it('is left alone when the document font is already a CJK family', () => {
    expect(runFont('日本語', 'Noto Sans JP')).toBe('Noto Sans JP');
  });
});

describe("a font the writer installed", () => {
  it('is trusted with its own script', () => {
    // Custom and device entries declare `scripts: ['latin']` as a placeholder,
    // not as a claim about coverage. A writer who picked their own Devanagari
    // font meant it, and overriding them would be worse than the bug.
    setDynamicFonts('custom', [{
      name: 'My Hindi Font',
      category: 'Custom Fonts',
      scripts: ['latin'],
      source: 'custom',
      direction: 'ltr',
      generic: 'sans-serif',
    }]);
    expect(runFont('नमस्ते', 'My Hindi Font')).toBe('My Hindi Font');
  });

  it('is trusted when found on the device', () => {
    setDynamicFonts('device', [{
      name: 'Kohinoor Devanagari',
      category: 'On This Device',
      scripts: ['latin'],
      source: 'device',
      direction: 'ltr',
      generic: 'sans-serif',
    }]);
    expect(runFont('नमस्ते', 'Kohinoor Devanagari')).toBe('Kohinoor Devanagari');
  });

  it('leaves a family nothing here has heard of alone', () => {
    // An imported script naming Mangal or Nirmala UI already has a Devanagari
    // face; second-guessing it would be a regression.
    expect(runFont('नमस्ते', 'Mangal')).toBe('Mangal');
  });
});
