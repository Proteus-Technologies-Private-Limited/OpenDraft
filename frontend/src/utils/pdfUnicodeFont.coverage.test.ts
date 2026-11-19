/**
 * Every script the exporter claims to write has a face that really can.
 *
 * Without this, a font is only found to be missing a script when someone
 * exports in it: `specFor` routes by a table of ranges, and nothing checked that
 * the font file behind a range holds the glyphs. Each script below has a
 * sentence in it; for every character the test asks which face the exporter
 * would use, and — for the fonts that ship inside the app — opens the file and
 * reads its glyph table. Fonts fetched at export time cannot be opened here, so
 * for those it only proves a face is assigned.
 *
 * A script the exporter cannot draw yet is listed under UNSUPPORTED, so
 * supporting one means moving it up, and a regression that drops one fails here
 * rather than in a writer's PDF.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeFaceFor, needsUnicodeFont, unsupportedScripts } from './pdfUnicodeFont';

const FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'fonts');

/** The code points a TrueType file's cmap (formats 4 and 12) maps to a glyph. */
function cmapOf(file: string): Set<number> {
  const buf = readFileSync(file);
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tables = view.getUint16(4);
  let cmapOffset = -1;
  for (let i = 0; i < tables; i++) {
    const at = 12 + i * 16;
    if (String.fromCharCode(...buf.subarray(at, at + 4)) === 'cmap') cmapOffset = view.getUint32(at + 8);
  }
  if (cmapOffset < 0) throw new Error(`${file} has no cmap`);
  const covered = new Set<number>();
  const count = view.getUint16(cmapOffset + 2);
  for (let i = 0; i < count; i++) {
    const sub = cmapOffset + view.getUint32(cmapOffset + 4 + i * 8 + 4);
    const format = view.getUint16(sub);
    if (format === 4) {
      const segs = view.getUint16(sub + 6) / 2;
      const ends = sub + 14;
      const starts = ends + segs * 2 + 2;
      const deltas = starts + segs * 2;
      const ranges = deltas + segs * 2;
      for (let s = 0; s < segs; s++) {
        const end = view.getUint16(ends + s * 2);
        const start = view.getUint16(starts + s * 2);
        const rangeOffset = view.getUint16(ranges + s * 2);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          let glyph: number;
          if (rangeOffset === 0) glyph = (c + view.getInt16(deltas + s * 2)) & 0xffff;
          else {
            glyph = view.getUint16(ranges + s * 2 + rangeOffset + (c - start) * 2);
            if (glyph !== 0) glyph = (glyph + view.getInt16(deltas + s * 2)) & 0xffff;
          }
          if (glyph !== 0) covered.add(c);
        }
      }
    } else if (format === 12) {
      const groups = view.getUint32(sub + 12);
      for (let g = 0; g < groups; g++) {
        const at = sub + 16 + g * 12;
        const start = view.getUint32(at);
        const end = view.getUint32(at + 4);
        for (let c = start; c <= end; c++) covered.add(c);
      }
    }
  }
  return covered;
}

/** One ordinary sentence per script, in the characters a screenplay would use. */
const SUPPORTED: Record<string, string> = {
  'Polish': 'Zażółć gęślą jaźń, a potem łódź płynęła przez Kraków.',
  'Czech': 'Příliš žluťoučký kůň úpěl ďábelské ódy.',
  'Turkish': 'Pijamalı hasta yağız şoföre çabucak güvendi, İstanbul’da.',
  'Romanian': 'Aș vrea să știu, țară frumoasă și îndrăgită.',
  'Vietnamese': 'Tiếng Việt có nhiều dấu: ắ ằ ẳ ẵ ặ ề ể ễ ệ ộ ỗ ớ ờ.',
  'Greek': 'Ξεσκεπάζω την ψυχοφθόρα βδελυγμία.',
  'Cyrillic': 'Съешь же ещё этих мягких французских булок.',
  'Armenian': 'Բարեւ աշխարհ, ես սիրում եմ գրել։',
  'Georgian': 'გამარჯობა მსოფლიო, მე მიყვარს წერა.',
  'Hebrew': 'שלום עולם, אני אוהב לכתוב תסריטים.',
  'Arabic': 'مرحبا بالعالم، أحب كتابة السيناريو.',
  'Thai': 'สวัสดีชาวโลก ฉันชอบเขียนบทภาพยนตร์',
  'Devanagari': 'नमस्ते दुनिया, मुझे पटकथा लिखना पसंद है।',
  'Bengali': 'নমস্কার বিশ্ব, আমি চিত্রনাট্য লিখতে ভালোবাসি।',
  'Gurmukhi': 'ਸਤ ਸ੍ਰੀ ਅਕਾਲ ਦੁਨੀਆ, ਮੈਨੂੰ ਲਿਖਣਾ ਪਸੰਦ ਹੈ।',
  'Gujarati': 'નમસ્તે દુનિયા, મને પટકથા લખવી ગમે છે.',
  'Odia': 'ନମସ୍କାର ବିଶ୍ୱ, ମୁଁ ଲେଖିବାକୁ ଭଲପାଏ।',
  'Tamil': 'வணக்கம் உலகம், எனக்கு திரைக்கதை எழுத பிடிக்கும்.',
  'Telugu': 'నమస్కారం ప్రపంచం, నాకు స్క్రిప్ట్ రాయడం ఇష్టం.',
  'Kannada': 'ನಮಸ್ಕಾರ ಜಗತ್ತು, ನನಗೆ ಚಿತ್ರಕಥೆ ಬರೆಯುವುದು ಇಷ್ಟ.',
  'Malayalam': 'നമസ്കാരം ലോകം, എനിക്ക് തിരക്കഥ എഴുതാൻ ഇഷ്ടമാണ്.',
  'Sinhala': 'ආයුබෝවන් ලෝකය, මම තිරරචනා ලිවීමට කැමතියි.',
  'Khmer': 'សួស្តី ពិភពលោក ខ្ញុំស្រលាញ់ភាសាខ្មែរ',
  'Lao': 'ສະບາຍດີ ໂລກ ຂ້ອຍຮັກພາສາລາວ',
  'Myanmar': 'မင်္ဂလာပါ ကမ္ဘာကြီး ကျွန်တော် မြန်မာစကား ပြောတတ်ပါတယ်',
  'Ethiopic': 'ሰላም ልዑል ዓለም አማርኛ ቋንቋ',
  'Cherokee': 'ᎣᏏᏲ ᎠᏂᏴᏫᏯ ᏣᎳᎩ',
  'Tibetan': 'བཀྲ་ཤིས་བདེ་ལེགས། བོད་སྐད་',
  'Chinese': '你好，世界。我喜欢写剧本。',
  'Japanese': 'こんにちは世界。私は脚本を書くのが好きです。',
  'Korean': '안녕하세요 세계. 저는 시나리오 쓰기를 좋아합니다.',
};

/** Scripts that still have no face — see UNSUPPORTED_SCRIPTS. */
const UNSUPPORTED: Record<string, string> = {
  'Syriac': 'ܫܠܡܐ',
  'Thaana': 'ހެލޯ',
};

const cmaps = new Map<string, Set<number>>();
const cmapFor = (file: string): Set<number> => {
  let c = cmaps.get(file);
  if (!c) cmaps.set(file, (c = cmapOf(file)));
  return c;
};

describe('every supported script has a face that can write it', () => {
  for (const [script, sample] of Object.entries(SUPPORTED)) {
    it(script, () => {
      for (const char of sample) {
        const codePoint = char.codePointAt(0)!;
        if (!needsUnicodeFont(char)) continue; // the built-in faces write it
        const face = describeFaceFor(codePoint);
        expect(face, `${script}: U+${codePoint.toString(16)} (${char}) has no face`).not.toBeNull();
        if (!face || face.remote) continue; // fetched at export time: cannot be opened here
        for (const files of face.files) {
          for (const [style, url] of Object.entries(files)) {
            const file = join(FONT_DIR, url!.replace(/^\/fonts\//, ''));
            expect(existsSync(file), `${script}: ${url} is missing`).toBe(true);
            expect(
              cmapFor(file).has(codePoint),
              `${script}: ${face.id} ${style} has no glyph for U+${codePoint.toString(16)} (${char})`,
            ).toBe(true);
          }
        }
      }
    });
  }

  it('reports nothing as unsupported for any of them', () => {
    expect(unsupportedScripts(Object.values(SUPPORTED).map((text) => ({ text })))).toEqual([]);
  });
});

describe('scripts still without a face are named, not drawn blank', () => {
  for (const [script, sample] of Object.entries(UNSUPPORTED)) {
    it(script, () => {
      expect(unsupportedScripts([{ text: sample }])).toEqual([script]);
    });
  }
});

describe('Liberation Sans, the face a sans-serif Latin script is drawn in (#269)', () => {
  // The sans face is chosen per run, not per character, so describeFaceFor never
  // returns it; its files are checked here instead.
  const SAMPLES = ['Zażółć gęślą jaźń ZAŻÓŁĆ GĘŚLĄ JAŹŃ', 'Příliš žluťoučký kůň', 'ığüşöç İĞÜŞÖÇ', 'Việt Nam đẹp ế ề ộ'];
  for (const style of ['Regular', 'Bold', 'Italic', 'BoldItalic']) {
    it(`${style} has a glyph for every Latin Extended and Vietnamese letter used`, () => {
      const cmap = cmapFor(join(FONT_DIR, `LiberationSans-${style}.ttf`));
      for (const char of SAMPLES.join('')) {
        if (char === ' ') continue;
        expect(cmap.has(char.codePointAt(0)!), `${style}: no glyph for ${char}`).toBe(true);
      }
    });
  }
});
