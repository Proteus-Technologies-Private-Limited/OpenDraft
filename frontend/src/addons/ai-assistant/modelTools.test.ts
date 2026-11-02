import { describe, it, expect } from 'vitest';
import { modelTools, isModelCommand } from './modelTools';

describe('modelTools', () => {
  const { tools, commandForTool, allowed } = modelTools();

  it('never offers undo, redo or the read-only context command', () => {
    for (const id of ['editor.undo', 'editor.redo', 'script.getContext']) {
      expect(allowed.has(id), id).toBe(false);
      expect(isModelCommand(id, commandForTool, allowed), id).toBe(false);
    }
  });

  it('offers the commands that edit content', () => {
    for (const id of [
      'script.insertDialogue',
      'script.insertScene',
      'script.insertAction',
      'editor.replaceSelection',
    ]) {
      expect(allowed.has(id), id).toBe(true);
      expect(isModelCommand(id.replace(/\./g, '_'), commandForTool, allowed), id).toBe(true);
    }
  });

  it('sends only allowed tools, with no undo among them', () => {
    const names = tools.map((tool) => tool.function.name);
    expect(names).toContain('script_insertDialogue');
    expect(names).not.toContain('editor_undo');
    expect(names).not.toContain('editor_redo');
    for (const name of names) {
      const id = commandForTool.get(name);
      expect(id && allowed.has(id), name).toBe(true);
    }
  });

  it('rejects an unknown command name', () => {
    expect(isModelCommand('editor_deleteEverything', commandForTool, allowed)).toBe(false);
  });
});
