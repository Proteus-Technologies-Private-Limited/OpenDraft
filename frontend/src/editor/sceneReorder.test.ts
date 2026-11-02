/**
 * Reordering scenes must never move the opening matter (title page, FADE IN:)
 * and must keep an act break with the scene it opens.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { getSchema, Node } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Text from '@tiptap/extension-text';
import { EditorState } from '@tiptap/pm/state';
import { reorderSceneTransaction } from './sceneReorder';

const block = (name: string) => Node.create({
  name,
  group: 'block',
  content: 'inline*',
  parseHTML() { return [{ tag: 'div' }]; },
  renderHTML() { return ['div', 0]; },
});

const schema = getSchema([
  Document,
  Text,
  block('sceneHeading'),
  block('action'),
  block('newAct'),
  block('titlePage'),
]);

type Spec = [type: string, text?: string];

function stateFrom(spec: Spec[]): EditorState {
  const doc = schema.nodeFromJSON({
    type: 'doc',
    content: spec.map(([type, text]) => ({
      type,
      ...(text ? { content: [{ type: 'text', text }] } : {}),
    })),
  });
  return EditorState.create({ schema, doc });
}

const labels = (state: EditorState): string[] =>
  state.doc.content.content.map((node) => `${node.type.name}:${node.textContent}`);

const script: Spec[] = [
  ['titlePage', 'THE SCRIPT'],
  ['action', 'FADE IN:'],
  ['sceneHeading', 'INT. HOUSE - DAY'],
  ['action', 'She waits.'],
  ['newAct', 'ACT TWO'],
  ['sceneHeading', 'EXT. STREET - NIGHT'],
  ['action', 'A car passes.'],
  ['sceneHeading', 'INT. CAR - CONTINUOUS'],
  ['action', 'She drives away.'],
];

describe('reorderSceneTransaction', () => {
  it('moves a scene down without touching the opening matter', () => {
    const state = stateFrom(script);
    const tr = reorderSceneTransaction(state, 0, 2);
    expect(tr).not.toBeNull();
    const next = state.apply(tr!);
    expect(labels(next)).toEqual([
      'titlePage:THE SCRIPT',
      'action:FADE IN:',
      'newAct:ACT TWO',
      'sceneHeading:EXT. STREET - NIGHT',
      'action:A car passes.',
      'sceneHeading:INT. CAR - CONTINUOUS',
      'action:She drives away.',
      'sceneHeading:INT. HOUSE - DAY',
      'action:She waits.',
    ]);
  });

  it('moves a scene up together with the act break that opens it', () => {
    const state = stateFrom(script);
    const tr = reorderSceneTransaction(state, 1, 0);
    expect(tr).not.toBeNull();
    const next = state.apply(tr!);
    expect(labels(next)).toEqual([
      'titlePage:THE SCRIPT',
      'action:FADE IN:',
      'newAct:ACT TWO',
      'sceneHeading:EXT. STREET - NIGHT',
      'action:A car passes.',
      'sceneHeading:INT. HOUSE - DAY',
      'action:She waits.',
      'sceneHeading:INT. CAR - CONTINUOUS',
      'action:She drives away.',
    ]);
  });

  it('leaves no empty blocks behind', () => {
    const state = stateFrom(script);
    const next = state.apply(reorderSceneTransaction(state, 2, 0)!);
    for (const node of next.doc.content.content) {
      if (node.type.name !== 'newAct') {
        expect(node.textContent.trim(), node.type.name).not.toBe('');
      }
    }
  });

  it('ignores indices that are not two different scenes', () => {
    const state = stateFrom(script);
    expect(reorderSceneTransaction(state, 1, 1)).toBeNull();
    expect(reorderSceneTransaction(state, -1, 0)).toBeNull();
    expect(reorderSceneTransaction(state, 0, 99)).toBeNull();
  });
});
