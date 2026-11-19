/**
 * Views: one menu for the page layout, the view that owns the writing area,
 * the panels and the workspace layout (from PR #217).
 *
 * Index Cards, the Beat Board and the Outline each take the whole screen, so
 * they are a radio group: only one can be up at a time. Panels sit alongside
 * whichever view is up, so they are checkboxes.
 *
 * Each copy (on the bar, in the overflow menu) is its own component with its
 * own ref, so closing on an outside click works for whichever copy is open.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FaCaretDown, FaColumns } from 'react-icons/fa';
import { useEditorFields } from '../../stores/editorStore';
import { currentMainView, setMainView, togglePanel, usePanelOpen, type MainView } from '../../utils/panelActions';
import { NAVIGATOR_PANELS, isNavigatorPanel, layoutPanels } from '../../utils/workspaceLayout';
import type { ToolbarLabelMode } from '../../utils/toolbarLayout';
import { panelIcon, usePanelLabel, useWorkspaceLayoutChoices } from './toolbarMeta';
import { useWorkspaceDocksAvailable } from '../../hooks/useWorkspaceDocks';


function PanelCheck({ panel, label, onDone, onToggle }: { panel: string; label: string; onDone: () => void; onToggle?: () => void }) {
  const open = usePanelOpen(panel);
  return (
    <label className="toolbar-views-option">
      <input type="checkbox" checked={open} onChange={() => { (onToggle ?? (() => togglePanel(panel)))(); onDone(); }} />
      <span className="toolbar-views-icon">{panelIcon(panel)}</span>
      {label}
    </label>
  );
}

interface Props {
  label: ToolbarLabelMode;
  inOverflow?: boolean;
}

const ViewsMenu: React.FC<Props> = ({ label, inOverflow = false }) => {
  const { t } = useTranslation(['toolbar', 'menu', 'story']);
  const {
    viewLayout, setViewLayout, indexCardsOpen, beatBoardOpen, outlineOpen,
    workspaceLayout, workspacePreset, applyWorkspacePreset, setLayoutDialog, toggleNavigator,
  } = useEditorFields(
    'viewLayout', 'setViewLayout', 'indexCardsOpen', 'beatBoardOpen', 'outlineOpen',
    'workspaceLayout', 'workspacePreset', 'applyWorkspacePreset', 'setLayoutDialog', 'toggleNavigator',
  );
  const panelLabel = usePanelLabel();
  const layouts = useWorkspaceLayoutChoices();
  const docksAvailable = useWorkspaceDocksAvailable();
  const [open, setOpen] = useState(false);
  const [align, setAlign] = useState<'start' | 'end'>('end');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      ref.current?.querySelector<HTMLButtonElement>('.toolbar-views-btn')?.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const close = () => setOpen(false);
  const mainView = currentMainView({ indexCardsOpen, beatBoardOpen, outlineOpen });
  const views: { id: MainView; label: string }[] = [
    { id: 'script', label: t('toolbar:layout.views.script') },
    { id: 'index-cards', label: t('menu:view.indexCards') },
    { id: 'beat-board', label: t('menu:view.beatBoard') },
    { id: 'outline', label: t('menu:view.outline') },
  ];
  // The Navigator's panels share one switch; the others are listed one by one.
  const placed = layoutPanels(workspaceLayout).filter((p) => !workspaceLayout.hidden.includes(p));
  const toolPanels = placed.filter((p) => !isNavigatorPanel(p) && p !== 'add-ons');
  const navigatorPlaced = NAVIGATOR_PANELS.some((p) => placed.includes(p));
  const firstNavigatorPanel = NAVIGATOR_PANELS.find((p) => placed.includes(p));
  const showIcon = label !== 'text';
  const showText = label === 'text' || label === 'both';
  const name = `toolbar-views${inOverflow ? '-overflow' : ''}`;

  return (
    <div className="toolbar-group toolbar-views-wrap" ref={ref}>
      <button
        type="button"
        className={`toolbar-btn toolbar-views-btn${open ? ' active' : ''}`}
        title={t('toolbar:layout.items.views.description')}
        aria-label={showText ? undefined : t('toolbar:layout.items.views.label')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          if (open) { close(); return; }
          if (!inOverflow) {
            const rect = e.currentTarget.getBoundingClientRect();
            setAlign(window.innerWidth - rect.left >= 260 ? 'start' : 'end');
          }
          setOpen(true);
        }}
      >
        {showIcon && <FaColumns />}
        {showText && <span className="toolbar-btn-label">{t('toolbar:layout.items.views.label')}</span>}
        <FaCaretDown />
      </button>
      {open && (
        <div className={`toolbar-views-menu toolbar-views-menu-${inOverflow ? 'end' : align}`} role="menu" aria-label={t('toolbar:layout.items.views.label')}>
          <div className="toolbar-views-heading">{t('menu:view.layout')}</div>
          {(['page', 'phone'] as const).map((id) => (
            <label className="toolbar-views-option" key={id}>
              <input type="radio" name={`${name}-page`} checked={viewLayout === id} onChange={() => { setViewLayout(id); close(); }} />
              {t(`menu:view.${id}`)}
            </label>
          ))}

          <div className="toolbar-views-sep" />
          <div className="toolbar-views-heading">{t('toolbar:layout.views.view')}</div>
          {views.map((view) => (
            <label className="toolbar-views-option" key={view.id}>
              <input type="radio" name={`${name}-main`} checked={mainView === view.id} onChange={() => { setMainView(view.id); close(); }} />
              {view.label}
            </label>
          ))}

          <div className="toolbar-views-sep" />
          <div className="toolbar-views-heading">{t('menu:view.panels')}</div>
          {navigatorPlaced && firstNavigatorPanel && (
            <PanelCheck panel={firstNavigatorPanel} label={t('menu:view.navigator')} onDone={close} onToggle={toggleNavigator} />
          )}
          {toolPanels.map((panel) => <PanelCheck key={panel} panel={panel} label={panelLabel(panel)} onDone={close} />)}

          {/* Panel layouts only where the docks exist (useWorkspaceDocks). */}
          {docksAvailable && (
            <>
              <div className="toolbar-views-sep" />
              <div className="toolbar-views-heading">{t('toolbar:layout.items.layout.label')}</div>
              {layouts.map((choice) => (
                <label className="toolbar-views-option" key={choice.id}>
                  <input type="radio" name={`${name}-layout`} checked={workspacePreset === choice.id}
                    onChange={() => { applyWorkspacePreset(choice.id); close(); }} />
                  {choice.label}
                </label>
              ))}
              <button type="button" className="toolbar-views-action" onClick={() => { setLayoutDialog('panels'); close(); }}>
                {t('toolbar:layout.editLayouts')}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default ViewsMenu;
