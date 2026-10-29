/**
 * Bookmarks and alternates through Final Draft, Fade In / OSF and Fountain.
 *
 * Each format is checked both ways round: what OpenDraft writes comes back as
 * the same bookmark and the same versions, and what another application would
 * show — the element's text — is exactly the version in use, with nothing
 * added to it.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { DOMParser as XmlDOMParser } from '@xmldom/xmldom';
import type { JSONContent } from '@tiptap/react';
import { exportFDX } from './fdxExporter';
import { exportOSF } from './osfExporter';
import { parseOSF } from './osfParser';
import { exportFountain } from './fountainExporter';
import { parseFountain } from './fountainParser';
import {
  decodeAlternates, fdxParagraphAnnotations, osfParagraphAnnotations,
  parseFountainAnnotation, fountainBookmarkNote,
} from './formatAnnotations';
import { testSchema } from '../test/screenplaySchema';

beforeAll(() => {
  if (typeof globalThis.DOMParser === 'undefined') {
    (globalThis as unknown as { DOMParser: unknown }).DOMParser = XmlDOMParser;
  }
});

const txt = (text: string, ...marks: string[]): JSONContent =>
  (marks.length ? { type: 'text', text, marks: marks.map((type) => ({ type })) } : { type: 'text', text });
const el = (type: string, attrs: Record<string, unknown> | null, ...content: JSONContent[]): JSONContent =>
  (attrs ? { type, attrs, content } : { type, content });
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content });

/** Version 2 of 3 showing: the stored list is V3, then V1 (cycle order after the one showing). */
const DIALOGUE_VERSIONS = [
  { id: 'v3', content: [txt('Third '), txt('take', 'italic'), txt('.')] },
  { id: 'v1', content: [txt('First take.')] },
];
const dialogueWithVersions = () =>
  el('dialogue', { alternates: DIALOGUE_VERSIONS, alternateIndex: 1 }, txt('Second take.'));

function flat(node: JSONContent): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  return (node.content ?? []).map(flat).join('');
}

/** Every text element, dual-dialogue columns opened up, title page left out. */
function blocks(d: JSONContent): JSONContent[] {
  const out: JSONContent[] = [];
  const walk = (n: JSONContent) => {
    if (n.type === 'dualDialogue' || n.type === 'dualDialogueColumn') (n.content ?? []).forEach(walk);
    else if (n.type !== 'titlePage') out.push(n);
  };
  (d.content ?? []).forEach(walk);
  return out;
}

const xml = (s: string) => new XmlDOMParser().parseFromString(s, 'text/xml') as unknown as Document;

/** The script paragraphs of an .fdx, read the way fdxParser reads them. */
function fdxParagraphs(out: string): Element[] {
  const content = xml(out).getElementsByTagName('Content');
  // The title page has a <Content> of its own; the script's is the last.
  const body = content[content.length - 1];
  return Array.from(body.getElementsByTagName('Paragraph'));
}

const FDX_TYPE: Record<string, string> = { 'Scene Heading': 'sceneHeading', Action: 'action', Character: 'character', Dialogue: 'dialogue' };

// ── Final Draft ────────────────────────────────────────────────────────────

describe('Final Draft (.fdx)', () => {
  it('writes a bookmark as Final Draft\'s own Bookmark attribute and reads it back', () => {
    const out = exportFDX(doc(
      el('sceneHeading', { bookmark: 'Act two "starts" here' }, txt('INT. HOUSE - DAY')),
      el('action', null, txt('Quiet.')),
    ));
    expect(out).toContain('Bookmark="Act two &quot;starts&quot; here"');
    const [heading, action] = fdxParagraphs(out);
    expect(fdxParagraphAnnotations(heading, 'sceneHeading')).toEqual({ bookmark: 'Act two "starts" here' });
    expect(fdxParagraphAnnotations(action, 'action')).toEqual({});
  });

  it('reads a bookmark Final Draft wrote', () => {
    // As Final Draft 8 writes them (sample_script.fdx).
    const [p] = Array.from(xml(
      '<FinalDraft><Content><Paragraph Bookmark="Eight months later" Type="Action"><Text>Snow.</Text></Paragraph></Content></FinalDraft>',
    ).getElementsByTagName('Paragraph'));
    expect(fdxParagraphAnnotations(p, 'action')).toEqual({ bookmark: 'Eight months later' });
  });

  it('carries every version of a line, and Final Draft sees only the one in use', () => {
    const out = exportFDX(doc(el('character', null, txt('ANNA')), dialogueWithVersions()));
    const paras = fdxParagraphs(out);
    const dialogue = paras.find((p) => p.getAttribute('Type') === 'Dialogue')!;
    // The text runs — all any other application reads — hold the version in use.
    const runs = Array.from(dialogue.getElementsByTagName('Text')).map((t) => t.textContent).join('');
    expect(runs).toBe('Second take.');
    expect(out).not.toContain('<Text>First take.</Text>');
    expect(fdxParagraphAnnotations(dialogue, 'dialogue')).toEqual({ alternates: DIALOGUE_VERSIONS, alternateIndex: 1 });
  });

  it('keeps versions inside dual dialogue and bookmarks on its lines', () => {
    const out = exportFDX(doc({
      type: 'dualDialogue',
      content: [
        { type: 'dualDialogueColumn', content: [el('character', { bookmark: 'Duet' }, txt('ANNA')), dialogueWithVersions()] },
        { type: 'dualDialogueColumn', content: [el('character', null, txt('BEN')), el('dialogue', null, txt('No.'))] },
      ],
    }));
    const read = fdxParagraphs(out).map((p) => fdxParagraphAnnotations(p, FDX_TYPE[p.getAttribute('Type') ?? ''] ?? 'general'));
    expect(read[0]).toEqual({ bookmark: 'Duet' });
    expect(read[1]).toEqual({ alternates: DIALOGUE_VERSIONS, alternateIndex: 1 });
  });

  it('ignores damaged or misplaced versions without failing the import', () => {
    const [bad, misplaced] = Array.from(xml(
      '<FinalDraft><Content>'
      + '<Paragraph Type="Dialogue" data-od-alternates="{not json"><Text>Hi.</Text></Paragraph>'
      + '<Paragraph Type="Character" data-od-alternates="[{&quot;id&quot;:&quot;a&quot;,&quot;content&quot;:[]}]"><Text>ANNA</Text></Paragraph>'
      + '</Content></FinalDraft>',
    ).getElementsByTagName('Paragraph'));
    const warnings: string[] = [];
    expect(fdxParagraphAnnotations(bad, 'dialogue', warnings)).toEqual({});
    expect(warnings).toHaveLength(1);
    // A character cue cannot hold versions.
    expect(fdxParagraphAnnotations(misplaced, 'character')).toEqual({});
  });

  it('writes nothing new for a script without bookmarks or versions', () => {
    const out = exportFDX(doc(el('action', null, txt('Plain.'))));
    expect(out).not.toContain('Bookmark=');
    expect(out).not.toContain('data-od-');
  });
});

// ── Fade In / OSF ──────────────────────────────────────────────────────────

describe('Fade In / OSF', () => {
  it('round-trips bookmarks and versions', () => {
    const source = doc(
      el('sceneHeading', { bookmark: 'Opening' }, txt('INT. HOUSE - DAY')),
      el('action', { alternates: [{ id: 'a1', content: [txt('Rain, '), txt('hard', 'bold'), txt('.')] }], alternateIndex: 0 }, txt('Sun.')),
      el('character', null, txt('ANNA')),
      el('dialogue', { bookmark: 'The line' }, txt('Hello.')),
    );
    const out = exportOSF(source);
    expect(out).toContain('bookmark="Opening"');
    const parsed = parseOSF(out);
    const read = blocks(parsed.doc);
    expect(read.map(flat)).toEqual(['INT. HOUSE - DAY', 'Sun.', 'ANNA', 'Hello.']);
    expect(read[0].attrs?.bookmark).toBe('Opening');
    expect(read[1].attrs?.alternates).toEqual(source.content![1].attrs!.alternates);
    expect(read[1].attrs?.alternateIndex).toBe(0);
    expect(read[3].attrs?.bookmark).toBe('The line');
    expect(parsed.warnings).toEqual([]);
    expect(() => testSchema.nodeFromJSON(parsed.doc)).not.toThrow();
  });

  it('keeps versions on dual dialogue', () => {
    const parsed = parseOSF(exportOSF(doc({
      type: 'dualDialogue',
      content: [
        { type: 'dualDialogueColumn', content: [el('character', null, txt('ANNA')), dialogueWithVersions()] },
        { type: 'dualDialogueColumn', content: [el('character', null, txt('BEN')), el('dialogue', null, txt('No.'))] },
      ],
    })));
    const dialogue = blocks(parsed.doc)[1];
    expect(flat(dialogue)).toBe('Second take.');
    expect(dialogue.attrs?.alternates).toEqual(DIALOGUE_VERSIONS);
    expect(dialogue.attrs?.alternateIndex).toBe(1);
  });

  it('reads a bookmark as the OSF specimen writes one', () => {
    // OSF-4.0.xml in the OSF SDK.
    const parsed = parseOSF(
      '<document type="Open Screenplay Format document" version="40"><paragraphs>'
      + '<para page_number="1" bookmark="Bookmark"><style basestyle="Action"/><text>...following line\'s bookmark.</text></para>'
      + '</paragraphs></document>',
    );
    expect(blocks(parsed.doc)[0].attrs?.bookmark).toBe('Bookmark');
  });

  it('warns about damaged versions and keeps the line', () => {
    const [p] = Array.from(xml('<paragraphs><para od_alternates="[oops"><text>Hi.</text></para></paragraphs>').getElementsByTagName('para'));
    const warnings: string[] = [];
    expect(osfParagraphAnnotations(p, 'action', warnings)).toEqual({});
    expect(warnings[0]).toMatch(/could not be read/);
    const parsed = parseOSF(
      '<document version="30"><paragraphs><para od_alternates="[oops"><style basestylename="Action"/><text>Hi.</text></para></paragraphs></document>',
    );
    expect(flat(blocks(parsed.doc)[0])).toBe('Hi.');
  });
});

// ── Fountain ───────────────────────────────────────────────────────────────

describe('Fountain', () => {
  it('writes a bookmark as a note on the element\'s line and reads it back', () => {
    const source = doc(
      el('sceneHeading', { bookmark: 'Opening', sceneNumber: '1', synopsis: 'Where it starts.' }, txt('INT. HOUSE - DAY')),
      el('action', { bookmark: 'Big [[moment]]' }, txt('A door slams.')),
      el('section', { bookmark: 'Act one', level: 1 }, txt('ACT ONE')),
      el('character', { bookmark: 'Anna speaks' }, txt('ANNA')),
      el('dialogue', null, txt('Hi.')),
      el('parenthetical', null, txt('(beat)')),
      el('dialogue', { bookmark: 'Second line' }, txt('Bye.')),
    );
    const out = exportFountain(source);
    expect(out).toContain('INT. HOUSE - DAY #1# [[Bookmark: Opening]]');
    const read = blocks(parseFountain(out));
    // Not a word of the script changed.
    expect(read.map((n) => [n.type, flat(n)])).toEqual([
      ['sceneHeading', 'INT. HOUSE - DAY'], ['action', 'A door slams.'], ['section', 'ACT ONE'],
      ['character', 'ANNA'], ['dialogue', 'Hi.'], ['parenthetical', '(beat)'], ['dialogue', 'Bye.'],
    ]);
    expect(read.map((n) => n.attrs?.bookmark ?? null)).toEqual([
      'Opening', 'Big [[moment]]', 'Act one', 'Anna speaks', null, null, 'Second line',
    ]);
    expect(read[0].attrs?.synopsis).toBe('Where it starts.');
    expect(read[0].attrs?.sceneNumber).toBe('1');
  });

  it('writes each other version as a note and puts them back in order', () => {
    const source = doc(
      el('character', null, txt('ANNA')),
      dialogueWithVersions(),
      el('action', { alternates: [{ id: 'x', content: [txt('Two'), { type: 'hardBreak' }, txt('lines [here]')] }], alternateIndex: 0 }, txt('One line.')),
    );
    const out = exportFountain(source);
    expect(out).toContain('Second take. [[Alternate 1/3: First take.]] [[Alternate 3/3: Third *take*.]]');
    const read = blocks(parseFountain(out));
    expect(read.map(flat)).toEqual(['ANNA', 'Second take.', 'One line.']);
    expect(read[1].attrs?.alternateIndex).toBe(1);
    expect(read[1].attrs?.alternates.map((a: { content: JSONContent[] }) => a.content)).toEqual(
      DIALOGUE_VERSIONS.map((v) => v.content),
    );
    // A break inside a version cannot sit in a one-line note; it becomes a space.
    expect(read[2].attrs?.alternates[0].content).toEqual([txt('Two lines [here]')]);
    expect(() => testSchema.nodeFromJSON(parseFountain(out))).not.toThrow();
  });

  it('keeps versions and bookmarks on the right side of dual dialogue', () => {
    const out = exportFountain(doc({
      type: 'dualDialogue',
      content: [
        { type: 'dualDialogueColumn', content: [el('character', null, txt('ANNA')), el('dialogue', { bookmark: 'Left' }, txt('Yes.'))] },
        { type: 'dualDialogueColumn', content: [el('character', null, txt('BEN')), dialogueWithVersions()] },
      ],
    }));
    const parsed = parseFountain(out);
    expect(parsed.content?.[0].type).toBe('dualDialogue');
    const read = blocks(parsed);
    expect(read.map(flat)).toEqual(['ANNA', 'Yes.', 'BEN', 'Second take.']);
    expect(read[1].attrs?.bookmark).toBe('Left');
    expect(read[3].attrs?.alternateIndex).toBe(1);
    expect(read[3].attrs?.alternates).toHaveLength(2);
  });

  it('sits beside a revision mark without disturbing it', () => {
    const out = exportFountain(doc(el('action', { bookmark: 'Fix', revised: 'Blue' }, txt('Changed.'))));
    expect(out).toContain('Changed. [[Bookmark: Fix]] [[* Blue revision]]');
    const [action] = blocks(parseFountain(out));
    expect(action.attrs).toMatchObject({ bookmark: 'Fix', revised: 'Blue' });
  });

  it('leaves notes that do not add up as ordinary notes', () => {
    const parsed = parseFountain('A door opens. [[Alternate 1/3: A door closes.]]\n');
    expect(parsed.content?.map((n) => [n.type, flat(n)])).toEqual([
      ['action', 'A door opens.'],
      ['note', 'Alternate 1/3: A door closes.'],
    ]);
    // A bookmark note on an element that has one already is kept as a note.
    const twice = parseFountain('A door opens. [[Bookmark: One]] [[Bookmark: Two]]\n');
    expect(twice.content?.[0].attrs?.bookmark).toBe('One');
    expect(twice.content?.[1]).toMatchObject({ type: 'note' });
    // A version note on a scene heading has nowhere to go.
    const heading = parseFountain('INT. HOUSE - DAY [[Alternate 1/2: EXT. HOUSE]]\n');
    expect(heading.content?.map((n) => n.type)).toEqual(['sceneHeading', 'note']);
  });

  it('only reads the exact forms it writes', () => {
    expect(parseFountainAnnotation('Bookmark: Act two')).toEqual({ kind: 'bookmark', name: 'Act two' });
    expect(parseFountainAnnotation('bookmark this scene')).toBeNull();
    expect(parseFountainAnnotation('Alternate 4/3: no')).toBeNull();
    expect(parseFountainAnnotation('Alternate take: louder')).toBeNull();
    expect(parseFountainAnnotation(fountainBookmarkNote('a]').slice(2, -2))).toEqual({ kind: 'bookmark', name: 'a]' });
    expect(parseFountainAnnotation(fountainBookmarkNote('back\\slash [x]').slice(2, -2))).toEqual({ kind: 'bookmark', name: 'back\\slash [x]' });
  });
});

describe('decodeAlternates', () => {
  it('drops entries that are not versions and clamps the index', () => {
    const json = JSON.stringify([{ id: 'a', content: [txt('ok')] }, { id: 'b' }, 'junk', { id: 'c', content: ['bad'] }]);
    expect(decodeAlternates(json, '9', 'dialogue')).toEqual({ alternates: [{ id: 'a', content: [txt('ok')] }], alternateIndex: 0 });
    expect(decodeAlternates('[]', '0', 'dialogue')).toBeNull();
  });
});
