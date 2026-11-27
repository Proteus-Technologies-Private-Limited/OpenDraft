/**
 * The Sidekick as core sees it: what it registers, and its record surviving
 * the trips core promises for plugin document data — save/reopen, Fountain
 * and FDX — through core's real code.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Editor } from '@tiptap/core';
import { EditorState, TextSelection, type Transaction } from '@tiptap/pm/state';
import { ADDON_PREFERENCE_PREFIX, PluginRegistry, pluginRegistry } from '../../plugins/registry';
import { usePluginDataStore } from '../../stores/pluginDataStore';
import { exportFountain } from '../../utils/fountainExporter';
import { exportFDX } from '../../utils/fdxExporter';
import { parseScreenplayImport } from '../../utils/importScreenplay';
import { hydrateEditorStoresFromContent } from '../../utils/hydrateStores';
import { stripSaveMetadata } from '../../utils/saveContent';
import { i18next } from '../../i18n';
import { testSchema } from '../../test/screenplaySchema';
import { addTask, readData, setTypeBehavior, updateData } from './data';
import { PANEL_ID, PLUGIN_ID, emptyData, findType, type TaskSource } from './model';
import { sidekickPlugin } from './plugin';
import { registerTranslations } from './i18n';
import { buildReport, toMarkdown } from './outputs';
import { canFile, fileSelection } from './actions';
import { locate } from './script';

const source: TaskSource = { sceneHeading: 'INT. KITCHEN - NIGHT', sceneUid: null, sceneIndex: 0, elementType: 'action' };
const doc = { type: 'doc', content: [{ type: 'sceneHeading', content: [{ type: 'text', text: 'INT. KITCHEN - NIGHT' }] }, { type: 'action', content: [{ type: 'text', text: 'Anna waits.' }] }] };

function fileTwo() {
  const error = updateData((data) => {
    let next = addTask(data, { typeId: 'todo', excerpt: { content: [{ type: 'action', content: [{ type: 'text', text: 'Anna waits.', marks: [{ type: 'bold' }] }] }], openStart: 0, openEnd: 0, text: 'Anna waits.' }, source }).data;
    next = addTask(next, { typeId: 'hold', subject: 'A better */ line', excerpt: { content: [], openStart: 0, openEnd: 0, text: 'She never <b>came</b> back & "left".' }, source }).data;
    return next;
  });
  expect(error).toBeNull();
}

beforeEach(() => {
  usePluginDataStore.getState().setAll({});
});

describe('registration', () => {
  it('contributes a panel, a status item, a Tools menu, a report, an exporter and shortcuts', () => {
    const registry = new PluginRegistry();
    registry.register(sidekickPlugin);
    expect(registry.isAddOnEnabled(PLUGIN_ID)).toBe(true);
    expect(registry.getPanels('right-sidebar').map((p) => p.id)).toEqual([PANEL_ID]);
    expect(registry.getPanels('status-bar')).toHaveLength(1);
    const menu = registry.getMenuItems('Tools')[0];
    expect(menu.children?.map((c) => c.id)).toEqual(['od-sidekick-open', 'od-sidekick-sep', 'od-sidekick-add-todo', 'od-sidekick-add-hold', 'od-sidekick-add-to']);
    // One "Add Task To" item per visible type.
    expect(menu.children?.[4].children).toHaveLength(15);
    expect(registry.getReports().map((r) => r.id)).toEqual(['od-sidekick-tasks']);
    expect(registry.getExporters().map((e) => e.extension)).toEqual(['md']);
    expect(registry.getEditorExtensions().map((e) => e.name)).toEqual(['odSidekickShortcuts']);
  });

  it('respects a saved choice to turn Sidekick off', async () => {
    const registry = new PluginRegistry();
    registry.register(sidekickPlugin);
    await registry.disableAddOn(PLUGIN_ID);
    try {
      const restarted = new PluginRegistry();
      restarted.register(sidekickPlugin);
      expect(restarted.isAddOnEnabled(PLUGIN_ID)).toBe(false);
      expect(restarted.getMenuItems('Tools')).toEqual([]);
    } finally {
      await registry.enableAddOn(PLUGIN_ID);
      localStorage.removeItem(ADDON_PREFERENCE_PREFIX + PLUGIN_ID);
    }
  });

  it('brings its own words', () => {
    registerTranslations();
    expect(i18next.t(`${PLUGIN_ID}:types.hold.label`)).toBe('Hold for Later');
  });
});

describe('the record in the script', () => {
  it('is stored under the plugin id in the save payload and comes back on reopen', () => {
    fileTwo();
    const saved = { ...doc, _notes: [], _pluginData: usePluginDataStore.getState().data };
    const { metadata } = stripSaveMetadata(JSON.parse(JSON.stringify(saved)));
    expect(Object.keys(metadata._pluginData as object)).toEqual([PLUGIN_ID]);

    usePluginDataStore.getState().setAll({});
    expect(readData()).toEqual(emptyData());
    hydrateEditorStoresFromContent(JSON.parse(JSON.stringify(saved)));
    expect(readData().tasks.map((t) => t.subject)).toEqual(['A better */ line', 'Anna waits.']);
  });

  it('survives a Fountain export and import exactly', async () => {
    fileTwo();
    const before = readData();
    const text = exportFountain(doc, { pluginData: usePluginDataStore.getState().data });
    usePluginDataStore.getState().setAll({});
    await parseScreenplayImport('round-trip.fountain', text);
    expect(readData()).toEqual(before);
  });

  it('is written into an FDX export', () => {
    fileTwo();
    const xml = exportFDX(doc, 'T', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, { pluginData: usePluginDataStore.getState().data });
    expect(xml).toContain(`<Plugin Id="${PLUGIN_ID}">`);
    expect(xml).toContain('&lt;b&gt;came&lt;/b&gt;');
  });
});

describe('filing from the editor', () => {
  function editorWithText(select: boolean, allowChanges = true) {
    const script = testSchema.nodeFromJSON(doc);
    const from = script.child(0).nodeSize + 1;
    const to = from + 'Anna'.length;
    let state = EditorState.create({ doc: script, selection: TextSelection.create(script, from, select ? to : from) });
    return {
      get state() { return state; },
      isDestroyed: false,
      isEditable: true,
      view: { dispatch(tr: Transaction) { if (allowChanges) state = state.apply(tr); } },
    } as unknown as Editor;
  }

  it('copies or moves the text according to the saved type settings', () => {
    const editor = editorWithText(true);
    expect(fileSelection(editor, 'hold')).toMatchObject({ ok: true, task: { excerpt: { text: 'Anna' }, source: { navigation: 'cursor' } } });
    expect(editor.state.doc.lastChild?.textContent).toBe(' waits.');
    const [task] = readData().tasks;
    const { from } = editor.state.selection;
    expect(locate(editor.state.doc, task.excerpt, task.source)).toEqual({ from, to: from, exact: false });

    updateData((data) => setTypeBehavior(data, 'hold', { textAction: 'copy' }));
    const other = editorWithText(true);
    expect(fileSelection(other, 'hold')).toMatchObject({ ok: true, task: { source: { navigation: 'selection' } } });
    expect(other.state.doc.lastChild?.textContent).toBe('Anna waits.');
  });

  it('handles required, optional and unlinked tasks with a collapsed selection', () => {
    const editor = editorWithText(false);
    expect(canFile(editor, findType(readData(), 'hold'))).toBe(false);
    expect(fileSelection(editor, 'hold').ok).toBe(false);
    expect(fileSelection(editor, 'todo')).toMatchObject({ ok: true, task: { excerpt: { text: '' }, source: { navigation: 'cursor' } } });
    expect(fileSelection(editorWithText(true), 'idea')).toMatchObject({ ok: true, task: { excerpt: { text: '' }, source: { navigation: 'none' } } });
  });

  it('leaves the script intact if storing the excerpt fails', () => {
    const editor = editorWithText(true);
    const save = vi.spyOn(pluginRegistry, 'setDocumentData').mockImplementationOnce(() => { throw new Error('Document data limit'); });
    const log = vi.spyOn(console, 'error').mockImplementationOnce(() => {});
    try {
      expect(fileSelection(editor, 'hold').ok).toBe(false);
      expect(editor.state.doc.lastChild?.textContent).toBe('Anna waits.');
      expect(readData().tasks).toHaveLength(0);
    } finally {
      save.mockRestore();
      log.mockRestore();
    }
  });

  it('rolls back the saved excerpt if the editor filters the deletion', () => {
    const editor = editorWithText(true, false);
    expect(fileSelection(editor, 'hold').ok).toBe(false);
    expect(editor.state.doc.lastChild?.textContent).toBe('Anna waits.');
    expect(readData().tasks).toHaveLength(0);
  });
});

describe('outputs', () => {
  it('reports every task with its status and scene', () => {
    fileTwo();
    const table = buildReport(readData(), 'Draft 3');
    expect(table.rows).toHaveLength(2);
    expect(table.rows[1]).toEqual(expect.arrayContaining(['To Do', 'Anna waits.', 'Open', 'INT. KITCHEN - NIGHT']));
    expect(table.summary).toContain('2 pending');
  });

  it('exports a Markdown checklist', () => {
    fileTwo();
    const md = toMarkdown(readData(), 'Draft 3');
    expect(md).toContain('## To Do');
    expect(md).toContain('- [ ] **Anna waits.**');
    expect(md).toContain('## Hold for Later');
    expect(md).toContain('  > She never <b>came</b> back & "left".');
  });
});
