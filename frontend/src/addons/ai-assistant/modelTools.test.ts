import { describe, it, expect } from 'vitest';
import { modelTools, isModelCommand } from './modelTools';
import { registerCommand } from './commands';

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

  it('does not offer a command registered later until it is listed', () => {
    registerCommand({
      id: 'editor.deleteScript',
      label: 'Delete Script',
      description: 'Delete everything in the script.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      run: () => ({ ok: true, message: 'Deleted.' }),
    });
    const fresh = modelTools();
    expect(fresh.allowed.has('editor.deleteScript')).toBe(false);
    expect(fresh.tools.map((tool) => tool.function.name)).not.toContain('editor_deleteScript');
  });
});
