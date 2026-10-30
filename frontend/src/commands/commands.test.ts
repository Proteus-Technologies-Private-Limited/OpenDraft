import { describe, it, expect } from 'vitest';
import './index';
import { commandTools, executeCommand, listCommands } from './index';
import type { BlockSpec, CommandElement, EditorAdapter } from './types';

function fakeAdapter() {
  const calls = {
    blocks: [] as BlockSpec[][],
    elements: [] as CommandElement[],
    replaced: [] as Array<{ text: string; element?: CommandElement }>,
    texts: [] as string[],
    undo: 0,
    redo: 0,
  };
  const adapter: EditorAdapter = {
    context: () => ({
      sceneHeading: 'INT. DINER - NIGHT',
      element: 'action',
      selectionText: '',
      paragraphText: '',
      paragraphEmpty: true,
      characters: ['BEN'],
      scenes: ['INT. DINER - NIGHT'],
    }),
    insertBlocks: (blocks) => { calls.blocks.push(blocks); },
    setElement: (type) => { calls.elements.push(type); },
    replaceSelection: (text, element) => { calls.replaced.push({ text, element }); },
    insertText: (text) => { calls.texts.push(text); },
    undo: () => { calls.undo++; },
    redo: () => { calls.redo++; },
  };
  return { adapter, calls };
}

describe('command registry', () => {
  it('lists the built-in screenplay commands', () => {
    const ids = listCommands().map((c) => c.id);
    expect(ids).toContain('script.insertDialogue');
    expect(ids).toContain('script.insertScene');
    expect(ids).toContain('editor.setElement');
    expect(ids).toContain('script.getContext');
  });

  it('sanitises tool names and can map them back to commands', () => {
    const { tools, commandForTool } = commandTools();
    const dialogue = tools.find((t) => t.function.name === 'script_insertDialogue');
    expect(dialogue).toBeDefined();
    expect(commandForTool.get('script_insertDialogue')).toBe('script.insertDialogue');
  });

  it('fails politely on an unknown command', () => {
    const { adapter } = fakeAdapter();
    const result = executeCommand('does.notExist', {}, adapter);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('Unknown command');
  });

  it('turns a thrown error into a failed result', () => {
    const { adapter } = fakeAdapter();
    adapter.insertBlocks = () => { throw new Error('boom'); };
    const result = executeCommand('script.insertAction', { text: 'Rain.' }, adapter);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('boom');
  });
});

describe('script.insertDialogue', () => {
  it('inserts a capitalised cue followed by the line', () => {
    const { adapter, calls } = fakeAdapter();
    const result = executeCommand('script.insertDialogue', { character: 'ben', text: 'Ciao a tutti.' }, adapter);
    expect(result.ok).toBe(true);
    expect(calls.blocks).toEqual([[
      { type: 'character', text: 'BEN', extension: undefined },
      { type: 'dialogue', text: 'Ciao a tutti.' },
    ]]);
  });

  it('adds a parenthetical before the dialogue, and an extension to the cue', () => {
    const { adapter, calls } = fakeAdapter();
    executeCommand('script.insertDialogue', {
      character: 'BEN', text: 'Ciao.', parenthetical: 'whispering', extension: 'v.o.',
    }, adapter);
    expect(calls.blocks[0]).toEqual([
      { type: 'character', text: 'BEN', extension: '(V.O.)' },
      { type: 'parenthetical', text: '(whispering)' },
      { type: 'dialogue', text: 'Ciao.' },
    ]);
  });

  it('requires both a character and a line', () => {
    const { adapter, calls } = fakeAdapter();
    expect(executeCommand('script.insertDialogue', { text: 'Ciao.' }, adapter).ok).toBe(false);
    expect(executeCommand('script.insertDialogue', { character: 'BEN' }, adapter).ok).toBe(false);
    expect(calls.blocks).toHaveLength(0);
  });
});

describe('the other editorial commands', () => {
  it('capitalises a scene heading', () => {
    const { adapter, calls } = fakeAdapter();
    executeCommand('script.insertScene', { heading: 'int. lavanderia - notte', action: 'Buio.' }, adapter);
    expect(calls.blocks[0]).toEqual([
      { type: 'sceneHeading', text: 'INT. LAVANDERIA - NOTTE' },
      { type: 'action', text: 'Buio.' },
    ]);
  });

  it('rejects an element that does not exist', () => {
    const { adapter, calls } = fakeAdapter();
    const result = executeCommand('editor.setElement', { type: 'montage' }, adapter);
    expect(result.ok).toBe(false);
    expect(calls.elements).toHaveLength(0);
  });

  it('passes a valid element through', () => {
    const { adapter, calls } = fakeAdapter();
    expect(executeCommand('editor.setElement', { type: 'sceneHeading' }, adapter).ok).toBe(true);
    expect(calls.elements).toEqual(['sceneHeading']);
  });

  it('clamps enormous text instead of trusting a model', () => {
    const { adapter, calls } = fakeAdapter();
    executeCommand('script.insertAction', { text: 'x'.repeat(50_000) }, adapter);
    expect(calls.blocks[0][0].text.length).toBe(20_000);
  });

  it('accepts the parameter names local models tend to use', () => {
    const { adapter, calls } = fakeAdapter();
    executeCommand('script.insertAction', { action: 'Rain on the glass.' }, adapter);
    executeCommand('script.insertDialogue', { name: 'ben', line: 'Ciao.' }, adapter);
    executeCommand('script.insertScene', { sceneHeading: 'int. a - day' }, adapter);
    expect(calls.blocks[0][0]).toEqual({ type: 'action', text: 'Rain on the glass.' });
    expect(calls.blocks[1]).toEqual([
      { type: 'character', text: 'BEN', extension: undefined },
      { type: 'dialogue', text: 'Ciao.' },
    ]);
    expect(calls.blocks[2][0]).toEqual({ type: 'sceneHeading', text: 'INT. A - DAY' });
  });

  it('inserts any element type, including the ones without a dedicated command', () => {
    const { adapter, calls } = fakeAdapter();
    executeCommand('script.insertBlock', { type: 'shot', text: 'Close on the door.' }, adapter);
    executeCommand('script.insertBlock', { type: 'newAct', text: 'act two' }, adapter);
    expect(calls.blocks[0][0]).toEqual({ type: 'shot', text: 'CLOSE ON THE DOOR.' });
    expect(calls.blocks[1][0]).toEqual({ type: 'newAct', text: 'ACT TWO' });
  });

  it('refuses a "transition" that is really a scene note', () => {
    const { adapter, calls } = fakeAdapter();
    const result = executeCommand('script.insertTransition', { text: 'LATER' }, adapter);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('script.insertScene');
    expect(calls.blocks).toHaveLength(0);
    expect(executeCommand('script.insertTransition', { text: 'CUT TO:' }, adapter).ok).toBe(true);
  });

  it('inserts a whole sequence of blocks in one command', () => {
    const { adapter, calls } = fakeAdapter();
    const result = executeCommand('script.insertBlocks', {
      blocks: [
        { type: 'sceneHeading', text: 'int. house - day' },
        { type: 'action', text: 'Ada enters.' },
        { type: 'character', text: 'ada' },
        { type: 'dialogue', text: 'Hello.' },
      ],
    }, adapter);
    expect(result.ok).toBe(true);
    expect(calls.blocks[0]).toEqual([
      { type: 'sceneHeading', text: 'INT. HOUSE - DAY' },
      { type: 'action', text: 'Ada enters.' },
      { type: 'character', text: 'ADA' },
      { type: 'dialogue', text: 'Hello.' },
    ]);
  });

  it('undoes and redoes', () => {
    const { adapter, calls } = fakeAdapter();
    executeCommand('editor.undo', {}, adapter);
    executeCommand('editor.redo', {}, adapter);
    expect(calls.undo).toBe(1);
    expect(calls.redo).toBe(1);
  });

  it('returns the script context', () => {
    const { adapter } = fakeAdapter();
    const result = executeCommand('script.getContext', {}, adapter);
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ sceneHeading: 'INT. DINER - NIGHT', characters: ['BEN'] });
  });
});
