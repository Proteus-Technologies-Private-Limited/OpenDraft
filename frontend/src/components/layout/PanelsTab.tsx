/**
 * Layout › Panels: where every panel goes (Discussion #273).
 *
 * Drag a group's handle to move the whole group (the entire Navigator, say),
 * or a panel's tab to move only that panel. Dropping a tab on a group adds it
 * to that group; on a group's header, it starts a new group there; on a dock's
 * end, a new group at the end. A group dropped on another group's tabs merges
 * into it. Everything a drag can do can also be done from the settings
 * column, with a keyboard or on a touch screen.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DndContext, DragOverlay, useDraggable, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { FaGripVertical, FaChevronUp, FaChevronDown, FaPlus, FaTrashAlt } from 'react-icons/fa';
import { useEditorFields } from '../../stores/editorStore';
import {
  WORKSPACE_PRESET_IDS,
  dockOfGroup,
  groupOfPanel,
  hidePanel,
  isNavigatorPanel,
  mergeGroups,
  moveGroup,
  movePanelToGroup,
  movePanelToNewGroup,
  placeOfPanel,
  renameGroup,
  setDockArrange,
  setGroupMode,
  shiftPanelInGroup,
  ungroup,
  NAVIGATOR_PANELS,
  type DockId,
  type PanelGroup,
  type PanelPlace,
  type WorkspaceLayout,
} from '../../utils/workspaceLayout';
import { barOf, placeToolbarItem, removeToolbarItem, TOOLBAR_PANEL_PREFIX } from '../../utils/toolbarLayout';
import { panelIcon, usePanelLabel } from '../toolbar/toolbarMeta';
import { layoutCollision, useLayoutAnnouncements, useLayoutSensors } from './dndConfig';
import DropZone from './DropZone';
import LayoutRadioGroup from './LayoutRadioGroup';

type Selection = { kind: 'panel' | 'group'; id: string } | null;

function isRtl(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dir === 'rtl';
}

/** Left/Right for the logical docks, mirrored in right-to-left languages. */
function useDockNames() {
  const { t } = useTranslation('toolbar');
  return useCallback((place: PanelPlace) => {
    if (place === 'hidden') return t('layout.docks.hidden');
    if (place === 'bottom') return t('layout.docks.bottom');
    const left = (place === 'start') !== isRtl();
    return left ? t('layout.docks.left') : t('layout.docks.right');
  }, [t]);
}

/** A group's name: the writer's, else "Navigator", else its panels'. */
function useGroupName() {
  const { t } = useTranslation('toolbar');
  const panelLabel = usePanelLabel();
  return useCallback((group: PanelGroup) => {
    if (group.name) return group.name;
    if (group.panels.length > 1 && group.panels.every(isNavigatorPanel)) return t('layout.panelsTab.navigatorGroupName');
    const names = group.panels.map(panelLabel);
    return names.length > 2 ? `${names.slice(0, 2).join(' · ')} …` : names.join(' · ');
  }, [t, panelLabel]);
}

function PanelChip({ panel, selected, onSelect }: { panel: string; selected: boolean; onSelect: () => void }) {
  const { t } = useTranslation('toolbar');
  const panelLabel = usePanelLabel();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `panel:${panel}` });
  const kind = isNavigatorPanel(panel) ? ' is-navigator' : panel === 'add-ons' ? ' is-addon' : '';
  return (
    <button
      type="button"
      data-layout-focus={`panel:${panel}`}
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`layout-chip${kind}${selected ? ' is-selected' : ''}${isDragging ? ' is-lifted' : ''}`}
      onClick={onSelect}
      onFocus={onSelect}
      title={t('layout.panelsTab.dragPanel', { name: panelLabel(panel) })}
    >
      <span className="layout-chip-icon" aria-hidden="true">{panelIcon(panel)}</span>
      {panelLabel(panel)}
    </button>
  );
}

function GroupCard({ group, dock, selection, onSelect, onMove }: {
  group: PanelGroup;
  dock: DockId;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onMove: (groupId: string, place: PanelPlace) => void;
}) {
  const { t } = useTranslation('toolbar');
  const groupName = useGroupName();
  const dockName = useDockNames();
  const name = groupName(group);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `group:${group.id}` });
  const selected = selection?.kind === 'group' && selection.id === group.id;
  return (
    <div data-layout-focus={`group:${group.id}`} className={`layout-group${selected ? ' is-selected' : ''}${isDragging ? ' is-lifted' : ''}`}>
      <DropZone id={`head:${group.id}`} className="layout-group-head">
        <button type="button" ref={setNodeRef} {...attributes} {...listeners} className="layout-grip"
          aria-label={t('layout.panelsTab.dragGroup', { name })} title={t('layout.panelsTab.dragGroup', { name })}>
          <FaGripVertical aria-hidden="true" />
        </button>
        <button type="button" className="layout-group-name" onClick={() => onSelect({ kind: 'group', id: group.id })}>
          {name}
        </button>
        <span className="layout-group-meta">
          {group.mode === 'stacked' ? t('layout.panelsTab.stacked') : group.panels.length > 1 ? t('layout.panelsTab.tabCount', { count: group.panels.length }) : ''}
        </span>
        <select
          className="layout-group-move"
          aria-label={t('layout.panelsTab.moveGroupTo', { name })}
          value={dock}
          onChange={(e) => onMove(group.id, e.target.value as PanelPlace)}
        >
          {(['start', 'end', 'bottom', 'hidden'] as PanelPlace[]).map((place) => (
            <option key={place} value={place}>{dockName(place)}</option>
          ))}
        </select>
      </DropZone>
      <DropZone id={`tabs:${group.id}`} className={`layout-group-tabs${group.mode === 'stacked' ? ' is-stacked' : ''}`}>
        {group.panels.map((panel) => (
          <PanelChip key={panel} panel={panel}
            selected={selection?.kind === 'panel' && selection.id === panel}
            onSelect={() => onSelect({ kind: 'panel', id: panel })} />
        ))}
      </DropZone>
    </div>
  );
}

interface Props {
  layout: WorkspaceLayout;
  setLayout: (next: WorkspaceLayout) => void;
}

const PanelsTab: React.FC<Props> = ({ layout, setLayout }) => {
  const { t } = useTranslation('toolbar');
  const {
    workspacePreset, applyWorkspacePreset, savedWorkspaceLayouts, saveWorkspaceLayout, deleteSavedWorkspaceLayout,
    toolbarLayout, setToolbarLayout,
  } = useEditorFields(
    'workspacePreset', 'applyWorkspacePreset', 'savedWorkspaceLayouts', 'saveWorkspaceLayout', 'deleteSavedWorkspaceLayout',
    'toolbarLayout', 'setToolbarLayout',
  );
  const panelLabel = usePanelLabel();
  const groupName = useGroupName();
  const dockName = useDockNames();
  const sensors = useLayoutSensors();
  const [selection, setSelection] = useState<Selection>({ kind: 'group', id: groupOfPanel(layout, 'scenes') ?? '' });
  const [dragging, setDragging] = useState<string | null>(null);
  const [naming, setNaming] = useState<string | null>(null);

  const nameOf = useCallback((id: string): string => {
    const [kind, rest] = [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)];
    if (kind === 'panel') return panelLabel(rest);
    if (kind === 'group' || kind === 'head' || kind === 'tabs') {
      const group = layout.groups[rest];
      return group ? groupName(group) : rest;
    }
    if (kind === 'end') return t('layout.dockTitle.' + (rest === 'start' ? 'left' : rest === 'end' ? 'right' : 'bottom') as 'layout.dockTitle.left');
    if (id === 'hidden') return t('layout.docks.hidden');
    return id;
  }, [layout, panelLabel, groupName, t]);
  const announcements = useLayoutAnnouncements(nameOf);

  const onDragStart = (event: DragStartEvent) => setDragging(String(event.active.id));
  const onDragEnd = (event: DragEndEvent) => {
    setDragging(null);
    const over = event.over ? String(event.over.id) : null;
    if (!over) return;
    const active = String(event.active.id);
    const [kind, id] = [active.slice(0, active.indexOf(':')), active.slice(active.indexOf(':') + 1)];
    const target = over.slice(over.indexOf(':') + 1);
    let next = layout;
    if (kind === 'group') {
      if (over.startsWith('head:')) next = moveGroup(layout, id, dockOfGroup(layout, target) ?? 'end', target);
      else if (over.startsWith('tabs:')) next = mergeGroups(layout, id, target);
      else if (over.startsWith('end:')) next = moveGroup(layout, id, target as DockId, null);
      else if (over === 'hidden') next = moveGroup(layout, id, 'hidden');
      setSelection(next.groups[id] ? { kind: 'group', id } : over.startsWith('tabs:') ? { kind: 'group', id: target } : null);
    } else if (kind === 'panel') {
      if (over.startsWith('head:')) next = movePanelToNewGroup(layout, id, dockOfGroup(layout, target) ?? 'end', target);
      else if (over.startsWith('tabs:')) next = movePanelToGroup(layout, id, target);
      else if (over.startsWith('end:')) next = movePanelToNewGroup(layout, id, target as DockId);
      else if (over === 'hidden') next = hidePanel(layout, id);
      setSelection({ kind: 'panel', id });
    }
    if (next !== layout) setLayout(next);
  };

  const moveGroupTo = (groupId: string, place: PanelPlace) => setLayout(moveGroup(layout, groupId, place, null));

  // ── Toolbar buttons for a panel or a group ──
  const toolbarIdFor = (sel: Selection): string | null => {
    if (!sel) return null;
    if (sel.kind === 'panel') return `${TOOLBAR_PANEL_PREFIX}${sel.id}`;
    const group = layout.groups[sel.id];
    if (!group) return null;
    if (group.panels.some(isNavigatorPanel)) return 'navigator';
    return group.panels.length === 1 ? `${TOOLBAR_PANEL_PREFIX}${group.panels[0]}` : null;
  };
  const toggleToolbarButton = (itemId: string) => {
    setToolbarLayout(barOf(toolbarLayout.bars, itemId)
      ? removeToolbarItem(toolbarLayout, itemId)
      : placeToolbarItem(toolbarLayout, itemId, 'top'));
  };

  const presets = WORKSPACE_PRESET_IDS.map((id) => ({ id, label: t(`layout.presets.${id}`), hint: t(`layout.presetHints.${id}`) }));
  const navigatorPlaces = useMemo(() => {
    const places = NAVIGATOR_PANELS.map((p) => placeOfPanel(layout, p));
    return [...new Set(places)].map(dockName).join(', ');
  }, [layout, dockName]);
  const currentLabel = WORKSPACE_PRESET_IDS.includes(workspacePreset as never)
    ? t(`layout.presets.${workspacePreset as 'classic'}`)
    : savedWorkspaceLayouts.find((s) => s.id === workspacePreset)?.label ?? t('layout.presets.custom');

  const docksFor = (dock: DockId) => layout.docks[dock].map((id) => layout.groups[id]).filter(Boolean);

  const renderDock = (dock: DockId) => {
    const groups = docksFor(dock);
    const panelCount = groups.reduce((n, g) => n + g.panels.length, 0);
    const title = t(`layout.dockTitle.${dock === 'bottom' ? 'bottom' : ((dock === 'start') !== isRtl() ? 'left' : 'right')}`);
    const groupDragging = dragging?.startsWith('group:');
    return (
      <section className={`layout-dock layout-dock-${dock}`} aria-label={title}>
        <div className="layout-dock-head">
          <span className="layout-dock-title">{title}</span>
          <span className="layout-dock-meta">
            {t('layout.panelsTab.groupCount', { count: groups.length })} · {panelCount}
          </span>
          <LayoutRadioGroup as="span" className="layout-seg" aria-label={t('layout.panelsTab.groupsArrange')}>
            {(['rows', 'columns'] as const).map((arrange) => (
              <button key={arrange} type="button" role="radio" aria-checked={layout.arrange[dock] === arrange}
                className={layout.arrange[dock] === arrange ? 'is-on' : ''}
                onClick={() => setLayout(setDockArrange(layout, dock, arrange))}>
                {arrange === 'rows' ? t('layout.panelsTab.arrangeRows') : t('layout.panelsTab.arrangeColumns')}
              </button>
            ))}
          </LayoutRadioGroup>
        </div>
        <div className={`layout-dock-groups dock-arrange-${layout.arrange[dock]}`}>
          {groups.map((group) => (
            <GroupCard key={group.id} group={group} dock={dock} selection={selection} onSelect={setSelection} onMove={moveGroupTo} />
          ))}
          <DropZone id={`end:${dock}`} className={`layout-dock-end${groups.length === 0 ? ' is-empty' : ''}`}>
            {dragging
              ? (groupDragging ? t('layout.panelsTab.dropGroup') : t('layout.panelsTab.dropNewGroup'))
              : groups.length === 0 ? t('layout.panelsTab.emptyDock') : t('layout.panelsTab.newGroup')}
          </DropZone>
        </div>
      </section>
    );
  };

  // ── Settings column ──
  const selectedPanel = selection?.kind === 'panel' ? selection.id : null;
  const selectedGroup = selection?.kind === 'group' ? layout.groups[selection.id] : undefined;
  const toolbarItem = toolbarIdFor(selection);

  const renderPanelSettings = (panel: string) => {
    const place = placeOfPanel(layout, panel);
    const groupId = groupOfPanel(layout, panel);
    const group = groupId ? layout.groups[groupId] : undefined;
    return (
      <div className="layout-settings-body" data-layout-focus={`panel:${panel}`}>
        <div className="layout-settings-title">
          <span aria-hidden="true">{panelIcon(panel)}</span>
          <strong>{panelLabel(panel)}</strong>
          {isNavigatorPanel(panel) && <span className="layout-tag">{t('layout.panelsTab.navigatorTag')}</span>}
          {panel === 'add-ons' && <span className="layout-tag is-addon">{t('layout.panelsTab.addOnTag')}</span>}
        </div>
        <label className="layout-field">
          <span>{t('layout.panelsTab.opensIn')}</span>
          <select value={place} onChange={(e) => {
            const to = e.target.value as PanelPlace;
            if (to === 'hidden') { setLayout(hidePanel(layout, panel)); return; }
            const first = layout.docks[to][0];
            setLayout(first ? movePanelToGroup(layout, panel, first) : movePanelToNewGroup(layout, panel, to));
          }}>
            {(['start', 'end', 'bottom', 'hidden'] as PanelPlace[]).map((p) => <option key={p} value={p}>{dockName(p)}</option>)}
          </select>
        </label>
        {place !== 'hidden' && (
          <div className="layout-field">
            <span>{t('layout.panelsTab.group')}</span>
            <LayoutRadioGroup manual className="layout-field" aria-label={t('layout.panelsTab.group')}>
              {docksFor(place as DockId).map((g) => (
                <button key={g.id} type="button" role="radio" aria-checked={g.id === groupId}
                  className={`layout-radio${g.id === groupId ? ' is-on' : ''}`}
                  onClick={() => setLayout(movePanelToGroup(layout, panel, g.id))}>
                  {groupName(g)}
                </button>
              ))}
            </LayoutRadioGroup>
            <button type="button" disabled={!!group && group.panels.length === 1}
              className={`layout-radio${group && group.panels.length === 1 ? ' is-on' : ''}`}
              onClick={() => setLayout(movePanelToNewGroup(layout, panel, place as DockId))}>
              {t('layout.panelsTab.ownGroup')}
            </button>
          </div>
        )}
        <div className="layout-actions">
          {group && group.panels.length > 1 && (
            <button type="button" onClick={() => setLayout(movePanelToNewGroup(layout, panel, place as DockId))}>{t('layout.panelsTab.pullOut')}</button>
          )}
          {place !== 'hidden' && (
            <button type="button" onClick={() => setLayout(hidePanel(layout, panel))}>{t('layout.panelsTab.dontPlace')}</button>
          )}
        </div>
      </div>
    );
  };

  const renderGroupSettings = (group: PanelGroup) => {
    const dock = dockOfGroup(layout, group.id) ?? 'end';
    return (
      <div className="layout-settings-body" data-layout-focus={`group:${group.id}`}>
        <label className="layout-field">
          <span>{t('layout.panelsTab.groupName')}</span>
          <input type="text" value={group.name ?? ''} placeholder={groupName({ ...group, name: undefined })} maxLength={40}
            onChange={(e) => setLayout(renameGroup(layout, group.id, e.target.value))} />
        </label>
        <label className="layout-field">
          <span>{t('layout.panelsTab.opensIn')}</span>
          <select value={dock} onChange={(e) => moveGroupTo(group.id, e.target.value as PanelPlace)}>
            {(['start', 'end', 'bottom', 'hidden'] as PanelPlace[]).map((p) => <option key={p} value={p}>{dockName(p)}</option>)}
          </select>
        </label>
        <div className="layout-field">
          <span>{t('layout.panelsTab.showAs')}</span>
          <LayoutRadioGroup as="span" className="layout-seg" aria-label={t('layout.panelsTab.showAs')}>
            {(['tabs', 'stacked'] as const).map((mode) => (
              <button key={mode} type="button" role="radio" aria-checked={group.mode === mode}
                className={group.mode === mode ? 'is-on' : ''} onClick={() => setLayout(setGroupMode(layout, group.id, mode))}>
                {mode === 'tabs' ? t('layout.panelsTab.tabs') : t('layout.panelsTab.stacked')}
              </button>
            ))}
          </LayoutRadioGroup>
        </div>
        <div className="layout-field">
          <span>{t('layout.panelsTab.panelsInGroup')}</span>
          <ul className="layout-order-list">
            {group.panels.map((panel, index) => (
              <li key={panel} data-layout-focus={`order:${panel}`}>
                <span aria-hidden="true">{panelIcon(panel)}</span>
                <span className="layout-order-name">{panelLabel(panel)}</span>
                <button type="button" disabled={index === 0} aria-label={t('layout.panelsTab.moveUp', { name: panelLabel(panel) })}
                  onClick={() => setLayout(shiftPanelInGroup(layout, panel, -1))}><FaChevronUp aria-hidden="true" /></button>
                <button type="button" disabled={index === group.panels.length - 1} aria-label={t('layout.panelsTab.moveDown', { name: panelLabel(panel) })}
                  onClick={() => setLayout(shiftPanelInGroup(layout, panel, 1))}><FaChevronDown aria-hidden="true" /></button>
              </li>
            ))}
          </ul>
        </div>
        <div className="layout-actions">
          {group.panels.length > 1 && <button type="button" onClick={() => setLayout(ungroup(layout, group.id))}>{t('layout.panelsTab.ungroup')}</button>}
          <button type="button" onClick={() => { moveGroupTo(group.id, 'hidden'); setSelection(null); }}>{t('layout.panelsTab.dontPlace')}</button>
        </div>
      </div>
    );
  };

  return (
    <DndContext sensors={sensors} collisionDetection={layoutCollision} onDragStart={onDragStart} onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(null)} accessibility={{ announcements }}>
      <div className="layout-panels">
        <aside className="layout-presets" aria-label={t('layout.panelsTab.presetsHeading')}>
          <h3>{t('layout.panelsTab.presetsHeading')}</h3>
          {presets.map((preset) => (
            <button key={preset.id} type="button" aria-pressed={workspacePreset === preset.id}
              className={`layout-preset${workspacePreset === preset.id ? ' is-on' : ''}`}
              onClick={() => applyWorkspacePreset(preset.id)}>
              <strong>{preset.label}</strong>
              <span>{preset.hint}</span>
            </button>
          ))}
          {savedWorkspaceLayouts.length > 0 && <h3>{t('layout.panelsTab.savedHeading')}</h3>}
          {savedWorkspaceLayouts.map((saved) => (
            <div key={saved.id} className={`layout-preset-row${workspacePreset === saved.id ? ' is-on' : ''}`}>
              <button type="button" aria-pressed={workspacePreset === saved.id} className="layout-preset"
                onClick={() => applyWorkspacePreset(saved.id)}>
                <strong>{saved.label}</strong>
                <span>{t('layout.presetHints.saved')}</span>
              </button>
              <button type="button" className="layout-icon-btn" aria-label={t('layout.panelsTab.deleteNamed', { name: saved.label })}
                onClick={() => deleteSavedWorkspaceLayout(saved.id)}><FaTrashAlt aria-hidden="true" /></button>
            </div>
          ))}
          {naming === null ? (
            <button type="button" data-layout-focus="save-panels" className="layout-save-as" onClick={() => setNaming('')}>
              <FaPlus aria-hidden="true" /> {t('layout.panelsTab.saveAs')}
            </button>
          ) : (
            <form data-layout-focus="save-panels" className="layout-save-form" onSubmit={(e) => {
              e.preventDefault();
              if (saveWorkspaceLayout(naming)) setNaming(null);
            }}>
              <label>
                <span>{t('layout.panelsTab.nameLabel')}</span>
                <input type="text" value={naming} maxLength={40} autoFocus onChange={(e) => setNaming(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setNaming(null); } }} />
              </label>
              <div className="layout-actions">
                <button type="submit" disabled={!naming.trim()}>{t('layout.panelsTab.save')}</button>
                <button type="button" onClick={() => setNaming(null)}>{t('layout.panelsTab.cancel')}</button>
              </div>
            </form>
          )}
        </aside>

        <div className="layout-canvas">
          <p className="layout-hint">
            {t('layout.panelsTab.hintGroup')} {t('layout.panelsTab.hintPanel')}
            <span className="layout-legend"><span className="layout-legend-swatch" aria-hidden="true" /> {t('layout.panelsTab.legendNavigator')}</span>
          </p>
          <p className="layout-status" aria-live="polite">{t('layout.panelsTab.status', { preset: currentLabel, places: navigatorPlaces })}</p>
          <div className="layout-docks">
            {renderDock('start')}
            <div className="layout-writing-area" aria-hidden="true">
              <span>{t('layout.panelsTab.writingArea')}</span>
              <div className="layout-page"><i /><i /><i /><i /><i /><i /></div>
              <small>{t('layout.panelsTab.writingAreaHint')}</small>
            </div>
            {renderDock('end')}
            {renderDock('bottom')}
          </div>
          <DropZone id="hidden" className="layout-hidden-tray" aria-label={t('layout.docks.hidden')}>
            <span className="layout-dock-title">{t('layout.docks.hidden')}</span>
            {layout.hidden.map((panel) => (
              <PanelChip key={panel} panel={panel} selected={selectedPanel === panel} onSelect={() => setSelection({ kind: 'panel', id: panel })} />
            ))}
            <small>{t('layout.panelsTab.notPlacedHint')}</small>
          </DropZone>
        </div>

        <aside className="layout-settings" aria-label={t('layout.panelsTab.selected')}>
          <h3>{t('layout.panelsTab.selected')}</h3>
          {selectedPanel && renderPanelSettings(selectedPanel)}
          {selectedGroup && renderGroupSettings(selectedGroup)}
          {!selectedPanel && !selectedGroup && <p className="layout-muted">{t('layout.panelsTab.noSelection')}</p>}
          {toolbarItem && (
            <label className="layout-check">
              <input type="checkbox" checked={!!barOf(toolbarLayout.bars, toolbarItem)} onChange={() => toggleToolbarButton(toolbarItem)} />
              <span>
                <strong>{t('layout.panelsTab.toolbarButton')}</strong>
                <small>{t('layout.panelsTab.toolbarButtonHint', {
                  name: selectedPanel ? panelLabel(selectedPanel) : selectedGroup ? groupName(selectedGroup) : '',
                })}</small>
              </span>
            </label>
          )}
          <p className="layout-muted layout-footnote">{t('layout.panelsTab.footerNote')}</p>
        </aside>
      </div>
      <DragOverlay dropAnimation={null}>
        {dragging ? <div className="layout-drag-ghost">{nameOf(dragging)}</div> : null}
      </DragOverlay>
    </DndContext>
  );
};

export default PanelsTab;
