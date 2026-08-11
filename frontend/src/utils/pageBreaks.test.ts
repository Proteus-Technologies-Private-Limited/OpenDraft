import { describe, it, expect } from 'vitest';
import { elementIdOf, startsOwnPage } from './pageBreaks';
import { block, doc, pmDoc } from '../test/screenplaySchema';

describe('startsOwnPage', () => {
  const none = new Set<string>();

  it('breaks when the element carries the manual flag', () => {
    expect(startsOwnPage({ type: 'newAct', attrs: { startsNewPage: true } }, none)).toBe(true);
  });

  it('does not break for an ordinary element', () => {
    expect(startsOwnPage({ type: 'action', attrs: {} }, none)).toBe(false);
  });

  it('breaks when the template lists the element id', () => {
    expect(startsOwnPage({ type: 'newAct' }, new Set(['newAct']))).toBe(true);
  });

  it('leaves other element types alone when a template rule exists', () => {
    expect(startsOwnPage({ type: 'sceneHeading' }, new Set(['newAct']))).toBe(false);
  });

  it('treats a missing attrs object as "no manual flag"', () => {
    expect(startsOwnPage({ type: 'action' }, none)).toBe(false);
    expect(startsOwnPage({ type: 'action', attrs: null }, none)).toBe(false);
  });

  it('ignores a non-true startsNewPage value', () => {
    // Importers should write a real boolean; anything else must not force a page.
    expect(startsOwnPage({ type: 'action', attrs: { startsNewPage: 'yes' } }, none)).toBe(false);
  });

  it('matches custom elements by their template rule id', () => {
    const node = { type: 'customElement', attrs: { customTypeId: 'chapter-head' } };
    expect(startsOwnPage(node, new Set(['chapter-head']))).toBe(true);
    expect(startsOwnPage(node, new Set(['customElement']))).toBe(false);
  });
});

describe('elementIdOf', () => {
  it('uses the node type for built-in elements', () => {
    expect(elementIdOf({ type: 'newAct' })).toBe('newAct');
  });

  it('falls back to general for a typeless node', () => {
    expect(elementIdOf({})).toBe('general');
  });

  it('falls back to the node type when a custom element has no rule id', () => {
    expect(elementIdOf({ type: 'customElement', attrs: {} })).toBe('customElement');
  });
});

describe('startsNewPage attribute survives the editor schema', () => {
  // The FDX/OSF/Fountain importers all emit this attribute. Before the
  // StartsNewPage extension existed, ProseMirror silently stripped it on load
  // and every imported page break was lost.
  it('round-trips through the ProseMirror schema', () => {
    const json = doc(
      block('action', 'Before the break'),
      { ...block('newAct', 'ACT TWO'), attrs: { startsNewPage: true } },
    );
    const out = pmDoc(json).toJSON();
    expect(out.content[1].attrs.startsNewPage).toBe(true);
  });

  it('defaults to false when the importer did not set it', () => {
    const out = pmDoc(doc(block('newAct', 'ACT ONE'))).toJSON();
    expect(out.content[0].attrs.startsNewPage).toBe(false);
  });
});
