/**
 * Revisions in and out of the interchange formats: Final Draft's revision
 * list read back, and the marks Word, Fountain and Fade In now carry.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { DOMParser as XmlDOMParser } from '@xmldom/xmldom';
import JSZip from 'jszip';
import type { JSONContent } from '@tiptap/react';
import { exportFDX } from './fdxExporter';
import { colorFromPageColor, colorFromRevisionName, parseFDXRevisions } from './fdxRevisions';
import { exportFountain } from './fountainExporter';
import { parseFountain } from './fountainParser';
import { exportOSF } from './osfExporter';
import { parseOSF } from './osfParser';
import { blockRevision, parseFountainRevisionNote } from './revisionExport';
import { importedSceneNumbering } from './importScreenplay';
import { exportDocx } from './docxExporter';
import { DEFAULT_PAGE_LAYOUT } from '../stores/editorStore';

/** The last file exportDocx saved. */
let saved: Uint8Array | null = null;
vi.mock('./fileOps', () => ({
  saveFile: async (data: Uint8Array) => { saved = data; return true; },
}));

beforeAll(() => {
  if (typeof globalThis.DOMParser === 'undefined') {
    (globalThis as unknown as { DOMParser: unknown }).DOMParser = XmlDOMParser;
  }
});

const rev = (text: string, color: string): JSONContent => ({ type: 'text', text, marks: [{ type: 'textStyle', attrs: { revision: color } }] });
const txt = (text: string): JSONContent => ({ type: 'text', text });
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });
const xml = (s: string) => new XmlDOMParser().parseFromString(s, 'text/xml') as unknown as Document;

describe('blockRevision', () => {
  it('is the latest round in the block, text or flag', () => {
    expect(blockRevision({ type: 'action', content: [rev('a', 'Blue'), rev('b', 'Pink')] })).toBe('Pink');
    expect(blockRevision({ type: 'action', attrs: { revised: 'Yellow' }, content: [rev('a', 'Blue')] })).toBe('Yellow');
    expect(blockRevision({ type: 'action', content: [txt('a')] })).toBeNull();
  });
});

describe('Final Draft revisions read back', () => {
  it('maps Final Draft names and page colours onto the sequence', () => {
    expect(colorFromRevisionName('Blue Rev.')).toBe('Blue');
    expect(colorFromRevisionName('Pink Revision')).toBe('Pink');
    expect(colorFromRevisionName('Second Blue')).toBe('2nd Blue');
    expect(colorFromRevisionName('Revision 3')).toBeNull();
    expect(colorFromPageColor('#E0E06C6C9F9F')).toBe('Pink');
    expect(colorFromPageColor('#123456')).toBeNull();
  });

  it('reads what our own export writes: colours, marks, mode and active set', () => {
    const out = exportFDX(
      doc({ type: 'action', content: [rev('New.', 'Blue'), rev(' Newer.', 'Pink')] }),
      't', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      { mode: true, color: 'Pink', settings: { markChar: '*', marks: { Pink: '+' }, colorPages: false } },
    );
    expect(out).toContain('Mark="+" Name="Pink Revision"');
    const r = parseFDXRevisions(xml(out))!;
    expect(r.mode).toBe(true);
    expect(r.color).toBe('Pink');
    expect(r.colors).toEqual(['Blue', 'Pink']);
    expect(r.settings.markChar).toBe('*');
    expect(r.settings.marks).toEqual({ Pink: '+' });
    // The run IDs point at the same colours.
    const ids = [...out.matchAll(/RevisionID="(\d+)"/g)].map((m) => m[1]).filter((id) => id !== '0');
    expect(ids.map((id) => r.colorById.get(id))).toEqual(['Blue', 'Pink']);
  });

  it('falls back on list order for revisions named nothing it knows', () => {
    const r = parseFDXRevisions(xml(
      '<FinalDraft><Revisions ActiveSet="2" RevisionMode="No">'
      + '<Revision ID="1" Name="First" Mark="*"/><Revision ID="2" Name="Second" Mark="*"/>'
      + '</Revisions></FinalDraft>',
    ))!;
    expect([...r.colorById.values()]).toEqual(['Blue', 'Pink']);
    expect(r.color).toBe('Pink');
  });

  it('reads only the active round when Final Draft hides the others', () => {
    const r = parseFDXRevisions(xml(
      '<FinalDraft><Revisions ActiveSet="3" RevisionMode="Yes" ShowAllMarks="No" ShowAllSets="No">'
      + '<Revision ID="2" Name="Blue Rev." Mark="*"/><Revision ID="3" Name="Pink Rev." Mark="*"/>'
      + '</Revisions></FinalDraft>',
    ))!;
    expect([...r.colorById.entries()]).toEqual([['3', 'Pink']]);
  });

  it('is null for a file with no revisions', () => {
    expect(parseFDXRevisions(xml('<FinalDraft><Content/></FinalDraft>'))).toBeNull();
  });
});

describe('imported scene numbers', () => {
  const heading = (n?: string): JSONContent => ({ type: 'sceneHeading', attrs: n ? { sceneNumber: n } : {}, content: [txt('INT. X')] });
  it('shows and locks production numbering, and leaves plain 1, 2, 3 alone', () => {
    expect(importedSceneNumbering(doc(heading('1'), heading('2')))).toBeNull();
    expect(importedSceneNumbering(doc(heading('1'), heading('1A'), heading('2')))).toEqual({ visible: true, locked: true });
    expect(importedSceneNumbering(doc(heading('1'), heading('3')))).toEqual({ visible: true, locked: true });
    expect(importedSceneNumbering(doc(heading(), heading()))).toBeNull();
  });

  it('marks an import as following the standard scene spacing when it carries settings', async () => {
    const { fdxMetadata } = await import('./importScreenplay');
    const meta = fdxMetadata({ doc: doc(heading('1'), heading('1A')), revisions: null } as unknown as Parameters<typeof fdxMetadata>[0]);
    expect(meta._sceneHeadingSpaceBefore).toBeNull();
    expect('_sceneHeadingSpaceBefore' in fdxMetadata({ doc: doc(heading()), revisions: null } as unknown as Parameters<typeof fdxMetadata>[0])).toBe(false);
  });
});

describe('Fountain', () => {
  const script = doc(
    { type: 'sceneHeading', attrs: { sceneNumber: '12' }, content: [rev('INT. HOUSE - DAY', 'Blue')] },
    { type: 'action', content: [txt('Nothing new.')] },
    { type: 'action', attrs: { revised: 'Pink' }, content: [txt('Shortened.')] },
    { type: 'transition', content: [rev('CUT TO:', 'Blue')] },
  );

  it('marks each revised element in a note, after its scene number and transition text', () => {
    const out = exportFountain(script, { revisionSettings: { markChar: '*', marks: { Pink: '+' }, colorPages: false } });
    expect(out).toContain('INT. HOUSE - DAY #12# [[* Blue revision]]');
    expect(out).toContain('Shortened. [[+ Pink revision]]');
    expect(out).toContain('> CUT TO: [[* Blue revision]]');
    expect(out).not.toContain('Nothing new. [[');
  });

  it('reads the marks back as revisions, keeping the elements intact', () => {
    const back = parseFountain(exportFountain(script));
    const body = (back.content ?? []).filter((n) => n.type !== 'titlePage');
    expect(body.map((n) => n.type)).toEqual(['sceneHeading', 'action', 'action', 'transition']);
    expect(body.map((n) => n.attrs?.revised ?? null)).toEqual(['Blue', null, 'Pink', 'Blue']);
    expect(body.some((n) => n.type === 'note')).toBe(false);
    expect(body[0].attrs?.sceneNumber).toBe('12');
  });

  it('leaves an ordinary note alone', () => {
    expect(parseFountainRevisionNote('* check this')).toBeNull();
    expect(parseFountainRevisionNote('+ Blue')).toBeNull();
    expect(parseFountainRevisionNote('* blue revision')).toBeNull();
    expect(parseFountainRevisionNote('* Blue revision')).toBe('Blue');
    expect(parseFountainRevisionNote('* 2nd Pink revision')).toBe('2nd Pink');
  });

  it('keeps a writer\'s own colour note as a note', () => {
    const back = parseFountain('INT. HOUSE - DAY\n\nShe waits. [[+ Blue]]\n');
    const types = (back.content ?? []).map((n) => n.type);
    expect(types).toContain('note');
    expect((back.content ?? []).every((n) => !n.attrs?.revised)).toBe(true);
  });
});

describe('hidden scene numbers', () => {
  const numbered = doc({ type: 'sceneHeading', attrs: { sceneNumber: '12A' }, content: [txt('INT. HOUSE - DAY')] });
  it('stay out of Fountain, Final Draft and Fade In, as hiding them did before', () => {
    expect(exportFountain(numbered, { sceneNumbersVisible: false })).not.toContain('#12A#');
    expect(exportFountain(numbered)).toContain('#12A#');
    const fdxOut = (visible: boolean) => exportFDX(numbered, 't', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, { sceneNumbersVisible: visible });
    expect(fdxOut(false)).not.toContain('Number="12A"');
    expect(fdxOut(true)).toContain('Number="12A"');
    expect(exportOSF(numbered, { sceneNumbers: { visible: false, locked: true } })).not.toContain('scene_number="12A"');
    expect(exportOSF(numbered, { sceneNumbers: { visible: true, locked: true } })).toContain('scene_number="12A"');
  });
});

describe('Fade In', () => {
  const script = doc(
    { type: 'action', content: [rev('A change.', 'Blue')] },
    { type: 'action', content: [txt('Unchanged.')] },
    { type: 'dialogue', attrs: { revised: 'Pink' }, content: [txt('Cut short.')] },
  );

  it('writes the revision table and a mark on each revised paragraph', () => {
    const out = exportOSF(script, { revisions: { color: 'Pink', settings: { markChar: '*', marks: { Pink: '+' }, colorPages: false } } });
    expect(out).toContain('<revision_color name="Blue" index="1" color_name="Blue" color_index="1" mark="*"/>');
    expect(out).toContain('<revision_color name="Pink" index="2" color_name="Pink" color_index="2" mark="+"/>');
    expect(out).toContain('revision="2" show_revisions="true"');
    expect(out.match(/<mark at="0" revision="\d+"\/>/g)).toEqual(['<mark at="0" revision="1"/>', '<mark at="0" revision="2"/>']);
  });

  it('writes nothing about revisions for an unrevised script', () => {
    const out = exportOSF(doc({ type: 'action', content: [txt('Plain.')] }), { revisions: { color: 'White' } });
    expect(out).not.toContain('revision');
  });

  it('reads the marks back', () => {
    const back = parseOSF(exportOSF(script));
    expect((back.doc.content ?? []).map((n) => n.attrs?.revised ?? null)).toEqual(['Blue', null, 'Pink']);
  });
});

describe('Word', () => {
  async function documentXml(d: JSONContent, settings?: Parameters<typeof exportDocx>[3]): Promise<string> {
    saved = null;
    await exportDocx(d, 't', DEFAULT_PAGE_LAYOUT, settings);
    const zip = await JSZip.loadAsync(saved!);
    return zip.file('word/document.xml')!.async('string');
  }

  it('puts the revision mark after a tab to a stop in the right margin', async () => {
    const out = await documentXml(doc(
      { type: 'action', content: [rev('Revised.', 'Blue')] },
      { type: 'action', content: [txt('Plain.')] },
    ), { revisionSettings: { markChar: '#', marks: {}, colorPages: false } });
    expect(out).toMatch(/<w:tab w:val="left" w:pos="\d+"\/>/);
    // A real tab element, then the mark — never a tab character in the text.
    expect(out).toMatch(/<w:tab\/><w:t[^>]*>#<\/w:t>/);
    expect(out).not.toMatch(/<w:t[^>]*>[^<]*\t/);
    expect(out.match(/#<\/w:t>/g)?.length).toBe(1);
  });

  it('lays a right-aligned transition out with tab stops so the mark can follow it', async () => {
    const out = await documentXml(doc({ type: 'transition', content: [rev('CUT TO:', 'Blue')] }));
    const para = out.slice(out.indexOf('<w:p>'), out.indexOf('</w:p>'));
    expect(para).toMatch(/<w:tab w:val="right" w:pos="\d+"\/><w:tab w:val="left" w:pos="\d+"\/>/);
    expect(para).toContain('<w:jc w:val="left"/>');
    expect(para).toMatch(/<w:tab\/>.*CUT TO:.*<w:tab\/><w:t[^>]*>\*<\/w:t>/);
  });

  it('writes no marks when told not to', async () => {
    const out = await documentXml(doc({ type: 'action', content: [rev('Revised.', 'Blue')] }), { showRevisionMarks: false });
    expect(out).not.toMatch(/\*<\/w:t>/);
  });
});
