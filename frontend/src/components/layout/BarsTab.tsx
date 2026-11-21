/**
 * Layout › Toolbar & footer: which controls each bar shows, in what order, on
 * which side, and how each is labelled (PR #217, extended for #273).
 *
 * Drag a control onto a row to put it before that row, onto a side's divider
 * to put it at the end of that side, onto either bar of the preview to add it
 * there, or back onto Available to take it off. The arrow buttons and the
 * settings column do the same without dragging.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DndContext, DragOverlay, useDraggable, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { FaGripVertical, FaChevronLeft, FaChevronRight, FaTimes, FaPlus, FaTrashAlt } from 'react-icons/fa';
import { useEditorFields } from '../../stores/editorStore';
import { pluginRegistry } from '../../plugins/registry';
import { useWorkspaceDocksAvailable } from '../../hooks/useWorkspaceDocks';
import {
  TOOLBAR_PRESETS,
  TOOLBAR_PLUGIN_PREFIX,
  TOOLBAR_SIDES,
  allToolbarItemIds,
  barOf,
  canPlaceOn,
  canShowNoHeading,
  effectiveLabel,
  effectiveSide,
  effectiveZoomStyle,
  placeToolbarItem,
  removeToolbarItem,
  setToolbarItemOptions,
  shiftToolbarItem,
  splitBySide,
  toolbarItemDefinition,
  type ToolbarBar,
  type ToolbarBarLabel,
  type ToolbarLabelMode,
  type ToolbarLayoutState,
  type ToolbarSide,
} from '../../utils/toolbarLayout';
import { layoutPanels, WORKSPACE_PRESET_IDS } from '../../utils/workspaceLayout';
import { useToolbarItemMeta } from '../toolbar/toolbarMeta';
import { usePhoneScreen } from '../../hooks/usePhoneScreen';
import { layoutCollision, useLayoutAnnouncements, useLayoutSensors } from './dndConfig';
import DropZone from './DropZone';
import LayoutRadioGroup from './LayoutRadioGroup';
import { useLayoutFocus } from './useLayoutFocus';

const MODES: ToolbarLabelMode[] = ['icon', 'text', 'both', 'none'];
const BAR_MODES: ToolbarBarLabel[] = ['icon', 'text', 'both'];

/** How a control looks with its label setting, for the preview. */
function PreviewChip({ id, mode, selected, onSelect }: { id: string; mode: ToolbarLabelMode; selected: boolean; onSelect: () => void }) {
  const meta = useToolbarItemMeta()(id);
  const def = toolbarItemDefinition(id);
  const status = def?.kind === 'status';
  const showIcon = !status && (mode === 'icon' || mode === 'both');
  const showText = status || mode === 'text' || mode === 'both';
  return (
    <button type="button" className={`bars-preview-chip${def?.group === 'panels' ? ' is-panel' : ''}${status ? ' is-status' : ''}${selected ? ' is-selected' : ''}`}
      onClick={onSelect} title={meta.label}>
      {showIcon && <span aria-hidden="true">{meta.icon}</span>}
      {showText && <span>{meta.label}</span>}
      {(def?.kind === 'select' || (def?.kind === 'layout')) && <span className="bars-preview-value" aria-hidden="true">▾</span>}
      {def?.kind === 'zoom' && <span className="bars-preview-value">100%</span>}
      {!showIcon && !showText && def?.kind === 'select' && <span className="bars-preview-value">{meta.label}</span>}
    </button>
  );
}

function BarRow({ id, bar, state, selected, onSelect, onChange }: {
  id: string;
  bar: ToolbarBar;
  state: ToolbarLayoutState;
  selected: boolean;
  onSelect: () => void;
  onChange: (next: ToolbarLayoutState) => void;
}) {
  const { t } = useTranslation('toolbar');
  const meta = useToolbarItemMeta()(id);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `item:${id}` });
  const phone = usePhoneScreen();
  const chosen = effectiveLabel(id, bar, state);
  // What the bar shows here: a phone's toolbar shows icons whatever is chosen.
  const mode = bar === 'top' && phone && (chosen === 'text' || chosen === 'both') ? 'icon' : chosen;
  const def = toolbarItemDefinition(id);
  const extra = def?.kind === 'zoom'
    ? ` · ${t(`layout.toolbarTab.zoom${({ buttons: 'Buttons', slider: 'Slider', both: 'Both' } as const)[effectiveZoomStyle(bar, state.options[id])]}`)}`
    : def?.kind === 'layout' ? ` · ${(state.options[id]?.layoutStyle ?? 'menu') === 'menu' ? t('layout.toolbarTab.menu') : t('layout.toolbarTab.buttons')}` : '';
  const lone = bar === 'top' && state.bars.top.length === 1;
  return (
    <DropZone id={`row:${bar}:${id}`} data-layout-focus={`item:${id}`} className={`bars-row${selected ? ' is-selected' : ''}${def?.group === 'panels' ? ' is-panel' : ''}${isDragging ? ' is-lifted' : ''}`}>
      <button type="button" ref={setNodeRef} {...attributes} {...listeners} className="layout-grip" aria-label={t('layout.panelsTab.dragPanel', { name: meta.label })}>
        <FaGripVertical aria-hidden="true" />
      </button>
      <button type="button" className="bars-row-main" onClick={onSelect} onFocus={onSelect}>
        <span className="bars-row-icon" aria-hidden="true">{meta.icon}</span>
        <span className="bars-row-text">
          <strong>{meta.label}</strong>
          <small>{def?.kind === 'status' ? t('layout.toolbarTab.groups.status') : `${t(`layout.modes.${mode}`)}${extra}`}</small>
        </span>
      </button>
      <button type="button" className="layout-icon-btn" aria-label={t('layout.toolbarTab.moveLeft', { name: meta.label })}
        onClick={() => onChange(shiftToolbarItem(state, id, -1))}><FaChevronLeft aria-hidden="true" /></button>
      <button type="button" className="layout-icon-btn" aria-label={t('layout.toolbarTab.moveRight', { name: meta.label })}
        onClick={() => onChange(shiftToolbarItem(state, id, 1))}><FaChevronRight aria-hidden="true" /></button>
      <button type="button" className="layout-icon-btn" disabled={lone}
        aria-label={t('layout.toolbarTab.removeNamed', { name: meta.label })}
        title={lone ? t('layout.toolbarTab.keepOne') : undefined}
        onClick={() => onChange(removeToolbarItem(state, id))}><FaTimes aria-hidden="true" /></button>
    </DropZone>
  );
}

function AvailableRow({ id, selected, onSelect, onAdd }: { id: string; selected: boolean; onSelect: () => void; onAdd: (bar: ToolbarBar) => void }) {
  const { t } = useTranslation('toolbar');
  const meta = useToolbarItemMeta()(id);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `item:${id}` });
  return (
    <div data-layout-focus={`item:${id}`} className={`bars-row is-available${selected ? ' is-selected' : ''}${isDragging ? ' is-lifted' : ''}`}>
      <button type="button" ref={setNodeRef} {...attributes} {...listeners} className="layout-grip" aria-label={t('layout.panelsTab.dragPanel', { name: meta.label })}>
        <FaGripVertical aria-hidden="true" />
      </button>
      <button type="button" className="bars-row-main" onClick={onSelect} onFocus={onSelect} title={meta.description}>
        <span className="bars-row-icon" aria-hidden="true">{meta.icon}</span>
        <span className="bars-row-text"><strong>{meta.label}</strong></span>
      </button>
      {canPlaceOn(id, 'top') && (
        <button type="button" className="layout-icon-btn bars-add" aria-label={t('layout.toolbarTab.addToToolbar', { name: meta.label })}
          title={t('layout.toolbarTab.addToToolbar', { name: meta.label })} onClick={() => onAdd('top')}>
          <FaPlus aria-hidden="true" /><span className="bars-add-where">{t('layout.toolbarTab.onToolbar')}</span>
        </button>
      )}
      <button type="button" className="layout-icon-btn bars-add" aria-label={t('layout.toolbarTab.addToFooter', { name: meta.label })}
        title={t('layout.toolbarTab.addToFooter', { name: meta.label })} onClick={() => onAdd('bottom')}>
        <FaPlus aria-hidden="true" /><span className="bars-add-where">{t('layout.toolbarTab.onFooter')}</span>
      </button>
    </div>
  );
}

interface Props {
  state: ToolbarLayoutState;
  setState: (next: ToolbarLayoutState) => void;
}

const BarsTab: React.FC<Props> = ({ state, setState }) => {
  const { t } = useTranslation('toolbar');
  const focus = useLayoutFocus();
  const {
    toolbarPreset, applyToolbarPreset, savedToolbarLayouts, saveToolbarLayout, applySavedToolbarLayout,
    deleteSavedToolbarLayout, workspaceLayout, savedWorkspaceLayouts,
  } = useEditorFields(
    'toolbarPreset', 'applyToolbarPreset', 'savedToolbarLayouts', 'saveToolbarLayout', 'applySavedToolbarLayout',
    'deleteSavedToolbarLayout', 'workspaceLayout', 'savedWorkspaceLayouts',
  );
  const metaOf = useToolbarItemMeta();
  const sensors = useLayoutSensors();
  const [selected, setSelected] = useState<string>('zoom');
  const [dragging, setDragging] = useState<string | null>(null);
  const [naming, setNaming] = useState<string | null>(null);
  // A phone's toolbar shows icons whatever is chosen (Toolbar.tsx), so its
  // label choices are not offered there.
  const phone = usePhoneScreen();
  const sideName = useCallback((side: ToolbarSide) => (
    side === 'start' ? t('layout.toolbarTab.startSide') : side === 'center' ? t('layout.toolbarTab.centerSide') : t('layout.toolbarTab.endSide')
  ), [t]);
  const sideShort = (side: ToolbarSide) => (
    side === 'start' ? t('layout.toolbarTab.start') : side === 'center' ? t('layout.toolbarTab.center') : t('layout.toolbarTab.end')
  );

  const placedPanels = useMemo(
    () => layoutPanels(workspaceLayout).filter((p) => !workspaceLayout.hidden.includes(p) && !p.startsWith('plugin:')),
    [workspaceLayout],
  );
  const pluginIds = useMemo(() => pluginRegistry.getPanels('toolbar').map((p) => p.id), []);
  // The Layout switcher moves the panel docks; where there are none (a phone,
  // a narrow window) the bars leave it out, so the customiser does too. A
  // placement made on a wider screen is kept in the saved layout.
  const docksAvailable = useWorkspaceDocksAvailable();
  const shown = useCallback((id: string) => docksAvailable || id !== 'layout', [docksAvailable]);
  const everyItem = useMemo(
    () => allToolbarItemIds(placedPanels, pluginIds).filter(shown),
    [placedPanels, pluginIds, shown],
  );
  const available = everyItem.filter((id) => !barOf(state.bars, id));

  const nameOf = useCallback((dragId: string) => {
    if (dragId.startsWith('item:')) return metaOf(dragId.slice(5)).label;
    if (dragId.startsWith('row:')) return metaOf(dragId.split(':').slice(2).join(':')).label;
    if (dragId.startsWith('side:')) {
      const [, bar, side] = dragId.split(':');
      return `${bar === 'top' ? t('layout.toolbarTab.onToolbar') : t('layout.toolbarTab.onFooter')}, ${sideName(side as ToolbarSide)}`;
    }
    if (dragId.startsWith('bar:')) return dragId === 'bar:top' ? t('layout.toolbarTab.onToolbar') : t('layout.toolbarTab.onFooter');
    if (dragId === 'avail') return t('layout.toolbarTab.available');
    return dragId;
  }, [metaOf, t, sideName]);
  const announcements = useLayoutAnnouncements(nameOf);

  const onDragStart = (event: DragStartEvent) => setDragging(String(event.active.id));
  const onDragEnd = (event: DragEndEvent) => {
    setDragging(null);
    const active = String(event.active.id);
    const over = event.over ? String(event.over.id) : null;
    if (!over || !active.startsWith('item:')) return;
    const id = active.slice(5);
    let next = state;
    if (over.startsWith('row:')) {
      const [, bar, ...rest] = over.split(':');
      const before = rest.join(':');
      if (before !== id) next = placeToolbarItem(state, id, bar as ToolbarBar, { before });
    } else if (over.startsWith('side:')) {
      const [, bar, side] = over.split(':');
      next = placeToolbarItem(state, id, bar as ToolbarBar, { side: side as ToolbarSide });
    } else if (over.startsWith('bar:')) {
      next = placeToolbarItem(state, id, over.slice(4) as ToolbarBar);
    } else if (over === 'avail') {
      next = removeToolbarItem(state, id);
    }
    setSelected(id);
    if (next !== state) setState(next);
  };

  const renderList = (bar: ToolbarBar) => {
    const sides = splitBySide(state.bars[bar].filter(shown), state.options);
    const title = bar === 'top' ? t('layout.toolbarTab.onToolbar') : t('layout.toolbarTab.onFooter');
    const divider = (side: ToolbarSide) => (
      <DropZone id={`side:${bar}:${side}`} className="bars-side">
        {dragging
          ? (side === 'start' ? t('layout.toolbarTab.dropStart') : side === 'center' ? t('layout.toolbarTab.dropCenter') : t('layout.toolbarTab.dropEnd'))
          : sideName(side)}
      </DropZone>
    );
    return (
      <section className="bars-list" aria-label={title}>
        <h3>{title} <small>{t('layout.toolbarTab.count', { count: state.bars[bar].filter(shown).length })}</small></h3>
        <div className="bars-list-body">
          {TOOLBAR_SIDES.map((side) => (
            <React.Fragment key={side}>
              {divider(side)}
              {sides[side].map((id) => <BarRow key={id} id={id} bar={bar} state={state} selected={selected === id} onSelect={() => setSelected(id)} onChange={setState} />)}
            </React.Fragment>
          ))}
        </div>
        {bar === 'bottom' && <small className="layout-muted bars-list-note">{t('layout.toolbarTab.narrowFooterNote')}</small>}
      </section>
    );
  };

  const renderPreviewBar = (bar: ToolbarBar) => {
    const { start, center, end } = splitBySide(state.bars[bar].filter(shown), state.options);
    const modeOf = (id: string) => {
      const mode = effectiveLabel(id, bar, state);
      return bar === 'top' && phone && (mode === 'text' || mode === 'both') ? 'icon' : mode;
    };
    const chip = (id: string) => <PreviewChip key={id} id={id} mode={modeOf(id)} selected={selected === id} onSelect={() => setSelected(id)} />;
    return (
      <DropZone id={`bar:${bar}`} className={`bars-preview-bar bars-preview-${bar}`}>
        <span className="bars-preview-tag">{bar === 'top' ? t('layout.toolbarTab.onToolbar') : t('layout.toolbarTab.onFooter')}</span>
        {start.map(chip)}
        <span className="bars-preview-spacer" />
        {center.length > 0 && <>{center.map(chip)}<span className="bars-preview-spacer" /></>}
        {end.map(chip)}
      </DropZone>
    );
  };

  const groupOf = (id: string): 'writing' | 'document' | 'view' | 'panels' | 'status' | 'plugins' =>
    (id.startsWith(TOOLBAR_PLUGIN_PREFIX) ? 'plugins' : toolbarItemDefinition(id)?.group ?? 'view');
  const availableGroups = (['status', 'writing', 'document', 'view', 'panels', 'plugins'] as const)
    .map((g) => ({ g, ids: available.filter((id) => groupOf(id) === g) }))
    .filter((entry) => entry.ids.length > 0);

  // ── Settings for the selected control ──
  const sel = everyItem.includes(selected) || (shown(selected) && barOf(state.bars, selected)) ? selected : null;
  const renderSettings = () => {
    if (!sel) return <p className="layout-muted">{t('layout.panelsTab.noSelection')}</p>;
    const meta = metaOf(sel);
    const bar = barOf(state.bars, sel);
    const options = state.options[sel] ?? {};
    const def = toolbarItemDefinition(sel);
    const side = effectiveSide(sel, state.options);
    const fallbackBar: ToolbarBar = bar ?? 'top';
    const defaultMode = effectiveLabel(sel, fallbackBar, { options: { ...state.options, [sel]: { ...options, label: undefined } }, labels: state.labels });
    const modes = MODES.filter((m) => m !== 'none' || canShowNoHeading(sel, options));
    const hidden = new Set(options.hiddenLayouts ?? []);
    const layoutChoices = [
      ...WORKSPACE_PRESET_IDS.map((id) => ({ id, label: t(`layout.presets.${id}`) })),
      ...savedWorkspaceLayouts.map((s) => ({ id: s.id, label: s.label })),
    ];
    const setOptions = (patch: Parameters<typeof setToolbarItemOptions>[2]) => setState(setToolbarItemOptions(state, sel, patch));
    return (
      <div className="layout-settings-body">
        <div className="layout-settings-title">
          <span aria-hidden="true">{meta.icon}</span>
          <strong>{meta.label}</strong>
        </div>
        <p className="layout-muted">
          {bar ? t(`layout.toolbarTab.where.${bar}`, { side: sideShort(side) }) : t('layout.toolbarTab.where.none')}
        </p>
        <p className="layout-muted">{meta.description}</p>

        {def?.kind !== 'status' && bar === 'top' && phone && (
          <p className="layout-muted">{t('layout.toolbarTab.phoneIconsNote')}</p>
        )}
        {def?.kind !== 'status' && !(bar === 'top' && phone) && (
        <LayoutRadioGroup as="div" className="layout-field" aria-label={t('layout.toolbarTab.showAs')}>
          <span>{t('layout.toolbarTab.showAs')}</span>
          <button type="button" role="radio" aria-checked={!options.label}
            className={`layout-radio${!options.label ? ' is-on' : ''}`} onClick={() => setOptions({ label: undefined })}>
            {t('layout.toolbarTab.defaultMode', { mode: t(`layout.modes.${defaultMode}`) })}
          </button>
          <div className="layout-grid-2">
            {modes.map((m) => (
              <button key={m} type="button" role="radio" aria-checked={options.label === m}
                className={`layout-radio${options.label === m ? ' is-on' : ''}`} onClick={() => setOptions({ label: m })}>
                {t(`layout.modes.${m}`)}
              </button>
            ))}
          </div>
          {canShowNoHeading(sel, options) && <small>{t('layout.toolbarTab.noHeadingHint')}</small>}
        </LayoutRadioGroup>
        )}

        <div className="layout-field">
          <span>{t('layout.toolbarTab.placeOn')}</span>
          <LayoutRadioGroup as="span" className="layout-seg" aria-label={t('layout.toolbarTab.placeOn')}>
            {(['top', 'bottom', null] as const).map((where) => (
              <button key={String(where)} type="button" role="radio" aria-checked={bar === where}
                className={bar === where ? 'is-on' : ''}
                disabled={(where === null && state.bars.top.length === 1 && bar === 'top') || (where !== null && !canPlaceOn(sel, where))}
                title={where === 'top' && !canPlaceOn(sel, 'top') ? t('layout.toolbarTab.footerOnly') : undefined}
                onClick={() => setState(where ? placeToolbarItem(state, sel, where) : removeToolbarItem(state, sel))}>
                {where === 'top' ? t('layout.toolbarTab.onToolbar') : where === 'bottom' ? t('layout.toolbarTab.onFooter') : t('layout.toolbarTab.notPlaced')}
              </button>
            ))}
          </LayoutRadioGroup>
        </div>

        <div className="layout-field">
          <span>{t('layout.toolbarTab.side')}</span>
          <LayoutRadioGroup as="span" className="layout-seg" aria-label={t('layout.toolbarTab.side')}>
            {TOOLBAR_SIDES.map((s) => (
              <button key={s} type="button" role="radio" aria-checked={side === s} className={side === s ? 'is-on' : ''}
                onClick={() => setState(bar ? placeToolbarItem(state, sel, bar, { side: s }) : setToolbarItemOptions(state, sel, { side: s }))}>
                {sideShort(s)}
              </button>
            ))}
          </LayoutRadioGroup>
        </div>

        {def?.kind === 'zoom' && (
          <LayoutRadioGroup as="div" className="layout-field" aria-label={t('layout.toolbarTab.zoomControl')}>
            <span>{t('layout.toolbarTab.zoomControl')}</span>
            {(['buttons', 'slider', 'both'] as const).map((z) => (
              <button key={z} type="button" role="radio" aria-checked={effectiveZoomStyle(bar ?? 'bottom', options) === z}
                className={`layout-radio${effectiveZoomStyle(bar ?? 'bottom', options) === z ? ' is-on' : ''}`}
                onClick={() => setOptions({ zoomStyle: z })}>
                {t(`layout.toolbarTab.zoom${({ buttons: 'Buttons', slider: 'Slider', both: 'Both' } as const)[z]}`)}
              </button>
            ))}
            <small>{t('layout.toolbarTab.zoomHint')}</small>
          </LayoutRadioGroup>
        )}

        {def?.kind === 'layout' && (
          <>
            <div className="layout-field">
              <span>{t('layout.toolbarTab.switcherStyle')}</span>
              <LayoutRadioGroup as="span" className="layout-seg" aria-label={t('layout.toolbarTab.switcherStyle')}>
                {(['menu', 'buttons'] as const).map((style) => (
                  <button key={style} type="button" role="radio" aria-checked={(options.layoutStyle ?? 'menu') === style}
                    className={(options.layoutStyle ?? 'menu') === style ? 'is-on' : ''}
                    onClick={() => setOptions({ layoutStyle: style })}>
                    {style === 'menu' ? t('layout.toolbarTab.menu') : t('layout.toolbarTab.buttons')}
                  </button>
                ))}
              </LayoutRadioGroup>
            </div>
            <fieldset className="layout-field">
              <legend>{t('layout.toolbarTab.layoutsOffered')}</legend>
              {layoutChoices.map((choice) => (
                <label key={choice.id} className="layout-inline-check">
                  <input type="checkbox" checked={!hidden.has(choice.id)} onChange={() => {
                    const next = new Set(hidden);
                    if (next.has(choice.id)) next.delete(choice.id); else next.add(choice.id);
                    setOptions({ hiddenLayouts: [...next] });
                  }} />
                  {choice.label}
                </label>
              ))}
              <label className="layout-inline-check">
                <input type="checkbox" checked={options.editEntry !== false} onChange={() => setOptions({ editEntry: options.editEntry === false })} />
                {t('layout.toolbarTab.editEntry')}
              </label>
            </fieldset>
          </>
        )}
      </div>
    );
  };

  return (
    <DndContext sensors={sensors} collisionDetection={layoutCollision} onDragStart={onDragStart} onDragEnd={onDragEnd}
      onDragCancel={() => setDragging(null)} accessibility={{ announcements }}>
      <div className="bars-tab" {...focus}>
        <div className="bars-top">
          <div className="bars-presets" role="group" aria-label={t('layout.toolbarTab.presetsHeading')}>
            <span className="layout-muted">{t('layout.toolbarTab.presetsHeading')}</span>
            {TOOLBAR_PRESETS.map((preset) => (
              <button key={preset.id} type="button" aria-pressed={toolbarPreset === preset.id}
                className={`layout-pill${toolbarPreset === preset.id ? ' is-on' : ''}`}
                title={t(`layout.toolbarPresetHints.${preset.id as 'default'}`)}
                onClick={() => applyToolbarPreset(preset.id)}>
                {t(`layout.toolbarPresets.${preset.id as 'default'}`)}
              </button>
            ))}
            {savedToolbarLayouts.map((saved) => (
              <span key={saved.id} className={`layout-pill-group${toolbarPreset === saved.id ? ' is-on' : ''}`}>
                <button type="button" className="layout-pill" aria-pressed={toolbarPreset === saved.id}
                  onClick={() => applySavedToolbarLayout(saved.id)}>{saved.label}</button>
                <button type="button" className="layout-icon-btn" aria-label={t('layout.panelsTab.deleteNamed', { name: saved.label })}
                  onClick={() => deleteSavedToolbarLayout(saved.id)}><FaTrashAlt aria-hidden="true" /></button>
              </span>
            ))}
            {naming === null ? (
              <button type="button" data-layout-focus="save-bars" className="layout-link" onClick={() => setNaming('')}>{t('layout.toolbarTab.saveAs')}</button>
            ) : (
              <form data-layout-focus="save-bars" className="layout-inline-form" onSubmit={(e) => { e.preventDefault(); if (saveToolbarLayout(naming)) setNaming(null); }}>
                <input type="text" value={naming} maxLength={40} autoFocus aria-label={t('layout.toolbarTab.nameLabel')}
                  onChange={(e) => setNaming(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setNaming(null); } }} />
                <button type="submit" disabled={!naming.trim()}>{t('layout.panelsTab.save')}</button>
                <button type="button" onClick={() => setNaming(null)}>{t('layout.panelsTab.cancel')}</button>
              </form>
            )}
          </div>
          <div className="bars-defaults">
            {(phone ? ['bottom'] as const : ['top', 'bottom'] as const).map((bar) => (
              <span key={bar} className="bars-default">
                <span className="layout-muted">{bar === 'top' ? t('layout.toolbarTab.toolbarShows') : t('layout.toolbarTab.footerShows')}</span>
                <LayoutRadioGroup as="span" className="layout-seg" aria-label={bar === 'top' ? t('layout.toolbarTab.toolbarShows') : t('layout.toolbarTab.footerShows')}>
                  {BAR_MODES.map((m) => (
                    <button key={m} type="button" role="radio" aria-checked={state.labels[bar] === m}
                      className={state.labels[bar] === m ? 'is-on' : ''}
                      onClick={() => setState({ ...state, labels: { ...state.labels, [bar]: m } })}>
                      {t(`layout.modes.${m}`)}
                    </button>
                  ))}
                </LayoutRadioGroup>
              </span>
            ))}
          </div>
        </div>

        <div className="bars-preview" aria-label={t('layout.toolbarTab.preview')}>
          <span className="layout-muted">{t('layout.toolbarTab.preview')} · {t('layout.toolbarTab.previewHint')}</span>
          {renderPreviewBar('top')}
          <div className="bars-preview-page" aria-hidden="true" />
          {renderPreviewBar('bottom')}
        </div>

        <div className="bars-columns">
          {renderList('top')}
          {renderList('bottom')}
          <DropZone id="avail" as="section" className="bars-list bars-available" aria-label={t('layout.toolbarTab.available')}>
            <h3>{t('layout.toolbarTab.available')}</h3>
            <small className="layout-muted">{t('layout.toolbarTab.availableHint')}</small>
            <div className="bars-list-body">
              {availableGroups.map(({ g, ids }) => (
                <div key={g} className="bars-available-group">
                  <h4>{t(`layout.toolbarTab.groups.${g}`)}</h4>
                  {ids.map((id) => (
                    <AvailableRow key={id} id={id} selected={selected === id} onSelect={() => setSelected(id)}
                      onAdd={(bar) => { setState(placeToolbarItem(state, id, bar)); setSelected(id); }} />
                  ))}
                </div>
              ))}
            </div>
          </DropZone>
          <aside className="layout-settings" aria-label={t('layout.panelsTab.selected')}>
            <h3>{t('layout.panelsTab.selected')}</h3>
            {renderSettings()}
          </aside>
        </div>
        <p className="layout-muted layout-footnote">{t('layout.toolbarTab.foldNote')}</p>
      </div>
      <DragOverlay dropAnimation={null}>
        {dragging ? <div className="layout-drag-ghost">{nameOf(dragging)}</div> : null}
      </DragOverlay>
    </DndContext>
  );
};

export default BarsTab;
