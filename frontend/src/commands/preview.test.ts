import { describe, it, expect } from 'vitest';
import './index';
import { executeCommand } from './index';
import { createPreviewAdapter } from './preview';
import type { ScriptContext } from './types';

const context: ScriptContext = {
  sceneHeading: 'INT. DINER - NIGHT',
  element: 'action',
  selectionText: '',
  paragraphText: '',
  paragraphEmpty: true,
  characters: ['BEN'],
  scenes: ['INT. DINER - NIGHT'],
};

describe('createPreviewAdapter', () => {
  it('records typed blocks without touching a document', () => {
    const { adapter, ops } = createPreviewAdapter(context);
    const result = executeCommand('script.insertDialogue', {
      character: 'ben', text: 'Ciao a tutti.',
    }, adapter);
    expect(result.ok).toBe(true);
    expect(ops).toEqual([{
      kind: 'blocks',
      blocks: [
        { type: 'character', text: 'BEN', extension: undefined },
        { type: 'dialogue', text: 'Ciao a tutti.' },
      ],
    }]);
  });

  it('records element changes, replacements and plain text', () => {
    const { adapter, ops } = createPreviewAdapter(context);
    executeCommand('editor.setElement', { type: 'sceneHeading' }, adapter);
    executeCommand('editor.replaceSelection', { text: 'Nuovo.' }, adapter);
    executeCommand('editor.insertText', { text: 'Testo.' }, adapter);
    expect(ops.map((op) => op.kind)).toEqual(['element', 'replace', 'text']);
  });

  it('still validates, so an invalid command records nothing', () => {
    const { adapter, ops } = createPreviewAdapter(context);
    const result = executeCommand('script.insertDialogue', { character: 'BEN' }, adapter);
    expect(result.ok).toBe(false);
    expect(ops).toHaveLength(0);
  });
});
