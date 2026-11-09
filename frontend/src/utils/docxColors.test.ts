/**
 * Text colour and highlight survive Word export and import (#226).
 *
 * Driven through the real exporter and importer: the XML Word reads is checked
 * directly, then read back, and Word's own forms (named highlights, a blanket
 * black ink) are fed to the importer by hand.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DOMParser as XmldomDOMParser } from '@xmldom/xmldom';
import JSZip from 'jszip';
import type { JSONContent } from '@tiptap/react';
import { doc, block, marked } from '../test/screenplaySchema';
import { cssToDocxHex, docxHexToCss, wordHighlightToCss, docxColorProps, nearestWordHighlight } from './docxColors';
import { jsonBlockRuns, mergeRuns, DEFAULT_HIGHLIGHT } from './nodeText';

// parseDocx reads OOXML with the platform DOMParser; the node environment has none.
(globalThis as unknown as { DOMParser: unknown }).DOMParser = XmldomDOMParser;

const saved: { buf: Uint8Array | null } = { buf: null };
vi.mock('./fileOps', () => ({
  saveFile: (data: Uint8Array) => {
    saved.buf = data;
    return Promise.resolve();
  },
}));

beforeEach(() => {
  saved.buf = null;
});

const red = { type: 'textStyle', attrs: { color: '#ff0000' } };
const yellow = { type: 'highlight', attrs: { color: '#ffe599' } };

async function exportBytes(input: JSONContent, options?: { exactHighlights?: boolean }): Promise<Uint8Array> {
  const { exportDocx } = await import('./docxExporter');
  const { DEFAULT_PAGE_LAYOUT } = await import('../stores/editorStore');
  await exportDocx(input, 'Test', DEFAULT_PAGE_LAYOUT, options);
  const bytes = saved.buf;
  if (!bytes) throw new Error('exportDocx wrote nothing');
  return bytes.slice();
}

async function documentXml(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  const file = zip.file('word/document.xml');
  if (!file) throw new Error('no word/document.xml');
  return file.async('string');
}

async function importBytes(bytes: Uint8Array): Promise<JSONContent> {
  const { parseDocx } = await import('./docxImporter');
  const parsed = await parseDocx(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
  return parsed.doc as JSONContent;
}

/** A minimal .docx whose single paragraph holds the given `<w:r>` elements. */
async function wordFile(runsXml: string): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('word/document.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + `<w:body><w:p>${runsXml}</w:p></w:body></w:document>`);
  return zip.generateAsync({ type: 'uint8array' });
}

/** Every text node of the document, flattened. */
function textNodes(d: JSONContent): JSONContent[] {
  const out: JSONContent[] = [];
  const walk = (n: JSONContent) => {
    if (n.type === 'text') out.push(n);
    (n.content ?? []).forEach(walk);
  };
  walk(d);
  return out;
}

const markOf = (n: JSONContent | undefined, type: string) => n?.marks?.find((m) => m.type === type);
const nodeWith = (d: JSONContent, text: string) => textNodes(d).find((n) => n.text === text);

describe('colour conversion', () => {
  it('turns any CSS colour the editor stores into Word hex', () => {
    expect(cssToDocxHex('#ff0000')).toBe('FF0000');
    expect(cssToDocxHex('#f00')).toBe('FF0000');
    expect(cssToDocxHex('rgb(255, 229, 153)')).toBe('FFE599');
    expect(cssToDocxHex('#12345680')).toBe('123456');
  });

  it('gives up on what it cannot read instead of writing junk', () => {
    expect(cssToDocxHex('var(--accent)')).toBeNull();
    expect(cssToDocxHex('')).toBeNull();
    expect(cssToDocxHex(undefined)).toBeNull();
    expect(docxColorProps({ color: 'nonsense' })).toEqual({});
  });

  it('writes a Word highlight by default and exact shading only when asked', () => {
    expect(docxColorProps({ highlight: '#ffe599' })).toEqual({ highlight: 'yellow' });
    expect(docxColorProps({ highlight: '#ffe599' }, { exactHighlights: true }))
      .toEqual({ shading: { type: 'clear', color: 'auto', fill: 'FFE599' } });
    expect(docxColorProps({ highlight: 'nonsense' })).toEqual({});
  });

  it('matches a picked highlight to the Word colour it looks like', () => {
    // Every swatch in the editor's colour picker, and the pastels a writer
    // usually highlights with, which plain colour distance sends to grey.
    const cases: [string, string | null][] = [
      ['#ffff00', 'yellow'], ['#ffe599', 'yellow'], ['#ffff66', 'yellow'], ['#ffcc00', 'yellow'],
      ['#ffcc66', 'yellow'], ['#fde68a', 'yellow'],
      ['#ff0000', 'red'], ['#ff6666', 'red'], ['#ff6600', 'red'], ['#cc0000', 'red'],
      ['#33cc33', 'green'], ['#66ff66', 'green'], ['#006600', 'darkGreen'],
      ['#66ccff', 'cyan'], ['#008080', 'darkCyan'],
      ['#0066ff', 'blue'], ['#003399', 'darkBlue'],
      ['#cc66ff', 'magenta'], ['#660099', 'darkMagenta'],
      ['#999900', 'darkYellow'],
      ['#000000', 'black'], ['#333333', 'black'], ['#666666', 'darkGray'], ['#999999', 'darkGray'],
      ['#cccccc', 'lightGray'],
      ['#ffffff', null], ['rgb(250, 250, 250)', null],
    ];
    for (const [css, name] of cases) expect([css, nearestWordHighlight(css)]).toEqual([css, name]);
    expect(nearestWordHighlight('nonsense')).toBeNull();
    expect(nearestWordHighlight(undefined)).toBeNull();
  });

  it('reads Word hex and named highlights back as CSS', () => {
    expect(docxHexToCss('FF0000')).toBe('#ff0000');
    expect(docxHexToCss('auto')).toBeNull();
    expect(wordHighlightToCss('yellow')).toBe('#ffff00');
    expect(wordHighlightToCss('darkGreen')).toBe('#008000');
    expect(wordHighlightToCss('none')).toBeNull();
  });
});

describe('runs carry colour and highlight', () => {
  it('reads both off the marks', () => {
    const [run] = jsonBlockRuns(marked('action', 'hot', red, yellow));
    expect(run.color).toBe('#ff0000');
    expect(run.highlight).toBe('#ffe599');
  });

  it('reports a colourless highlight as the default yellow the editor draws', () => {
    const [run] = jsonBlockRuns(marked('action', 'hot', { type: 'highlight', attrs: { color: null } }));
    expect(run.highlight).toBe(DEFAULT_HIGHLIGHT);
  });

  it('leaves plain text with neither', () => {
    const [run] = jsonBlockRuns(block('action', 'plain'));
    expect(run).not.toHaveProperty('color');
    expect(run).not.toHaveProperty('highlight');
  });

  it('does not split Fountain runs on colour, which Fountain cannot write', () => {
    const merged = mergeRuns(jsonBlockRuns({
      type: 'action',
      content: [
        { type: 'text', text: 'a', marks: [{ type: 'bold' }, red] },
        { type: 'text', text: 'b', marks: [{ type: 'bold' }] },
      ],
    }));
    expect(merged).toHaveLength(1);
  });
});

describe('Word export writes colour and highlight', () => {
  it('writes the text colour, and the highlight as Word’s own', async () => {
    const xml = await documentXml(await exportBytes(doc(
      marked('action', 'Red words.', red),
      marked('action', 'Marked words.', yellow),
    )));
    expect(xml).toMatch(/<w:color w:val="FF0000"\/>/);
    // A real highlight, which Word's highlighter can take off again.
    expect(xml).toMatch(/<w:highlight w:val="yellow"\/>/);
    expect(xml).not.toMatch(/<w:shd /);
  });

  it('writes the highlight as exact-colour shading when asked', async () => {
    const xml = await documentXml(await exportBytes(doc(
      marked('action', 'Marked words.', yellow),
    ), { exactHighlights: true }));
    expect(xml).toMatch(/<w:shd [^>]*w:fill="FFE599"/);
    expect(xml).not.toMatch(/<w:highlight /);
  });

  it('keeps them on a dialogue line and through the type styles', async () => {
    const xml = await documentXml(await exportBytes(doc(
      block('character', 'JOHN'),
      marked('dialogue', 'Look out.', red, yellow),
      marked('sceneHeading', 'INT. HOUSE - DAY', red),
    )));
    expect(xml.match(/<w:color w:val="FF0000"\/>/g)).toHaveLength(2);
    expect(xml).toMatch(/<w:highlight w:val="yellow"\/>/);
  });

  it('writes nothing for text the writer did not colour', async () => {
    const xml = await documentXml(await exportBytes(doc(block('action', 'Plain.'))));
    expect(xml).not.toMatch(/<w:color /);
    expect(xml).not.toMatch(/<w:shd /);
    expect(xml).not.toMatch(/<w:highlight /);
  });
});

describe('Word import reads colour and highlight', () => {
  it('round-trips a highlight as the Word colour it was written in', async () => {
    const back = await importBytes(await exportBytes(doc(
      block('action', 'Before ', { type: 'text', text: 'hot', marks: [red, yellow] }, ' after.'),
    )));
    const hot = nodeWith(back, 'hot');
    expect(markOf(hot, 'textStyle')?.attrs?.color).toBe('#ff0000');
    expect(markOf(hot, 'highlight')?.attrs?.color).toBe('#ffff00');
  });

  it('round-trips both exactly through an exact-colour export', async () => {
    const back = await importBytes(await exportBytes(doc(
      block('action', 'Before ', { type: 'text', text: 'hot', marks: [red, yellow] }, ' after.'),
    ), { exactHighlights: true }));
    const hot = nodeWith(back, 'hot');
    expect(markOf(hot, 'textStyle')?.attrs?.color).toBe('#ff0000');
    expect(markOf(hot, 'highlight')?.attrs?.color).toBe('#ffe599');
    const plain = nodeWith(back, 'Before ');
    expect(markOf(plain, 'textStyle')).toBeUndefined();
    expect(markOf(plain, 'highlight')).toBeUndefined();
  });

  it('reads the named highlight Word’s own highlighter writes', async () => {
    const back = await importBytes(await wordFile(
      '<w:r><w:rPr><w:highlight w:val="green"/></w:rPr><w:t>go</w:t></w:r>',
    ));
    expect(markOf(nodeWith(back, 'go'), 'highlight')?.attrs?.color).toBe('#00ff00');
  });

  it('prefers the named highlight over shading, as Word draws it', async () => {
    const back = await importBytes(await wordFile(
      '<w:r><w:rPr><w:highlight w:val="cyan"/><w:shd w:val="clear" w:color="auto" w:fill="FFE599"/></w:rPr><w:t>both</w:t></w:r>',
    ));
    expect(markOf(nodeWith(back, 'both'), 'highlight')?.attrs?.color).toBe('#00ffff');
  });

  it('reads solid shading from its pattern colour', async () => {
    const back = await importBytes(await wordFile(
      '<w:r><w:rPr><w:shd w:val="solid" w:color="FF00FF" w:fill="auto"/></w:rPr><w:t>pink</w:t></w:r>',
    ));
    expect(markOf(nodeWith(back, 'pink'), 'highlight')?.attrs?.color).toBe('#ff00ff');
  });

  it('ignores the blanket black ink and white shading Word writes everywhere', async () => {
    const back = await importBytes(await wordFile(
      '<w:r><w:rPr><w:color w:val="000000"/><w:shd w:val="clear" w:color="auto" w:fill="FFFFFF"/></w:rPr><w:t>ink</w:t></w:r>'
      + '<w:r><w:rPr><w:color w:val="auto"/><w:highlight w:val="none"/></w:rPr><w:t> auto</w:t></w:r>',
    ));
    for (const n of textNodes(back)) {
      expect(markOf(n, 'textStyle')).toBeUndefined();
      expect(markOf(n, 'highlight')).toBeUndefined();
    }
  });
});
