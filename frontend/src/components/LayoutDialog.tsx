/**
 * View › Layout… — where the panels go, and what the toolbar and footer show
 * (Discussion #273, building on the Customise Toolbar dialog of PR #217).
 *
 * Changes apply as they are made, so the workspace behind the dialog is the
 * preview; Done closes it. The header keeps a quick layout switch on both tabs.
 */
import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { FaTimes } from 'react-icons/fa';
import { useEditorFields } from '../stores/editorStore';
import { ModalOverlay } from './ModalOverlay';
import PanelsTab from './layout/PanelsTab';
import { useLayoutFocus } from './layout/useLayoutFocus';
import { focusableElements } from '../utils/modalAccessibility';
import BarsTab from './layout/BarsTab';
import { useWorkspaceLayoutChoices } from './toolbar/toolbarMeta';
import { useWorkspaceDocksAvailable } from '../hooks/useWorkspaceDocks';
import '../styles/workspaceLayout.css';

const LayoutDialog: React.FC = () => {
  const { t } = useTranslation('toolbar');
  const {
    layoutDialog, setLayoutDialog, workspaceLayout, setWorkspaceLayout, workspacePreset, applyWorkspacePreset,
    toolbarLayout, setToolbarLayout, applyToolbarPreset,
  } = useEditorFields(
    'layoutDialog', 'setLayoutDialog', 'workspaceLayout', 'setWorkspaceLayout', 'workspacePreset', 'applyWorkspacePreset',
    'toolbarLayout', 'setToolbarLayout', 'applyToolbarPreset',
  );
  const focus = useLayoutFocus(!!layoutDialog);
  const layouts = useWorkspaceLayoutChoices();
  // On a phone or narrow window the panels are overlays, not docks, so the
  // Panels tab and the layout switch would change nothing: only the bars.
  const docksAvailable = useWorkspaceDocksAvailable();
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    if (!layoutDialog) return;
    const onKey = (e: KeyboardEvent) => {
      // A drag in progress takes Escape first (dnd-kit cancels it).
      if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('.layout-drag-ghost')) {
        e.preventDefault();
        setLayoutDialog(null);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [layoutDialog, setLayoutDialog]);

  if (!layoutDialog) return null;
  const activeTab = docksAvailable ? layoutDialog : 'toolbar';
  const tabs = [
    ...(docksAvailable ? [{ id: 'panels' as const, label: t('layout.tabs.panels') }] : []),
    { id: 'toolbar' as const, label: t('layout.tabs.toolbar') },
  ];
  const known = layouts.some((choice) => choice.id === workspacePreset);

  return (
    <ModalOverlay className="dialog-overlay layout-dialog-overlay" onClick={() => setLayoutDialog(null)} dialogLabel={t('layout.title')}>
      <div className="layout-dialog" {...focus} onClick={(e) => e.stopPropagation()}
        onKeyDownCapture={(e) => {
          // Let dnd-kit's document listener cancel the drag before the modal
          // handles Escape. Do not stop propagation: the sensor needs the key.
          if (e.key === 'Escape' && document.querySelector('.layout-drag-ghost')) e.preventDefault();
        }}>
        <div className="layout-dialog-header">
          <h2 className="dialog-header">{t('layout.title')}</h2>
          <div className="layout-dialog-tabs" role="tablist" aria-label={t('layout.title')}>
            {tabs.map((tab, index) => (
              <button
                key={tab.id}
                ref={(el) => { tabRefs.current[tab.id] = el; }}
                type="button"
                role="tab"
                id={`layout-tab-${tab.id}`}
                aria-selected={activeTab === tab.id}
                aria-controls={`layout-tabpanel-${tab.id}`}
                tabIndex={activeTab === tab.id ? 0 : -1}
                className={activeTab === tab.id ? 'is-on' : ''}
                onClick={() => setLayoutDialog(tab.id)}
                onKeyDown={(e) => {
                  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
                  e.preventDefault();
                  const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
                  const delta = (e.key === 'ArrowRight' ? 1 : -1) * (rtl ? -1 : 1);
                  const next = tabs[e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (index + delta + tabs.length) % tabs.length];
                  setLayoutDialog(next.id);
                  tabRefs.current[next.id]?.focus();
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <span className="layout-dialog-spacer" />
          {docksAvailable && (
            <label className="layout-quick-switch">
              <span>{t('layout.quickSwitch')}</span>
              <select value={known ? workspacePreset : 'custom'} onChange={(e) => { if (e.target.value !== 'custom') applyWorkspacePreset(e.target.value); }}>
                {!known && <option value="custom">{t('layout.presets.custom')}</option>}
                {layouts.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
              </select>
            </label>
          )}
          <button type="button" className="layout-icon-btn layout-dialog-close" aria-label={t('layout.close')} onClick={() => setLayoutDialog(null)}>
            <FaTimes aria-hidden="true" />
          </button>
        </div>

        {tabs.map(tab => (
          <div key={tab.id} className="layout-dialog-body" role="tabpanel" id={`layout-tabpanel-${tab.id}`}
            aria-labelledby={`layout-tab-${tab.id}`} hidden={tab.id !== activeTab} tabIndex={-1}
            onKeyDown={event => {
              if (event.key !== 'Tab' || event.target !== event.currentTarget) return;
              const target = event.shiftKey
                ? tabRefs.current[tab.id]
                : focusableElements(event.currentTarget)[0] ?? tabRefs.current[tab.id];
              if (target) {
                event.preventDefault();
                target.focus();
              }
            }}>
            {tab.id === activeTab && (tab.id === 'panels'
              ? <PanelsTab layout={workspaceLayout} setLayout={setWorkspaceLayout} />
              : <BarsTab state={toolbarLayout} setState={setToolbarLayout} />)}
          </div>
        ))}

        <div className="layout-dialog-footer">
          {activeTab === 'panels' ? (
            <button type="button" className="layout-link" onClick={() => applyWorkspacePreset('classic')}>{t('layout.panelsTab.reset')}</button>
          ) : (
            <button type="button" className="layout-link" onClick={() => applyToolbarPreset('default')}>{t('layout.toolbarTab.reset')}</button>
          )}
          <span className="layout-dialog-spacer" />
          <button type="button" className="dialog-primary" onClick={() => setLayoutDialog(null)}>{t('layout.done')}</button>
        </div>
      </div>
    </ModalOverlay>
  );
};

export default LayoutDialog;
