/**
 * Enter on a blank line used to open the element picker and nothing else, so a
 * second blank line could not be created — and at the end of a script there was
 * no populated line below to insert against either (issue #100). These cover
 * the rule that replaced it: the picker asks once, then Enter adds lines.
 */
import { describe, it, expect } from 'vitest';
import { pmDoc, doc, block } from '../test/screenplaySchema';
import { isBlankBlock, previousSiblingBlock, blankLineTypeFor } from './blankLine';

/** Resolve a caret inside the nth top-level block of `d`. */
function caretInBlock(d: ReturnType<typeof pmDoc>, index: number) {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += d.child(i).nodeSize;
  return d.resolve(pos + 1);
}

describe('isBlankBlock', () => {
  it('treats an empty block as blank', () => {
    expect(isBlankBlock(pmDoc(doc({ type: 'action' })).firstChild)).toBe(true);
  });

  it('treats a spaces-only block as blank', () => {
    expect(isBlankBlock(pmDoc(doc(block('action', '   '))).firstChild)).toBe(true);
  });

  it('treats a block with text as not blank', () => {
    expect(isBlankBlock(pmDoc(doc(block('action', 'FADE IN:'))).firstChild)).toBe(false);
  });

  it('keeps a spaces-only General line as content, not blank (#74)', () => {
    expect(isBlankBlock(pmDoc(doc(block('general', '    indented'))).firstChild)).toBe(false);
    expect(isBlankBlock(pmDoc(doc(block('general', '    '))).firstChild)).toBe(false);
    expect(isBlankBlock(pmDoc(doc({ type: 'general' })).firstChild)).toBe(true);
  });

  it('is false for nothing', () => {
    expect(isBlankBlock(null)).toBe(false);
    expect(isBlankBlock(undefined)).toBe(false);
  });
});

describe('previousSiblingBlock', () => {
  const d = pmDoc(doc(
    block('action', 'FADE IN:'),
    { type: 'action' },
    { type: 'action' },
  ));

  it('is null at the very start of the document', () => {
    expect(previousSiblingBlock(caretInBlock(d, 0))).toBeNull();
  });

  it('finds the populated line above the first blank line', () => {
    const prev = previousSiblingBlock(caretInBlock(d, 1));
    expect(prev?.textContent).toBe('FADE IN:');
    expect(isBlankBlock(prev)).toBe(false);
  });

  it('reports a blank line above a blank line — Enter should add a line', () => {
    expect(isBlankBlock(previousSiblingBlock(caretInBlock(d, 2)))).toBe(true);
  });

  it('does not reach across a container boundary', () => {
    // The first paragraph of an AV cell has no previous sibling, even though
    // blank blocks precede the AV block in the document.
    const withAv = pmDoc(doc(
      { type: 'action' },
      { type: 'action' },
      {
        type: 'avBlock',
        content: [{
          type: 'avRow',
          content: [
            { type: 'avCell', attrs: { side: 'video' }, content: [{ type: 'avPara' }] },
            { type: 'avCell', attrs: { side: 'audio' }, content: [{ type: 'avPara' }] },
          ],
        }],
      },
    ));
    let pos = -1;
    withAv.descendants((node, p) => {
      if (pos === -1 && node.type.name === 'avPara') pos = p;
    });
    expect(pos).toBeGreaterThan(-1);
    expect(previousSiblingBlock(withAv.resolve(pos + 1))).toBeNull();
  });
});

describe('blankLineTypeFor', () => {
  it('makes a plain Action the neutral spacer for screenplay elements', () => {
    for (const t of ['action', 'sceneHeading', 'character', 'dialogue', 'parenthetical',
                     'transition', 'shot', 'lyrics', 'newAct', 'endOfAct', 'section', 'note']) {
      expect(blankLineTypeFor(t)).toBe('action');
    }
  });

  it('leaves General alone so its indentation survives (#74)', () => {
    expect(blankLineTypeFor('general')).toBe('general');
  });

  it('keeps a title-page line on the title page (#52)', () => {
    expect(blankLineTypeFor('titlePage')).toBe('titlePage');
  });

  it('uses avPara inside an AV cell, which cannot hold an Action', () => {
    expect(blankLineTypeFor('avPara')).toBe('avPara');
    expect(blankLineTypeFor('avShot')).toBe('avPara');
    expect(blankLineTypeFor('avDirection')).toBe('avPara');
  });

  it('never resolves to the schema default, which is an empty scene heading', () => {
    for (const t of ['action', 'general', 'titlePage', 'customElement', 'avShot', 'dialogue']) {
      expect(blankLineTypeFor(t)).not.toBe('sceneHeading');
    }
  });

  it('keeps a custom element rather than dropping its attributes', () => {
    expect(blankLineTypeFor('customElement')).toBe('customElement');
  });
});
