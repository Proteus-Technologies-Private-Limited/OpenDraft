import React, { useEffect, useRef } from 'react';
import { useSettingsStore } from '../stores/settingsStore';
import { ELEMENT_LABELS } from '../stores/editorStore';
import {
  createMacro, mergeMacros, parseMacrosFile, serializeMacros, shortcutClashes,
  MAX_MACRO_NAME, MAX_MACRO_TEXT, type Macro,
} from '../utils/macros';
import { openTextFile, saveFile } from '../utils/fileOps';
import { isMacPlatform } from '../utils/shortcuts';
import ShortcutField from './ShortcutField';
import Select from './Select';
import { showToast } from './Toast';

/** Element types a macro can be inserted as. The title page is not a script line. */
const MACRO_ELEMENTS = Object.entries(ELEMENT_LABELS).filter(([id]) => id !== 'titlePage');

const JSON_FILTER = [{ name: 'OpenDraft macros', extensions: ['json'] }];

/** Settings → Macros: add, edit, remove, export and import the writer's macros. */
const MacroSettingsSection: React.FC = () => {
  const macros = useSettingsStore((s) => s.macros);
  const setMacros = useSettingsStore((s) => s.setMacros);
  const elementMenuShortcut = useSettingsStore((s) => s.elementMenuShortcut);
  const clashes = shortcutClashes(macros, [elementMenuShortcut]);
  const sectionRef = useRef<HTMLElement>(null);

  // Edit → Manage Macros… lands here as /settings#macros.
  useEffect(() => {
    if (window.location.hash === '#macros') sectionRef.current?.scrollIntoView({ block: 'start' });
  }, []);

  const update = (id: string, patch: Partial<Macro>) =>
    setMacros(macros.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  const remove = (id: string) => setMacros(macros.filter((m) => m.id !== id));
  const move = (index: number, delta: -1 | 1) => {
    const to = index + delta;
    if (to < 0 || to >= macros.length) return;
    const next = [...macros];
    [next[index], next[to]] = [next[to], next[index]];
    setMacros(next);
  };

  const handleExport = async () => {
    try {
      await saveFile(serializeMacros(macros), 'OpenDraft Macros.json', JSON_FILTER);
    } catch (err) {
      showToast(`Could not export macros: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  };

  const handleImport = async () => {
    try {
      const file = await openTextFile(JSON_FILTER);
      if (!file) return;
      const { macros: merged, added } = mergeMacros(macros, parseMacrosFile(file.content));
      setMacros(merged);
      showToast(added ? `Imported ${added} macro${added === 1 ? '' : 's'}.` : 'No new macros in that file.', added ? 'success' : 'info');
    } catch (err) {
      showToast(`Could not import macros: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  };

  return (
    <section className="settings-section" id="macros" ref={sectionRef}>
      <h2 className="settings-section-title">Macros</h2>
      <p className="settings-section-desc">
        Text you type often &mdash; CONTINUOUS, LATER, a location you keep coming back to &mdash;
        inserted with a shortcut or from Edit &rarr; Insert Macro. With an element type, a macro
        turns an empty line into that element, or adds a new one after the current line.
      </p>

      {macros.length === 0 && <p className="settings-hint">No macros yet.</p>}

      <ul className="macro-list">
        {macros.map((m, i) => (
          <li key={m.id} className="macro-row">
            <div className="macro-row-fields">
              <label className="macro-field">
                <span>Name</span>
                <input
                  className="dialog-input"
                  value={m.name}
                  maxLength={MAX_MACRO_NAME}
                  placeholder="Shown in the menu"
                  onChange={(e) => update(m.id, { name: e.target.value })}
                />
              </label>
              <label className="macro-field macro-field-text">
                <span>Text</span>
                <textarea
                  className="dialog-input"
                  value={m.text}
                  maxLength={MAX_MACRO_TEXT}
                  rows={Math.min(4, Math.max(1, m.text.split('\n').length))}
                  placeholder="What the macro inserts"
                  onChange={(e) => update(m.id, { text: e.target.value })}
                />
              </label>
              <label className="macro-field">
                <span>Insert as</span>
                <Select value={m.elementType} onChange={(e) => update(m.id, { elementType: e.target.value })}>
                  <option value="">Text at the cursor</option>
                  {MACRO_ELEMENTS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </Select>
              </label>
              <div className="macro-field">
                <span id={`macro-shortcut-label-${m.id}`}>Shortcut</span>
                <ShortcutField
                  id={`macro-shortcut-${m.id}`}
                  value={m.shortcut}
                  onChange={(spec) => update(m.id, { shortcut: spec })}
                />
              </div>
            </div>
            {clashes.has(m.id) && (
              <div className="settings-hint settings-hint-warning">
                This shortcut is also used by {m.shortcut === elementMenuShortcut ? 'the element menu' : 'another macro'}; only the first one will run.
              </div>
            )}
            <div className="macro-row-actions">
              <button className="dialog-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">&uarr;</button>
              <button className="dialog-btn" onClick={() => move(i, 1)} disabled={i === macros.length - 1} aria-label="Move down">&darr;</button>
              <button className="dialog-btn" onClick={() => remove(m.id)}>Remove</button>
            </div>
          </li>
        ))}
      </ul>

      <div className="macro-toolbar">
        <button className="dialog-btn dialog-btn-primary" onClick={() => setMacros([...macros, createMacro()])}>Add Macro</button>
        <button className="dialog-btn" onClick={() => void handleImport()}>Import&hellip;</button>
        <button className="dialog-btn" onClick={() => void handleExport()} disabled={macros.length === 0}>Export&hellip;</button>
      </div>
      <div className="settings-hint">
        Shortcuts need at least one of {isMacPlatform() ? '⌘, ⌥ or ⌃' : 'Ctrl or Alt'}. A shortcut the editor
        already uses (bold, element types) keeps doing that instead. Macros are kept on this device;
        use Export and Import to move them to another.
      </div>
    </section>
  );
};

export default MacroSettingsSection;
