/**
 * Which text a built-in PDF face can write, and what gets embedded when it
 * cannot.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  needsUnicodeFont, requiredUnicodeFaces, styleKey, embedUnicodeFonts, segmentByFace,
  unsupportedScripts,
  NO_FALLBACKS, UNICODE_FONT_ID, DEVANAGARI_FONT_ID, CJK_FONT_ID,
  type FontStyle, type RequiredFaces,
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
      'हिन्दी',                          // Devanagari — issue #128
      'एक अंग्रेज़ी word बीच में',        // one Devanagari word is enough
      '你好',                             // Chinese (beyond the bundled fonts, but still not WinAnsi)
    ]) {
      expect(needsUnicodeFont(text), text).toBe(true);
    }
  });
});

describe('requiredUnicodeFaces', () => {
  it('asks for nothing when the script is Latin', () => {
    expect(requiredUnicodeFaces([
      { text: 'INT. LIBRARY - DAY', bold: true },
      { text: 'A PROGRAMMER types.' },
    ]).size).toBe(0);
  });

  it('asks only for the styles the untypable text is actually drawn in', () => {
    const faces = requiredUnicodeFaces([
      { text: 'ИНТ. БИБЛИОТЕКА', bold: true }, // scene heading
      { text: 'Привет' },                                                          // dialogue
      { text: 'A Latin line in italics', italic: true },                                                          // no fallback needed
    ]);
    expect([...faces.keys()]).toEqual([UNICODE_FONT_ID]);
    expect([...faces.get(UNICODE_FONT_ID)!.styles].sort()).toEqual(['bold', 'normal']);
  });

  it('sends Devanagari to its own face, not to the one that cannot draw it', () => {
    const faces = requiredUnicodeFaces([{ text: 'नमस्ते' }]);
    expect([...faces.keys()]).toEqual([DEVANAGARI_FONT_ID]);
  });

  it('asks for both faces when a script mixes the two', () => {
    const faces = requiredUnicodeFaces([
      { text: 'नमस्ते', bold: true },
      { text: 'Привет' },
    ]);
    expect([...faces.keys()].sort()).toEqual([DEVANAGARI_FONT_ID, UNICODE_FONT_ID].sort());
    expect([...faces.get(DEVANAGARI_FONT_ID)!.styles]).toEqual(['bold']);
    expect([...faces.get(UNICODE_FONT_ID)!.styles]).toEqual(['normal']);
  });

  it('asks for nothing for a script no face covers at all', () => {
    // Khmer has no face here; asking for one that cannot draw it would only
    // cost the download.  unsupportedScripts() is what tells the writer.
    expect(requiredUnicodeFaces([{ text: 'សួស្ដី' }]).size).toBe(0);
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

// --- embedUnicodeFonts -----------------------------------------------------

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

/** The shape `embedUnicodeFonts` takes, written the way a caller reads. */
const asked = (...pairs: [string, FontStyle[]][]): RequiredFaces =>
  new Map(pairs.map(([id, styles]) => [id, { styles: new Set(styles), variant: id }]));

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

describe('embedUnicodeFonts', () => {
  it('embeds nothing, and fetches nothing, for a Latin script', async () => {
    const requested = stubFontFetch();
    const pdf = fakePdf();

    const fallbacks = await embedUnicodeFonts(pdf as never, new Map(), FD_CHAR_WIDTH_PT);

    expect(fallbacks.none).toBe(true);
    expect(fallbacks.missing).toEqual([]);
    expect(requested).toEqual([]);
    expect(pdf.registered).toEqual([]);
  });

  it('registers the styles asked for, and reports the FD cell correction', async () => {
    stubFontFetch();
    const pdf = fakePdf();

    const fallbacks = await embedUnicodeFonts(
      pdf as never, asked([UNICODE_FONT_ID, ['normal', 'bold']]), FD_CHAR_WIDTH_PT,
    );

    const face = fallbacks.faceFor('П'.codePointAt(0)!)!;
    expect(face.id).toBe(UNICODE_FONT_ID);
    expect(face.monospace).toBe(true);
    expect(face.charSpace).toBe(FD_CHAR_WIDTH_PT - 8);
    expect(pdf.registered.map((r) => r.style).sort()).toEqual(['bold', 'normal']);
    for (const entry of pdf.registered) expect(entry.id).toBe(UNICODE_FONT_ID);
  });

  it('draws Devanagari at its own advances, with no cell correction', async () => {
    stubFontFetch();
    const pdf = fakePdf();

    const fallbacks = await embedUnicodeFonts(
      pdf as never, asked([DEVANAGARI_FONT_ID, ['normal']]), FD_CHAR_WIDTH_PT,
    );

    const face = fallbacks.faceFor('न'.codePointAt(0)!)!;
    expect(face.id).toBe(DEVANAGARI_FONT_ID);
    expect(face.monospace).toBe(false);
    expect(face.charSpace).toBe(0);
    // No monospaced Devanagari face exists, so there is no 'M' to measure and
    // the current font must not have been disturbed looking for one.
    expect(pdf.current()).toEqual({ fontName: 'courier', fontStyle: 'normal' });
  });

  it('reorders Devanagari for drawing, and leaves Cyrillic alone', async () => {
    stubFontFetch();
    const pdf = fakePdf();

    const fallbacks = await embedUnicodeFonts(
      pdf as never,
      asked([DEVANAGARI_FONT_ID, ['normal']], [UNICODE_FONT_ID, ['normal']]),
      FD_CHAR_WIDTH_PT,
    );

    expect(fallbacks.faceFor('ह'.codePointAt(0)!)!.shape('हिन्दी')).toBe('िहन्दी');
    expect(fallbacks.faceFor('П'.codePointAt(0)!)!.shape('Привет')).toBe('Привет');
  });

  it('keeps each face to the code points it can actually write', async () => {
    stubFontFetch();
    const pdf = fakePdf();

    const fallbacks = await embedUnicodeFonts(
      pdf as never,
      asked([DEVANAGARI_FONT_ID, ['normal']], [UNICODE_FONT_ID, ['normal']]),
      FD_CHAR_WIDTH_PT,
    );

    expect(fallbacks.faceFor('क'.codePointAt(0)!)!.id).toBe(DEVANAGARI_FONT_ID);
    expect(fallbacks.faceFor('Я'.codePointAt(0)!)!.id).toBe(UNICODE_FONT_ID);
    // Nothing bundled has Chinese; the built-in faces keep it and do their worst.
    expect(fallbacks.faceFor('好'.codePointAt(0)!)).toBeNull();
  });

  it('leaves the current face selected, so the export draws on unaffected', async () => {
    stubFontFetch();
    const pdf = fakePdf();
    pdf.setFont('times', 'italic');

    await embedUnicodeFonts(pdf as never, asked([UNICODE_FONT_ID, ['normal']]), FD_CHAR_WIDTH_PT);

    expect(pdf.current()).toEqual({ fontName: 'times', fontStyle: 'italic' });
  });

  it('always has a normal style to fall back on', async () => {
    stubFontFetch();
    const pdf = fakePdf();

    await embedUnicodeFonts(pdf as never, asked([UNICODE_FONT_ID, ['bolditalic']]), FD_CHAR_WIDTH_PT);

    expect(pdf.registered.map((r) => r.style).sort()).toEqual(['bolditalic', 'normal']);
  });

  it('backs a missing style with the regular weight rather than failing the export', async () => {
    stubFontFetch(['Bold']);
    const pdf = fakePdf();

    const fallbacks = await embedUnicodeFonts(
      pdf as never, asked([UNICODE_FONT_ID, ['normal', 'bold']]), FD_CHAR_WIDTH_PT,
    );

    expect(fallbacks.none).toBe(false);
    const bold = pdf.registered.find((r) => r.style === 'bold')!;
    const normal = pdf.registered.find((r) => r.style === 'normal')!;
    expect(pdf.vfs.get(bold.vfs)).toBe(pdf.vfs.get(normal.vfs));
  });

  it('backs a style the family has not got with the regular weight', async () => {
    stubFontFetch();
    const pdf = fakePdf();

    // Noto Sans Devanagari ships no italic at all, so an italic Hindi lyric has
    // to come out as upright Hindi rather than as a jsPDF lookup error.
    await embedUnicodeFonts(pdf as never, asked([DEVANAGARI_FONT_ID, ['italic']]), FD_CHAR_WIDTH_PT);

    const italic = pdf.registered.find((r) => r.style === 'italic')!;
    const normal = pdf.registered.find((r) => r.style === 'normal')!;
    expect(pdf.vfs.get(italic.vfs)).toBe(pdf.vfs.get(normal.vfs));
  });

  it('keeps the face that did load when another one could not', async () => {
    stubFontFetch(['NotoSansDevanagari']);
    // A fresh copy of the module, for the reason given below: the Devanagari
    // bytes are cached for the session and a load that has already succeeded
    // would be reused however this fetch answers.
    vi.resetModules();
    const fresh = await import('./pdfUnicodeFont');
    const pdf = fakePdf();

    const fallbacks = await fresh.embedUnicodeFonts(
      pdf as never,
      asked([DEVANAGARI_FONT_ID, ['normal']], [UNICODE_FONT_ID, ['normal']]),
      FD_CHAR_WIDTH_PT,
    );

    expect(fallbacks.faceFor('क'.codePointAt(0)!)).toBeNull();
    expect(fallbacks.faceFor('Я'.codePointAt(0)!)!.id).toBe(UNICODE_FONT_ID);
    // Named for the writer, because the Hindi in their script is now blank and
    // nothing else on the page will tell them so.
    expect(fallbacks.missing).toEqual(['Devanagari']);
  });

  it('gives up quietly when the font cannot be loaded at all', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    // A fresh copy of the module: the font bytes are cached for the session, so
    // a load that has already succeeded above would otherwise be reused here.
    vi.resetModules();
    const fresh = await import('./pdfUnicodeFont');
    const pdf = fakePdf();

    const fallbacks = await fresh.embedUnicodeFonts(
      pdf as never, asked([UNICODE_FONT_ID, ['normal']]), FD_CHAR_WIDTH_PT,
    );

    expect(fallbacks.none).toBe(true);
    expect(fallbacks.missing).toEqual(['Cyrillic, Greek, Armenian and Georgian']);
    expect(pdf.registered).toEqual([]);
  });

  it('reports nothing missing when every face asked for loaded', async () => {
    stubFontFetch();
    const pdf = fakePdf();

    const fallbacks = await embedUnicodeFonts(
      pdf as never,
      asked([DEVANAGARI_FONT_ID, ['normal']], [UNICODE_FONT_ID, ['normal']]),
      FD_CHAR_WIDTH_PT,
    );

    expect(fallbacks.missing).toEqual([]);
  });
});

// --- segmentByFace ---------------------------------------------------------

/** The faces a document with both fallbacks in it would draw through. */
async function bothFaces() {
  stubFontFetch();
  return embedUnicodeFonts(
    fakePdf() as never,
    asked([DEVANAGARI_FONT_ID, ['normal']], [UNICODE_FONT_ID, ['normal']]),
    FD_CHAR_WIDTH_PT,
  );
}

/** Segments as `[text, face]` pairs, which is what the assertions are about. */
const split = (text: string, fallbacks: Awaited<ReturnType<typeof bothFaces>>) =>
  segmentByFace(text, fallbacks).map((s) => [s.text, s.fallback?.id ?? null]);

describe('segmentByFace', () => {
  it('hands a Latin script back whole, with no fallback at all', async () => {
    expect(segmentByFace('INT. LIBRARY - DAY', NO_FALLBACKS))
      .toEqual([{ text: 'INT. LIBRARY - DAY', fallback: null }]);
  });

  it('hands Latin back whole even when a document has fallbacks in it', async () => {
    expect(split('INT. LIBRARY - DAY', await bothFaces()))
      .toEqual([['INT. LIBRARY - DAY', null]]);
  });

  it('keeps a Cyrillic sentence one piece, spaces and full stops included', async () => {
    // DejaVu covers Latin too, so a sentence that starts in it stays in it —
    // which is what it did before there was more than one fallback.
    expect(split('Что бы ни было.', await bothFaces()))
      .toEqual([['Что бы ни было.', UNICODE_FONT_ID]]);
  });

  it('keeps a Hindi sentence one piece, with its own word spacing', async () => {
    expect(split('नमस्ते दोस्त', await bothFaces()))
      .toEqual([['नमस्ते दोस्त', DEVANAGARI_FONT_ID]]);
  });

  it('leaves a Latin word inside a Hindi line on the built-in face', async () => {
    // The Devanagari subset has no Latin letters, and dragging them into a
    // proportional face would take them off Final Draft's cell besides.
    expect(split('मैं CUT TO: लिख', await bothFaces())).toEqual([
      ['मैं ', DEVANAGARI_FONT_ID],
      ['CUT TO: ', null],
      ['लिख', DEVANAGARI_FONT_ID],
    ]);
  });

  it('starts in the document face when the line opens in Latin', async () => {
    expect(split('EXT. सड़क', await bothFaces())).toEqual([
      ['EXT. ', null],
      ['सड़क', DEVANAGARI_FONT_ID],
    ]);
  });

  it('parts the two fallbacks where the script changes', async () => {
    expect(split('Привет नमस्ते', await bothFaces())).toEqual([
      ['Привет ', UNICODE_FONT_ID],
      ['नमस्ते', DEVANAGARI_FONT_ID],
    ]);
  });

  it('leaves a script no bundled face covers to the built-ins', async () => {
    expect(split('你好', await bothFaces())).toEqual([['你好', null]]);
  });
});

// ── What was added when the table grew past two faces ───────────────────────

describe('unsupportedScripts', () => {
  it('says nothing about a script that has a face', async () => {
    expect(unsupportedScripts([
      { text: 'INT. LIBRARY - DAY' },
      { text: 'Привет' },        // DejaVu
      { text: 'नमस्ते' },          // Devanagari
      { text: 'வணக்கம்' },        // Tamil
      { text: '你好' },            // the remote CJK face
      { text: 'שלום' },            // Hebrew, reordered before it is drawn
      { text: 'مرحبا' },           // Arabic, shaped and reordered
    ])).toEqual([]);
  });

  it('names a script that has no face', () => {
    // The failure this prevents is the one issue #128 was reported as: a PDF
    // that had quietly lost its dialogue.  Naming the script is the whole
    // point — "some characters" would send the writer looking at the wrong
    // part of their script.
    expect(unsupportedScripts([{ text: 'សួស្ដី' }])).toEqual(['Khmer']);
    expect(unsupportedScripts([{ text: 'ᑕᐋᒥ' }])).toEqual(['an unsupported script']);
  });

  it('says nothing about Hebrew or Arabic, which are drawn now', () => {
    expect(unsupportedScripts([{ text: 'שלום' }, { text: 'مرحبا' }])).toEqual([]);
  });

  it('names each script once, however much of it there is', () => {
    expect(unsupportedScripts([
      { text: 'សួស្ដី' }, { text: 'សួស្ដី', bold: true }, { text: 'សួស្ដី' },
    ])).toEqual(['Khmer']);
  });

  it('falls back to a generic name for a script it has no name for', () => {
    expect(unsupportedScripts([{ text: '\u{10480}' }])) // Osmanya
      .toEqual(['an unsupported script']);
  });

  it('is not fooled by the text a Latin script is actually made of', () => {
    expect(unsupportedScripts([{ text: "He said “no” — and left…" }])).toEqual([]);
  });
});

describe('choosing which CJK family a document is written in', () => {
  const variantOf = (text: string) => requiredUnicodeFaces([{ text }])!.get(CJK_FONT_ID)?.variant;

  it('takes Han on its own as Chinese', () => {
    expect(variantOf('你好世界')).toBe('SC');
  });

  it('reads kana as Japanese, though the Han in the line is shared', () => {
    // 東京 is Han and could be any of the three; の is kana and could not.
    expect(variantOf('東京の夜')).toBe('JP');
  });

  it('reads hangul as Korean', () => {
    expect(variantOf('안녕하세요')).toBe('KR');
  });

  it('asks for one CJK face, not one per character', () => {
    const faces = requiredUnicodeFaces([{ text: '東京の夜' }, { text: '你好' }]);
    expect([...faces.keys()]).toEqual([CJK_FONT_ID]);
  });
});

describe('fetching a face that is not in the bundle', () => {
  it('fetches the chosen CJK family and nothing else', async () => {
    const requested = stubFontFetch();
    const pdf = fakePdf();

    await embedUnicodeFonts(
      pdf as never,
      new Map([[CJK_FONT_ID, { styles: new Set<FontStyle>(['normal']), variant: 'JP' }]]),
      FD_CHAR_WIDTH_PT,
    );

    expect(requested.length).toBe(1);
    expect(requested[0]).toContain('notosansjp');
  });

  it('names the family, not the face, when the download fails', async () => {
    stubFontFetch(['notosanskr']);
    const pdf = fakePdf();

    const fallbacks = await embedUnicodeFonts(
      pdf as never,
      new Map([[CJK_FONT_ID, { styles: new Set<FontStyle>(['normal']), variant: 'KR' }]]),
      FD_CHAR_WIDTH_PT,
    );

    // "Korean" is what the writer can act on; the file name is not.
    expect(fallbacks.missing).toEqual(['Korean']);
  });

  it('reports progress for a remote face, so a long download is not a hang', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6]);
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      headers: { get: () => String(bytes.length) },
      arrayBuffer: async () => bytes.buffer,
      body: {
        getReader: () => {
          let sent = false;
          return {
            read: async () => (sent
              ? { done: true, value: undefined }
              : ((sent = true), { done: false, value: bytes })),
          };
        },
      },
    })));

    const seen: Array<{ label: string; loaded: number; total?: number }> = [];
    await embedUnicodeFonts(
      fakePdf() as never,
      new Map([[CJK_FONT_ID, { styles: new Set<FontStyle>(['normal']), variant: 'SC' }]]),
      FD_CHAR_WIDTH_PT,
      { onProgress: (progress) => seen.push(progress) },
    );

    expect(seen).toEqual([{ label: 'Chinese', loaded: 6, total: 6 }]);
  });

  it('says nothing about a bundled face, which is read too fast to report', async () => {
    stubFontFetch();
    const seen: string[] = [];

    await embedUnicodeFonts(
      fakePdf() as never,
      asked([DEVANAGARI_FONT_ID, ['normal']]),
      FD_CHAR_WIDTH_PT,
      { onProgress: (progress) => seen.push(progress.label) },
    );

    expect(seen).toEqual([]);
  });
});

describe('carrying the unsupported scripts through to the caller', () => {
  it('reports them even when no face was needed at all', async () => {
    const fallbacks = await embedUnicodeFonts(
      fakePdf() as never, new Map(), FD_CHAR_WIDTH_PT, { unsupported: ['Hebrew'] },
    );

    // Nothing to embed, and still something the writer has to be told.
    expect(fallbacks.none).toBe(true);
    expect(fallbacks.unsupported).toEqual(['Hebrew']);
  });

  it('reports them alongside the faces that did load', async () => {
    stubFontFetch();
    const fallbacks = await embedUnicodeFonts(
      fakePdf() as never,
      asked([DEVANAGARI_FONT_ID, ['normal']]),
      FD_CHAR_WIDTH_PT,
      { unsupported: ['Arabic'] },
    );

    expect(fallbacks.none).toBe(false);
    expect(fallbacks.unsupported).toEqual(['Arabic']);
  });
});

describe('the new bundled scripts reach their own face', () => {
  const faceIds = (text: string) => [...requiredUnicodeFaces([{ text }]).keys()];

  it.each([
    ['Tamil', 'வணக்கம்', 'NotoSansTamil'],
    ['Bengali', 'নমস্কার', 'NotoSansBengali'],
    ['Gujarati', 'નમસ્તે', 'NotoSansGujarati'],
    ['Gurmukhi', 'ਸਤ ਸ੍ਰੀ ਅਕਾਲ', 'NotoSansGurmukhi'],
    ['Kannada', 'ನಮಸ್ಕಾರ', 'NotoSansKannada'],
    ['Malayalam', 'നമസ്കാരം', 'NotoSansMalayalam'],
    ['Odia', 'ନମସ୍କାର', 'NotoSansOriya'],
    ['Telugu', 'నమస్కారం', 'NotoSansTelugu'],
    ['Sinhala', 'ආයුබෝවන්', 'NotoSansSinhala'],
    ['Thai', 'สวัสดี', 'NotoSansThai'],
  ])('sends %s to %s', (_name, text, expected) => {
    expect(faceIds(text)).toEqual([expected]);
  });

  it('keeps each script on its own face when a line mixes them', () => {
    const faces = requiredUnicodeFaces([{ text: 'வணக்கம் नमस्ते' }]);
    expect([...faces.keys()].sort()).toEqual([DEVANAGARI_FONT_ID, 'NotoSansTamil'].sort());
  });
});

describe('keeping a fetched font between sessions', () => {
  /** A Cache API that records what was put in it and can serve it back. */
  function stubCaches() {
    const store = new Map<string, Uint8Array>();
    const cache = {
      match: async (url: string) => {
        const hit = store.get(url);
        return hit ? { arrayBuffer: async () => hit.buffer } : undefined;
      },
      put: async (url: string, response: { arrayBuffer: () => Promise<ArrayBuffer> }) => {
        store.set(url, new Uint8Array(await response.arrayBuffer()));
      },
    };
    vi.stubGlobal('caches', { open: async () => cache });
    return store;
  }

  /** Fetch that can be asked again, since the module's own map is a cache too. */
  function stubFreshFetch(bytes: Uint8Array) {
    const requested: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      requested.push(url);
      return {
        ok: true,
        arrayBuffer: async () => bytes.buffer,
        clone: () => ({ arrayBuffer: async () => bytes.buffer }),
      };
    }));
    return requested;
  }

  it('stores what it fetched, so the next machine-wide export does not re-download', async () => {
    const store = stubCaches();
    stubFreshFetch(new Uint8Array([0x00, 0x01, 0x00, 0x00]));

    await embedUnicodeFonts(
      fakePdf() as never,
      new Map([[CJK_FONT_ID, { styles: new Set<FontStyle>(['normal']), variant: 'TC' }]]),
      FD_CHAR_WIDTH_PT,
    );

    // 5-10 MB is not a download to make twice.
    expect([...store.keys()].some((url) => url.includes('notosanstc'))).toBe(true);
  });

  it('carries on exporting when the cache refuses to open', async () => {
    // A private window, or site data blocked. The fetch is then the only copy,
    // which is what this did before there was a cache at all.
    vi.stubGlobal('caches', { open: async () => { throw new Error('denied'); } });
    const requested = stubFreshFetch(new Uint8Array([0x00, 0x01, 0x00, 0x00]));

    const fallbacks = await embedUnicodeFonts(
      fakePdf() as never,
      new Map([[CJK_FONT_ID, { styles: new Set<FontStyle>(['bold']), variant: 'JP' }]]),
      FD_CHAR_WIDTH_PT,
    );

    expect(requested.length).toBeGreaterThan(0);
    expect(fallbacks.missing).toEqual([]);
    expect(fallbacks.none).toBe(false);
  });

  it('carries on exporting when storing throws, having already got the bytes', async () => {
    vi.stubGlobal('caches', {
      open: async () => ({
        match: async () => undefined,
        put: async () => { throw new Error('quota exceeded'); },
      }),
    });
    stubFreshFetch(new Uint8Array([0x00, 0x01, 0x00, 0x00]));

    const fallbacks = await embedUnicodeFonts(
      fakePdf() as never,
      new Map([[CJK_FONT_ID, { styles: new Set<FontStyle>(['normal']), variant: 'KR' }]]),
      FD_CHAR_WIDTH_PT,
    );

    expect(fallbacks.missing).toEqual([]);
  });
});

describe('every CJK family is actually reachable', () => {
  // Traditional Chinese had a URL and no variant to select it, so a TC script
  // quietly fetched the Simplified face instead — a fallback that worked well
  // enough to hide the hole. Asking for each family by name is what would have
  // caught it.
  //
  // The module is re-imported per case because it keeps every font it has
  // fetched, deliberately and for the whole session: asking twice in one file
  // would be served from that map and reach no URL at all.
  it.each([
    ['SC', 'notosanssc'],
    ['TC', 'notosanstc'],
    ['JP', 'notosansjp'],
    ['KR', 'notosanskr'],
  ])('fetches the %s family when it is the one asked for', async (variant, file) => {
    vi.resetModules();
    const requested = stubFontFetch();
    const fresh = await import('./pdfUnicodeFont');

    await fresh.embedUnicodeFonts(
      fakePdf() as never,
      new Map([[fresh.CJK_FONT_ID, { styles: new Set<FontStyle>(['normal']), variant }]]),
      FD_CHAR_WIDTH_PT,
    );

    expect(requested.join(' ')).toContain(file);
  });

  it('reads a traditional-only character as Traditional Chinese', () => {
    // 這 and 說 are written 这 and 说 in Simplified, and Japanese uses neither
    // — so this line can only be Traditional.
    expect(requiredUnicodeFaces([{ text: '這是說話' }]).get(CJK_FONT_ID)?.variant).toBe('TC');
  });
});
