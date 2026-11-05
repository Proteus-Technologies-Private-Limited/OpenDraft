/**
 * Customise Toolbar: choose the controls the toolbar shows, in which order,
 * and start from a preset (Default, Writing, Review, Everything).
 *
 * The current bar is the Default preset, so a writer who never opens this
 * dialog sees exactly the toolbar they always had. Every change is saved as it
 * is made, on this device only (the same local view state as the zoom), so the
 * laptop and the iPad can each have their own bar.
 *
 * Reordering is by drag and drop — the arrows were fiddly for a list this
 * size. A focused row also moves with Alt+↑/↓ for keyboard use, and zoom is
 * marked as pinned because the bar always draws it on the left.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { FaGripVertical, FaPlus, FaTimes } from 'react-icons/fa';
import { useEditorStore } from '../stores/editorStore';
import { pluginRegistry, type PluginPanelEntry } from '../plugins/registry';
import {
  TOOLBAR_ITEMS,
  TOOLBAR_PINNED_ITEMS,
  TOOLBAR_PLUGIN_PREFIX,
  TOOLBAR_PRESETS,
  addToolbarItem,
  moveToolbarItem,
  moveToolbarItemTo,
  removeToolbarItem,
  type ToolbarGroup,
  type ToolbarItemDefinition,
} from '../utils/toolbarLayout';

const GROUP_LABELS: Record<ToolbarGroup, string> = {
  document: 'Document',
  format: 'Writing',
  view: 'View',
};

const GROUP_ORDER: ToolbarGroup[] = ['document', 'format', 'view'];

interface DragState {
  id: string;
  from: 'chosen' | 'available';
}

const ToolbarCustomiseDialog: React.FC = () => {
  const open = useEditorStore((s) => s.toolbarCustomiseOpen);
  const setOpen = useEditorStore((s) => s.setToolbarCustomiseOpen);
  const items = useEditorStore((s) => s.toolbarItems);
  const preset = useEditorStore((s) => s.toolbarPreset);
  const layouts = useEditorStore((s) => s.toolbarLayouts);
  const setToolbarItems = useEditorStore((s) => s.setToolbarItems);
  const applyToolbarPreset = useEditorStore((s) => s.applyToolbarPreset);
  const saveToolbarLayout = useEditorStore((s) => s.saveToolbarLayout);
  const applyToolbarLayout = useEditorStore((s) => s.applyToolbarLayout);
  const deleteToolbarLayout = useEditorStore((s) => s.deleteToolbarLayout);
  const [layoutName, setLayoutName] = useState('');
  const [savingLayout, setSavingLayout] = useState(false);
  const [pluginPanels, setPluginPanels] = useState<PluginPanelEntry[]>(() =>
    pluginRegistry.getPanels('toolbar'));
  const [drag, setDrag] = useState<DragState | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  useEffect(() => {
    const sync = () => setPluginPanels(pluginRegistry.getPanels('toolbar'));
    sync();
    return pluginRegistry.subscribe(sync);
  }, []);

  const definitions = useMemo<Record<string, ToolbarItemDefinition>>(() => {
    const out: Record<string, ToolbarItemDefinition> = {};
    for (const item of TOOLBAR_ITEMS) out[item.id] = item;
    for (const panel of pluginPanels) {
      out[`${TOOLBAR_PLUGIN_PREFIX}${panel.id}`] = {
        id: `${TOOLBAR_PLUGIN_PREFIX}${panel.id}`,
        label: panel.label,
        description: 'Added by a plugin.',
        group: 'view',
      };
    }
    return out;
  }, [pluginPanels]);

  const chosen = useMemo(
    () => items.map((id) => definitions[id]).filter((item): item is ToolbarItemDefinition => !!item),
    [items, definitions],
  );

  const availableGroups = useMemo(() => {
    const missing = Object.values(definitions).filter((item) => !items.includes(item.id));
    return GROUP_ORDER
      .map((group) => ({ group, items: missing.filter((item) => item.group === group) }))
      .filter((entry) => entry.items.length > 0);
  }, [definitions, items]);

  const pluginIds = useMemo(
    () => pluginPanels.map((panel) => `${TOOLBAR_PLUGIN_PREFIX}${panel.id}`).filter((id) => items.includes(id)),
    [pluginPanels, items],
  );

  if (!open) return null;

  const close = () => setOpen(false);
  const clearDrag = () => { setDrag(null); setOverIndex(null); };

  /**
   * Drop an item at a position. Dropping a chosen row moves it; dropping one
   * from Available adds it there. The store is read at drop time, so a fast
   * sequence of drags cannot work from a stale list.
   */
  const dropAt = (index: number) => {
    if (!drag) return;
    const current = useEditorStore.getState().toolbarItems;
    const next = drag.from === 'available'
      ? moveToolbarItemTo([...current, drag.id], drag.id, index)
      : moveToolbarItemTo(current, drag.id, index);
    setToolbarItems(next);
    clearDrag();
  };

  const startDrag = (event: React.DragEvent, id: string, from: DragState['from']) => {
    setDrag({ id, from });
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', id);
  };

  const saveLayout = () => {
    if (!saveToolbarLayout(layoutName)) return;
    setLayoutName('');
    setSavingLayout(false);
  };

  return (
    <div className="dialog-overlay" onClick={close}>
      <div
        className="dialog-box toolbar-customise"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Customise Toolbar"
      >
        <div className="dialog-header">Customise Toolbar</div>
        <div className="dialog-body toolbar-customise-body">
          <p className="toolbar-customise-intro">
            Choose what the toolbar shows and in what order. The layout is saved on this device.
          </p>

          <div className="toolbar-customise-presets" role="group" aria-label="Toolbar presets">
            {TOOLBAR_PRESETS.map((option) => (
              <button
                key={option.id}
                className={`toolbar-customise-preset${preset === option.id ? ' active' : ''}`}
                onClick={() => applyToolbarPreset(option.id)}
                title={option.description}
                aria-pressed={preset === option.id}
              >
                {option.label}
              </button>
            ))}
            {layouts.map((layout) => (
              <span
                className={`toolbar-customise-preset-wrap${preset === layout.id ? ' active' : ''}`}
                key={layout.id}
              >
                <button
                  className={`toolbar-customise-preset${preset === layout.id ? ' active' : ''}`}
                  onClick={() => applyToolbarLayout(layout.id)}
                  title={`Apply ${layout.label}`}
                  aria-pressed={preset === layout.id}
                >
                  {layout.label}
                </button>
                <button
                  className="toolbar-customise-preset-delete"
                  onClick={() => deleteToolbarLayout(layout.id)}
                  title={`Delete ${layout.label}`}
                  aria-label={`Delete ${layout.label}`}
                >
                  <FaTimes />
                </button>
              </span>
            ))}
            {preset === 'custom' && (
              <span className="toolbar-customise-custom-note">Custom layout</span>
            )}
          </div>

          {savingLayout ? (
            <div className="toolbar-customise-save-form">
              <input
                autoFocus
                className="toolbar-customise-save-input"
                value={layoutName}
                placeholder="Layout name"
                aria-label="Layout name"
                onChange={(e) => setLayoutName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveLayout();
                  if (e.key === 'Escape') { setSavingLayout(false); setLayoutName(''); }
                }}
              />
              <button
                className="toolbar-customise-save-confirm"
                onClick={saveLayout}
                disabled={!layoutName.trim()}
              >
                Save
              </button>
              <button
                className="toolbar-customise-save-cancel"
                onClick={() => { setSavingLayout(false); setLayoutName(''); }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button className="toolbar-customise-save" onClick={() => setSavingLayout(true)}>
              Save current layout as…
            </button>
          )}

          <div className="toolbar-customise-columns">
            <section className="toolbar-customise-section" aria-label="On the toolbar">
              <h4>On the toolbar</h4>
              <p className="toolbar-customise-hint">
                Drag a control to reorder it, or drop one here from Available. With a keyboard,
                focus a row and press Alt+↑/↓.
              </p>
              <ul
                className={`toolbar-customise-list${drag && overIndex === chosen.length ? ' drag-over-end' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setOverIndex(chosen.length); }}
                onDrop={(e) => { e.preventDefault(); dropAt(chosen.length); }}
              >
                {chosen.map((item, index) => {
                  const pinned = TOOLBAR_PINNED_ITEMS.has(item.id);
                  return (
                    <li
                      className={`toolbar-customise-row${drag?.id === item.id ? ' dragging' : ''}${overIndex === index ? ' drag-over' : ''}`}
                      key={item.id}
                      draggable={!pinned}
                      onDragStart={(e) => { if (pinned) { e.preventDefault(); return; } startDrag(e, item.id, 'chosen'); }}
                      onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setOverIndex(index); }}
                      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); dropAt(index); }}
                      onDragEnd={clearDrag}
                      tabIndex={pinned ? -1 : 0}
                      onKeyDown={(e) => {
                        if (pinned) return;
                        if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                          e.preventDefault();
                          setToolbarItems(moveToolbarItem(
                            useEditorStore.getState().toolbarItems,
                            item.id,
                            e.key === 'ArrowUp' ? -1 : 1,
                          ));
                        }
                      }}
                    >
                      {!pinned
                        ? <span className="toolbar-customise-grip" aria-hidden="true"><FaGripVertical /></span>
                        : <span className="toolbar-customise-grip-space" aria-hidden="true" />}
                      <span className="toolbar-customise-row-main">
                        <span className="toolbar-customise-name">{item.label}</span>
                        <span className="toolbar-customise-desc">{item.description}</span>
                      </span>
                      {pinned && <span className="toolbar-customise-pin">Pinned right</span>}
                      <button
                        className="toolbar-customise-move toolbar-customise-remove"
                        onClick={() => setToolbarItems(removeToolbarItem(useEditorStore.getState().toolbarItems, item.id))}
                        disabled={items.length <= 1}
                        title={`Remove ${item.label}`}
                        aria-label={`Remove ${item.label}`}
                      >
                        <FaTimes />
                      </button>
                    </li>
                  );
                })}
                {chosen.length === 0 && (
                  <li className="toolbar-customise-empty">No controls yet. Drag one here from Available.</li>
                )}
              </ul>
            </section>

            <section className="toolbar-customise-section" aria-label="Available controls">
              <h4>Available</h4>
              {availableGroups.length === 0 ? (
                <p className="toolbar-customise-empty">Every control is already on the toolbar.</p>
              ) : availableGroups.map(({ group, items: groupItems }) => (
                <div className="toolbar-customise-group" key={group}>
                  <h5>{GROUP_LABELS[group]}</h5>
                  <ul className="toolbar-customise-list">
                    {groupItems.map((item) => (
                      <li
                        className="toolbar-customise-row"
                        key={item.id}
                        draggable
                        onDragStart={(e) => startDrag(e, item.id, 'available')}
                        onDragEnd={clearDrag}
                      >
                        <span className="toolbar-customise-grip" aria-hidden="true"><FaGripVertical /></span>
                        <span className="toolbar-customise-row-main">
                          <span className="toolbar-customise-name">{item.label}</span>
                          <span className="toolbar-customise-desc">{item.description}</span>
                        </span>
                        <button
                          className="toolbar-customise-move toolbar-customise-add"
                          onClick={() => setToolbarItems(addToolbarItem(useEditorStore.getState().toolbarItems, item.id))}
                          title={`Add ${item.label}`}
                          aria-label={`Add ${item.label}`}
                        >
                          <FaPlus />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {pluginIds.length > 0 && (
                <p className="toolbar-customise-plugin-note">
                  {pluginIds.length} plugin control{pluginIds.length === 1 ? '' : 's'} on the toolbar.
                </p>
              )}
            </section>
          </div>
        </div>
        <div className="dialog-actions toolbar-customise-actions">
          <button onClick={() => applyToolbarPreset('default')}>Reset to Default</button>
          <button className="dialog-primary" onClick={close}>Done</button>
        </div>
      </div>
    </div>
  );
};

export default ToolbarCustomiseDialog;
