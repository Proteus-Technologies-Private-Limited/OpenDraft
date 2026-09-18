/**
 * Every node an AV content expression names must actually be registered.
 *
 * `avRow`'s content expression is `avCell avCell avImage?`, and `avCell`'s is
 * built from `AV_CELL_ELEMENT_IDS`. If one of those names is not in the
 * editor's extension list, ProseMirror does not fall back or warn — it throws
 * while building the schema, which happens before the first render, so the
 * entire app comes up as a blank page:
 *
 *   SyntaxError: No node type or group 'avImage' found
 *   (in content expression 'avCell avCell avImage?')
 *
 * That is exactly what happened when `avImage` and `avGraphic` were added: the
 * test schema in `src/test/screenplaySchema.ts` listed them, so every unit test
 * passed, while `ScreenplayEditor.tsx` — which keeps its own hand-written list —
 * did not. Two lists that must agree and nothing checking that they do.
 *
 * The surface is wider now. An `avCell` also holds screenplay elements, so
 * `AvBlockExtensions` no longer builds a schema on its own: it needs
 * `sceneHeading`, `character`, `dialogue` and the rest to exist. That coupling
 * is deliberate — the schema is permissive and the template decides what is
 * offered, see utils/avCellElements.ts — but it is a coupling, and it is what
 * these tests are for.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { getSchema } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Text from '@tiptap/extension-text';
import Paragraph from '@tiptap/extension-paragraph';
import {
  AvBlockExtensions,
  AV_CELL_ELEMENT_IDS,
  AV_BASE_CELL_ELEMENT_IDS,
  AV_SCREENPLAY_CELL_ELEMENT_IDS,
} from './extensions/AvBlock';
import {
  SceneHeading, Action, Character, Dialogue, Parenthetical, Transition,
  General, Shot, Lyrics, CustomElement,
} from './extensions';

/** The screenplay nodes an `avCell` names, as extensions. */
const CELL_SCREENPLAY_EXTENSIONS = [
  SceneHeading, Action, Character, Dialogue, Parenthetical, Transition,
  General, Shot, Lyrics, CustomElement,
];

/** AV node names that must be registered wherever an AV document is edited. */
const REQUIRED_AV_NODES = ['avBlock', 'avRow', 'avCell', ...AV_BASE_CELL_ELEMENT_IDS, 'avImage'];

const buildSchema = () => getSchema([
  Document.extend({ content: 'block+' }),
  Text,
  Paragraph,
  ...CELL_SCREENPLAY_EXTENSIONS,
  ...AvBlockExtensions,
]);

describe('AvBlockExtensions', () => {
  it('builds a valid schema beside the screenplay elements a cell names', () => {
    // The throw this guards against happens here, at schema construction.
    expect(buildSchema).not.toThrow();
  });

  it('registers every AV node the schema needs', () => {
    const schema = buildSchema();
    for (const name of REQUIRED_AV_NODES) {
      expect(schema.nodes[name], `${name} is not registered`).toBeTruthy();
    }
  });

  it('accepts every element id the cell content expression names', () => {
    const schema = buildSchema();
    for (const name of AV_CELL_ELEMENT_IDS) {
      expect(schema.nodes[name], `${name} is named by avCell but not registered`).toBeTruthy();
    }
  });

  it('takes avPara as a cell’s default child', () => {
    // A content expression's default type is the first one that can stand
    // alone. Enter at the end of a cell produces it, so if anything but avPara
    // led the list, every new line in a cell would come out as that instead.
    const schema = buildSchema();
    expect(schema.nodes.avCell.contentMatch.defaultType?.name).toBe('avPara');
  });

  it('holds a screenplay element in a cell', () => {
    const schema = buildSchema();
    expect(() =>
      schema.nodeFromJSON({
        type: 'doc',
        content: [{
          type: 'avBlock',
          content: [{
            type: 'avRow',
            content: [
              {
                type: 'avCell',
                attrs: { side: 'video' },
                content: [{ type: 'action', content: [{ type: 'text', text: 'She enters.' }] }],
              },
              {
                type: 'avCell',
                attrs: { side: 'audio' },
                content: [
                  { type: 'character', content: [{ type: 'text', text: 'NARRATOR' }] },
                  { type: 'dialogue', content: [{ type: 'text', text: 'Every day...' }] },
                ],
              },
            ],
          }],
        }],
      }),
    ).not.toThrow();
  });

  it('still accepts a legacy two-cell row', () => {
    const schema = buildSchema();
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

  it.each(AV_SCREENPLAY_CELL_ELEMENT_IDS.map(n => n[0].toUpperCase() + n.slice(1)))(
    'registers %s, which avCell now names',
    (exportName) => {
      const uses = source.split(exportName).length - 1;
      expect(uses, `${exportName} is named by the avCell content expression and must be registered`).toBeGreaterThanOrEqual(2);
    },
  );
});
