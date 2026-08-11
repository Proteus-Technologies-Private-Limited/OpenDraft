/**
 * Final Draft and the document typeface.
 *
 * FDX keeps a script's font on each element's `<FontSpec>`, not on its text —
 * so a script set in anything but Courier used to export claiming Courier, and
 * import as Courier no matter what the file said.  Both directions are checked
 * here, including the round trip, since export and import have to agree on
 * where the font lives or a script loses it on every save-and-reopen.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { exportFDX } from './fdxExporter';
import { isDocumentFont, isDocumentSize } from './fonts';
import { doc, block } from '../test/screenplaySchema';

/** Every Font= named on an element's FontSpec. */
const fontSpecFonts = (xml: string) =>
  [...new Set([...xml.matchAll(/<FontSpec[^>]*Font="([^"]+)"/g)].map((m) => m[1]))].sort();

/** Every Font= named on a text run. */
const runFonts = (xml: string) =>
  [...new Set([...xml.matchAll(/<Text[^>]*Font="([^"]+)"/g)].map((m) => m[1]))].sort();

const script = doc(
  block('sceneHeading', 'INT. LIBRARY - DAY'),
  block('action', 'A PROGRAMMER types.'),
  block('character', 'PROGRAMMER'),
  block('dialogue', 'Eureka.'),
);

/** A block whose single run carries a font of its own. */
const styled = (font: string) => ({
  type: 'action',
  content: [{ type: 'text', text: 'A note.', marks: [{ type: 'textStyle', attrs: { fontFamily: font } }] }],
});

describe('export', () => {
  it('writes the screenplay Courier when the document font is unset', () => {
    expect(fontSpecFonts(exportFDX(script))).toEqual(['Courier Prime']);
  });

  it('writes the document font onto every element', () => {
    const xml = exportFDX(script, 'T', undefined, undefined, undefined, undefined, undefined, undefined, {
      family: 'Times New Roman',
      size: 12,
    });
    expect(fontSpecFonts(xml)).toEqual(['Times New Roman']);
  });

  it('carries the point size too', () => {
    const xml = exportFDX(script, 'T', undefined, undefined, undefined, undefined, undefined, undefined, {
      family: 'Georgia',
      size: 11,
    });
    expect(xml).toContain('Font="Georgia" RevisionID="0" Size="11"');
  });

  it('leaves no interpolation unresolved in the header run', () => {
    // The header's Text run is built in a plain string, so a template
    // placeholder there would ship verbatim into the file.
    expect(exportFDX(script)).not.toContain('${');
  });

  it('writes a section font on the run, over the document font', () => {
    const xml = exportFDX(doc(block('action', 'Plain.'), styled('Arial')), 'T',
      undefined, undefined, undefined, undefined, undefined, undefined,
      { family: 'Times New Roman', size: 12 });

    expect(fontSpecFonts(xml)).toEqual(['Times New Roman']);
    expect(runFonts(xml)).toContain('Arial');
  });
});

describe('import', () => {
  /*
   * fdxParser needs a browser DOM (22 querySelector calls, some with :scope),
   * and the suite runs without one — see test/setup.ts.  What it decides about
   * fonts is the shared logic in utils/fonts, exercised directly here; the DOM
   * plumbing that feeds it is covered by the round-trip check run against real
   * Chrome in test-script/fdx-font-roundtrip.mjs.
   */
  it('treats a run in the document font as unstyled', () => {
    expect(isDocumentFont('Times New Roman', 'Times New Roman')).toBe(true);
    expect(isDocumentFont('Arial', 'Times New Roman')).toBe(false);
  });

  it('falls back to the Courier family when the file names no font', () => {
    for (const courier of ['Courier', 'Courier Prime', 'Courier New', 'Courier Final Draft']) {
      expect(isDocumentFont(courier, ''), courier).toBe(true);
    }
    expect(isDocumentFont('Times New Roman', '')).toBe(false);
  });

  it('treats a missing font attribute as the document font', () => {
    expect(isDocumentFont(null, 'Times New Roman')).toBe(true);
    expect(isDocumentFont(undefined, '')).toBe(true);
  });

  it('measures size against the document size, not a fixed 12', () => {
    expect(isDocumentSize('11', '11')).toBe(true);
    expect(isDocumentSize('12', '11')).toBe(false);
    // No document size recorded: a screenplay is 12pt.
    expect(isDocumentSize('12', '')).toBe(true);
    expect(isDocumentSize('14', '')).toBe(false);
  });
});
