/**
 * Which text a built-in PDF face can write, and what gets embedded when it
 * cannot.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  needsUnicodeFont, requiredUnicodeStyles, styleKey, embedUnicodeFont, UNICODE_FONT_ID,
} from './pdfUnicodeFont';

describe('needsUnicodeFont', () => {
  it('leaves anything the Standard 14 can encode in the document face', () => {
    for (const text of [
      'INT. LIBRARY - DAY',
      "He said “no” — and left…", // curly quotes, em dash, ellipsis: all WinAnsi
      'Café naïve façade Ñ',      // Latin-1
      '€50, †, ™, Œuvre',           // the WinAnsi 0x80-0x9F extras
      '',
    ]) {
      expect(needsUnicodeFont(text), text).toBe(false);
    }
  });

  it('flags the scripts WinAnsi has no bytes for', () => {
    for (const text of [
      'Привет',   // Cyrillic — issue #71
      'Hello Здравствуйте', // one Cyrillic word is enough
      'Αθήνα',          // Greek
      'თბილი',          // Georgian
      'Հայ',                       // Armenian
      '你好',                             // Chinese (beyond the bundled font, but still not WinAnsi)
    ]) {
      expect(needsUnicodeFont(text), text).toBe(true);
    }
  });
});

describe('requiredUnicodeStyles', () => {
  it('asks for nothing when the script is Latin', () => {
    expect(requiredUnicodeStyles([
      { text: 'INT. LIBRARY - DAY', bold: true },
      { text: 'A PROGRAMMER types.' },
    ]).size).toBe(0);
  });

  it('asks only for the styles the untypable text is actually drawn in', () => {
    const styles = requiredUnicodeStyles([
      { text: 'ИНТ. БИБЛИОТЕКА', bold: true }, // scene heading
      { text: 'Привет' },                                                          // dialogue
      { text: 'A Latin line in italics', italic: true },                                                          // no fallback needed
    ]);
    expect([...styles].sort()).toEqual(['bold', 'normal']);
  });
});

describe('styleKey', () => {
  it('names the four jsPDF styles', () => {
    expect(styleKey(false, false)).toBe('normal');
    expect(styleKey(true, false)).toBe('bold');
    expect(styleKey(false, true)).toBe('italic');
    expect(styleKey(true, true)).toBe('bolditalic');
  });
});

// --- embedUnicodeFont ------------------------------------------------------

/** A jsPDF stand-in that records what was registered and set. */
function fakePdf() {
  const registered: Array<{ vfs: string; id: string; style: string }> = [];
  const vfs = new Map<string, string>();
  let current = { fontName: 'courier', fontStyle: 'normal' };
  return {
    registered,
    vfs,
    current: () => current,
    addFileToVFS: (name: string, data: string) => { vfs.set(name, data); },
    addFont: (name: string, id: string, style: string) => { registered.push({ vfs: name, id, style }); },
    setFont: (fontName: string, fontStyle: string) => { current = { fontName, fontStyle }; },
    getFont: () => current,
    // 8pt per character, so the returned charSpace is unmistakably measured
    // rather than assumed.
    getTextWidth: (text: string) => 8 * text.length,
  };
}

const FD_CHAR_WIDTH_PT = 72 / 10.33;

beforeEach(() => {
  vi.unstubAllGlobals();
});

/** Serves each font file as one recognisable byte, and counts the requests. */
function stubFontFetch(missing: string[] = []) {
  const requested: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    requested.push(url);
    if (missing.some((m) => url.includes(m))) return { ok: false };
    return { ok: true, arrayBuffer: async () => new Uint8Array([0x00, 0x01, 0x00, 0x00]).buffer };
  }));
  return requested;
}

describe('embedUnicodeFont', () => {
  it('embeds nothing, and fetches nothing, for a Latin script', async () => {
    const requested = stubFontFetch();
    const pdf = fakePdf();

    expect(await embedUnicodeFont(pdf as never, new Set(), FD_CHAR_WIDTH_PT)).toBeNull();
    expect(requested).toEqual([]);
    expect(pdf.registered).toEqual([]);
  });

  it('registers the styles asked for, and reports the FD cell correction', async () => {
    stubFontFetch();
    const pdf = fakePdf();

    const font = await embedUnicodeFont(pdf as never, new Set(['normal', 'bold']), FD_CHAR_WIDTH_PT);

    expect(font).toEqual({ id: UNICODE_FONT_ID, charSpace: FD_CHAR_WIDTH_PT - 8 });
    expect(pdf.registered.map((r) => r.style).sort()).toEqual(['bold', 'normal']);
    for (const entry of pdf.registered) expect(entry.id).toBe(UNICODE_FONT_ID);
  });

  it('leaves the current face selected, so the export draws on unaffected', async () => {
    stubFontFetch();
    const pdf = fakePdf();
    pdf.setFont('times', 'italic');

    await embedUnicodeFont(pdf as never, new Set(['normal']), FD_CHAR_WIDTH_PT);

    expect(pdf.current()).toEqual({ fontName: 'times', fontStyle: 'italic' });
  });

  it('always has a normal style to fall back on', async () => {
    stubFontFetch();
    const pdf = fakePdf();

    await embedUnicodeFont(pdf as never, new Set(['bolditalic']), FD_CHAR_WIDTH_PT);

    expect(pdf.registered.map((r) => r.style).sort()).toEqual(['bolditalic', 'normal']);
  });

  it('backs a missing style with the regular weight rather than failing the export', async () => {
    stubFontFetch(['Bold']);
    const pdf = fakePdf();

    const font = await embedUnicodeFont(pdf as never, new Set(['normal', 'bold']), FD_CHAR_WIDTH_PT);

    expect(font).not.toBeNull();
    const bold = pdf.registered.find((r) => r.style === 'bold')!;
    const normal = pdf.registered.find((r) => r.style === 'normal')!;
    expect(pdf.vfs.get(bold.vfs)).toBe(pdf.vfs.get(normal.vfs));
  });

  it('gives up quietly when the font cannot be loaded at all', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    // A fresh copy of the module: the font bytes are cached for the session, so
    // a load that has already succeeded above would otherwise be reused here.
    vi.resetModules();
    const fresh = await import('./pdfUnicodeFont');
    const pdf = fakePdf();

    expect(await fresh.embedUnicodeFont(pdf as never, new Set(['normal']), FD_CHAR_WIDTH_PT)).toBeNull();
    expect(pdf.registered).toEqual([]);
  });
});
