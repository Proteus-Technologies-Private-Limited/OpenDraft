/**
 * Bookmarks and alternates through Final Draft and Fountain: what OpenDraft
 * keeps on an element beyond the text, written out and read back in.
 */
import { describe, it, expect } from 'vitest';
import { EditorState } from '@tiptap/pm/state';
import type { JSONContent } from '@tiptap/react';
import { testSchema, block, doc } from '../test/screenplaySchema';
import { DOMParser as XmldomDOMParser } from '@xmldom/xmldom';
import { exportFDX } from './fdxExporter';
import { openDraftAttrsFrom, resolveFdxType } from './fdxParser';
import { exportFountain, fountainBookmarkNote } from './fountainExporter';
import { parseFountain } from './fountainParser';
import { addAlternateTransaction, alternatesOf, versionIndex } from '../editor/alternates';
import { addSceneAlternateTransaction, cycleSceneAlternateTransaction, sceneVersionsOf, sceneVersionIndex } from '../editor/sceneAlternates';

/**
 * An exported .fdx read back the way the parser reads each paragraph's type,
 * text and OpenDraft attributes. The full parser needs a browser DOMParser
 * (querySelectorAll), which the node test environment does not have.
 */
function parseFDX(xml: string): JSONContent {
  const xmlDoc = new XmldomDOMParser().parseFromString(xml, 'text/xml');
  // The script's own <Content>, not the title page's.
  const content = Array.from(xmlDoc.documentElement?.childNodes ?? [])
    .find((c) => c.nodeType === 1 && (c as unknown as Element).tagName === 'Content') as unknown as Element;
  const read = (para: Element): JSONContent => {
    const resolved = resolveFdxType(para.getAttribute('Type') || 'General');
    const type = resolved?.kind === 'builtin' ? resolved.id : 'general';
    const text = Array.from(para.childNodes)
      .filter((c): c is Element => c.nodeType === 1 && (c as Element).tagName === 'Text')
      .map((t) => t.textContent ?? '').join('');
    const attrs = openDraftAttrsFrom(para, type);
    return { type, ...(Object.keys(attrs).length ? { attrs } : {}), ...(text ? { content: [{ type: 'text', text }] } : {}) };
  };
  const out: JSONContent[] = [];
  for (const child of Array.from(content.childNodes)) {
    if (child.nodeType !== 1) continue;
    const el = child as Element;
    if (el.tagName === 'Paragraph') out.push(read(el));
    else if (el.tagName === 'DualDialogue') {
      const paras = Array.from(el.getElementsByTagName('Paragraph')).map(read);
      out.push({ type: 'dualDialogue', content: [{ type: 'dualDialogueColumn', content: paras }] });
    }
  }
  return { type: 'doc', content: out };
}

const bookmarked = (b: JSONContent, name: string): JSONContent => ({ ...b, attrs: { ...b.attrs, bookmark: name } });

/** Every block, flattening dual dialogue, as [type, text, bookmark]. */
function bookmarksOf(d: JSONContent): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const walk = (n: JSONContent) => {
    if (typeof n.attrs?.bookmark === 'string' && n.attrs.bookmark) out.push([n.type ?? '', String(n.attrs.bookmark)]);
    (n.content ?? []).forEach((c) => { if (c.type !== 'text') walk(c); });
  };
  walk(d);
  return out;
}

const script = doc(
  bookmarked(block('sceneHeading', 'INT. KITCHEN - DAY'), 'Opening'),
  block('action', 'Toast burns.'),
  bookmarked(block('character', 'MAYA'), 'Maya enters'),
  block('dialogue', 'Again?'),
  bookmarked(block('dialogue', 'Every morning.'), 'The line'),
  block('transition', 'CUT TO:'),
);

describe('bookmarks in Final Draft files', () => {
  it('come back on the element they marked', () => {
    const back = parseFDX(exportFDX(script));
    expect(bookmarksOf(back)).toEqual([
      ['sceneHeading', 'Opening'],
      ['character', 'Maya enters'],
      ['dialogue', 'The line'],
    ]);
  });

  it('survive names with quotes and ampersands', () => {
    const d = doc(bookmarked(block('action', 'x'), 'Tom & "Jerry"'));
    expect(bookmarksOf(parseFDX(exportFDX(d)))).toEqual([['action', 'Tom & "Jerry"']]);
  });

  it('are kept in dual dialogue', () => {
    const d = doc({
      type: 'dualDialogue',
      content: [
        { type: 'dualDialogueColumn', content: [block('character', 'A'), bookmarked(block('dialogue', 'Left.'), 'Left side')] },
        { type: 'dualDialogueColumn', content: [block('character', 'B'), block('dialogue', 'Right.')] },
      ],
    });
    expect(bookmarksOf(parseFDX(exportFDX(d)))).toEqual([['dialogue', 'Left side']]);
  });
});

describe('bookmarks in Fountain files', () => {
  it('are written as a note on the element’s line', () => {
    const text = exportFountain(script);
    expect(text).toContain('INT. KITCHEN - DAY [[Bookmark: Opening]]');
    expect(text).toContain('MAYA [[Bookmark: Maya enters]]');
  });

  it('come back on the element they marked, not as notes', () => {
    const back = parseFountain(exportFountain(script));
    expect(bookmarksOf(back)).toEqual([
      ['sceneHeading', 'Opening'],
      ['character', 'Maya enters'],
      ['dialogue', 'The line'],
    ]);
    expect((back.content ?? []).some((n) => n.type === 'note')).toBe(false);
  });

  it('a second note with a name already in use stays a note', () => {
    const back = parseFountain(`INT. A - DAY ${fountainBookmarkNote('Same')}\n\nWalks. ${fountainBookmarkNote('Same')}\n`);
    expect(bookmarksOf(back)).toEqual([['sceneHeading', 'Same']]);
    expect((back.content ?? []).filter((n) => n.type === 'note')).toHaveLength(1);
  });

  it('a name holding ]] does not break the note', () => {
    const back = parseFountain(exportFountain(doc(bookmarked(block('action', 'x'), 'a]]b'))));
    expect(bookmarksOf(back)).toEqual([['action', 'a] ]b']]);
  });
});

describe('alternates in Final Draft files', () => {
  const stateOf = (...blocks: JSONContent[]) =>
    EditorState.create({ schema: testSchema, doc: testSchema.nodeFromJSON(doc(...blocks)) });

  it('keep every version of a line, with the one showing in the text', () => {
    let s = stateOf(block('character', 'MAYA'), block('dialogue', 'One'));
    s = s.apply(addAlternateTransaction(s, 10)!);
    s = s.apply(s.tr.insertText('Two', s.selection.from, s.selection.to));
    const fdx = exportFDX(s.doc.toJSON());
    expect(fdx).toContain('<Text>Two</Text>');
    const back = testSchema.nodeFromJSON(parseFDX(fdx));
    const line = back.child(1);
    expect(line.textContent).toBe('Two');
    expect(alternatesOf(line).map((a) => a.content[0]?.text)).toEqual(['One']);
    expect(versionIndex(line)).toBe(1);
  });

  it('keep every version of a scene', () => {
    let s = stateOf(block('sceneHeading', 'INT. A - DAY'), block('action', 'First take.'), block('sceneHeading', 'INT. B - DAY'));
    s = s.apply(addSceneAlternateTransaction(s, 1)!);
    s = s.apply(s.tr.insertText('Second take.', s.doc.child(0).nodeSize + 1, s.doc.child(0).nodeSize + 1 + 'First take.'.length));
    const back = testSchema.nodeFromJSON(parseFDX(exportFDX(s.doc.toJSON())));
    expect(back.child(1).textContent).toBe('Second take.');
    expect(sceneVersionsOf(back.child(0))).toHaveLength(1);
    expect(sceneVersionIndex(back.child(0))).toBe(1);
    let r = EditorState.create({ schema: testSchema, doc: back });
    r = r.apply(cycleSceneAlternateTransaction(r, 1, 1)!);
    expect(r.doc.child(1).textContent).toBe('First take.');
  });

  it('ignore versions in a hand-edited file that cannot be read', () => {
    const fdx = exportFDX(doc(block('action', 'x'))).replace('<Paragraph Type="Action"', '<Paragraph Type="Action" data-alternates="not json"');
    const back = parseFDX(fdx);
    expect(back.content?.[0]?.attrs?.alternates).toBeUndefined();
  });
});
