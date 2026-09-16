/**
 * Every AV node the schema references must actually be registered.
 *
 * `avRow`'s content expression is `avCell avCell avImage?`. If `avImage` is not
 * in the editor's extension list, ProseMirror does not fall back or warn — it
 * throws while building the schema, which happens before the first render, so
 * the entire app comes up as a blank page:
 *
 *   SyntaxError: No node type or group 'avImage' found
 *   (in content expression 'avCell avCell avImage?')
 *
 * That is exactly what happened when `avImage` and `avGraphic` were added: the
 * test schema in `src/test/screenplaySchema.ts` listed them, so every unit test
 * passed, while `ScreenplayEditor.tsx` — which keeps its own hand-written list —
 * did not. Two lists that must agree and nothing checking that they do.
 *
 * These tests close that gap from both ends.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { getSchema } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Text from '@tiptap/extension-text';
import Paragraph from '@tiptap/extension-paragraph';
import { AvBlockExtensions } from './extensions/AvBlock';

/** AV node names that must be registered wherever an AV document is edited. */
const REQUIRED_AV_NODES = ['avBlock', 'avRow', 'avCell', 'avPara', 'avShot', 'avDirection', 'avGraphic', 'avImage'];

describe('AvBlockExtensions', () => {
  it('builds a valid schema on its own — every content expression resolves', () => {
    // The throw this guards against happens here, at schema construction.
    expect(() =>
      getSchema([Document.extend({ content: 'block+' }), Text, Paragraph, ...AvBlockExtensions]),
    ).not.toThrow();
  });

  it('registers every AV node the schema needs', () => {
    const schema = getSchema([Document.extend({ content: 'block+' }), Text, Paragraph, ...AvBlockExtensions]);
    for (const name of REQUIRED_AV_NODES) {
      expect(schema.nodes[name], `${name} is not registered`).toBeTruthy();
    }
  });

  it('still accepts a legacy two-cell row', () => {
    const schema = getSchema([Document.extend({ content: 'block+' }), Text, Paragraph, ...AvBlockExtensions]);
    expect(() =>
      schema.nodeFromJSON({
        type: 'doc',
        content: [{
          type: 'avBlock',
          content: [{
            type: 'avRow',
            content: [
              { type: 'avCell', attrs: { side: 'video' }, content: [{ type: 'avPara' }] },
              { type: 'avCell', attrs: { side: 'audio' }, content: [{ type: 'avPara' }] },
            ],
          }],
        }],
      }),
    ).not.toThrow();
  });
});

describe('the editor’s own extension list', () => {
  /**
   * Read as source text rather than imported: the list lives inside a .tsx
   * component that pulls in the whole app. The point is only to catch the two
   * lists drifting apart, and a missing name in this file is exactly the drift
   * that blanked the app.
   */
  const source = readFileSync(new URL('../components/ScreenplayEditor.tsx', import.meta.url), 'utf8');

  it.each(REQUIRED_AV_NODES.map(n => n[0].toUpperCase() + n.slice(1)))(
    'registers %s',
    (exportName) => {
      // Appears both in the import and in the extensions array passed to useEditor.
      const uses = source.split(exportName).length - 1;
      expect(uses, `${exportName} must be imported AND listed in the editor extensions`).toBeGreaterThanOrEqual(2);
    },
  );
});
