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
import BarsTab from './layout/BarsTab';
import { useWorkspaceLayoutChoices } from './toolbar/toolbarMeta';
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
  const layouts = useWorkspaceLayoutChoices();
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
  const tabs = [
    { id: 'panels' as const, label: t('layout.tabs.panels') },
    { id: 'toolbar' as const, label: t('layout.tabs.toolbar') },
  ];
  const known = layouts.some((choice) => choice.id === workspacePreset);

  return (
    <ModalOverlay className="dialog-overlay layout-dialog-overlay" onClick={() => setLayoutDialog(null)} dialogLabel={t('layout.title')}>
      <div className="layout-dialog" onClick={(e) => e.stopPropagation()}>
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
                aria-selected={layoutDialog === tab.id}
                aria-controls={`layout-tabpanel-${tab.id}`}
                tabIndex={layoutDialog === tab.id ? 0 : -1}
                className={layoutDialog === tab.id ? 'is-on' : ''}
                onClick={() => setLayoutDialog(tab.id)}
                onKeyDown={(e) => {
                  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
                  e.preventDefault();
                  const next = tabs[(index + 1) % tabs.length];
                  setLayoutDialog(next.id);
                  tabRefs.current[next.id]?.focus();
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <span className="layout-dialog-spacer" />
          <label className="layout-quick-switch">
            <span>{t('layout.quickSwitch')}</span>
            <select value={known ? workspacePreset : 'custom'} onChange={(e) => { if (e.target.value !== 'custom') applyWorkspacePreset(e.target.value); }}>
              {!known && <option value="custom">{t('layout.presets.custom')}</option>}
              {layouts.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
            </select>
          </label>
          <button type="button" className="layout-icon-btn layout-dialog-close" aria-label={t('layout.close')} onClick={() => setLayoutDialog(null)}>
            <FaTimes aria-hidden="true" />
          </button>
        </div>

        <div className="layout-dialog-body" role="tabpanel" id={`layout-tabpanel-${layoutDialog}`} aria-labelledby={`layout-tab-${layoutDialog}`}>
          {layoutDialog === 'panels'
            ? <PanelsTab layout={workspaceLayout} setLayout={setWorkspaceLayout} />
            : <BarsTab state={toolbarLayout} setState={setToolbarLayout} />}
        </div>

        <div className="layout-dialog-footer">
          {layoutDialog === 'panels' ? (
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
