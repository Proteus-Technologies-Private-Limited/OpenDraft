/**
 * Moving panels into windows of their own, from a button in each panel.
 *
 * - `PanelPlaceContext` (panelPlace.ts) says where a panel is drawn: in a dock
 *   (it can pop out), in a panel window (it can go back or move on), or
 *   elsewhere (phones, the fold layout, history mode — no button).
 * - `PanelPopoutButton` is that button, for a panel's header. With nowhere
 *   else to go it acts at once; once other panel windows are open it offers a
 *   short menu: a new window, or one of the open windows to join as a tab.
 * - `PanelWindows` renders every panel window from the editor's own tree, so
 *   each panel is the same live panel it was in the dock. A window with
 *   several panels shows them as tabs, like a dock's tab group.
 *
 * See panelPopoutStore.ts for how the windows are opened, and
 * docs/panel-windows.md for the design.
 */
import React, { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { FaExternalLinkAlt, FaWindowRestore } from 'react-icons/fa';
import { canPopOutPanels, refreshPanelDisplays, usePanelPopoutStore } from '../stores/panelPopoutStore';
import { useEditorStore } from '../stores/editorStore';
import { isTauri } from '../services/platform';
import { isNavigatorPanel, type NavigatorPanelId } from '../utils/workspaceLayout';
import { panelIcon, usePanelLabel } from './toolbar/toolbarMeta';
import { showToast } from './Toast';
import { PanelPlaceContext, panelWindowName, panelWindowTitle } from './panelPlace';
import type { NavigatorRender } from './WorkspaceDock';
import '../styles/panelPopout.css';

interface PlaceChoice {
  key: string;
  label: string;
  /** `from`: the window the choice was made in. */
  run: (from: Window | null) => void;
}

/** Pop a panel out from its dock, or, in a panel window, send it back or on. */
export const PanelPopoutButton: React.FC<{ panel: string; className?: string }> = ({ panel, className }) => {
  const { t } = useTranslation('story');
  const place = useContext(PanelPlaceContext);
  const panelLabel = usePanelLabel();
  const windows = usePanelPopoutStore((s) => s.windows);
  const popOut = usePanelPopoutStore((s) => s.popOut);
  const addToWindow = usePanelPopoutStore((s) => s.addToWindow);
  const returnToDock = usePanelPopoutStore((s) => s.returnToDock);
  // The open menu's button (null: closed). Kept in state: the menu is placed
  // against it, in its own window.
  const [menuAnchor, setMenuAnchor] = useState<HTMLButtonElement | null>(null);
  const closeMenu = useCallback(() => setMenuAnchor(null), []);
  if (place.where === 'none' || !canPopOutPanels()) return null;

  const name = panelLabel(panel);
  const here = place.where === 'window' ? place.windowId : null;
  const openNew = (from: Window | null) => {
    // Synchronously, inside the click: a browser blocks a window opened later.
    const title = panelWindowTitle(name, useEditorStore.getState().documentTitle || '');
    if (!popOut(panel, title, from)) {
      showToast(isTauri() ? t('popout.failed') : `${t('popout.failed')} ${t('popout.popupsHint')}`, 'error');
    }
  };
  const choices: PlaceChoice[] = [];
  if (here) choices.push({ key: 'return', label: t('popout.returnPanel', { panel: name }), run: () => returnToDock(panel) });
  if (!here || (windows[here]?.panels.length ?? 0) > 1) {
    choices.push({ key: 'new', label: t('popout.movePanel', { panel: name }), run: openNew });
  }
  for (const [id, entry] of Object.entries(windows)) {
    if (id === here || entry.window.closed) continue;
    choices.push({
      key: id,
      label: t('popout.addTo', { window: panelWindowName(entry.panels, panelLabel) }),
      run: () => addToWindow(panel, id, panelWindowTitle(name, useEditorStore.getState().documentTitle || '')),
    });
  }

  const label = choices.length === 1 ? choices[0].label : t('popout.moveMenu', { panel: name });
  return (
    <>
      <button
        type="button"
        className={className}
        data-panel-popout={here ? 'return' : 'open'}
        title={label}
        aria-label={label}
        aria-haspopup={choices.length > 1 ? 'menu' : undefined}
        aria-expanded={choices.length > 1 ? !!menuAnchor : undefined}
        onClick={(event) => {
          const from = event.currentTarget.ownerDocument.defaultView;
          if (choices.length === 1) { choices[0].run(from); return; }
          const button = event.currentTarget;
          setMenuAnchor((open) => (open ? null : button));
        }}
      >
        {here ? <FaWindowRestore aria-hidden="true" /> : <FaExternalLinkAlt aria-hidden="true" />}
      </button>
      {menuAnchor && choices.length > 1 && (
        <PanelPlaceMenu anchor={menuAnchor} choices={choices} label={label} onClose={closeMenu} />
      )}
    </>
  );
};

/** The choices, under the button, in the button's own window. */
const PanelPlaceMenu: React.FC<{ anchor: HTMLButtonElement; choices: PlaceChoice[]; label: string; onClose: () => void }> = ({
  anchor, choices, label, onClose,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const doc = anchor.ownerDocument;
  const view = doc.defaultView ?? window;
  const [position, setPosition] = useState<React.CSSProperties>({ visibility: 'hidden' });

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const rect = anchor.getBoundingClientRect();
    const width = menu.offsetWidth;
    const left = Math.max(4, Math.min(rect.right - width, view.innerWidth - width - 4));
    const below = rect.bottom + 4;
    const top = below + menu.offsetHeight > view.innerHeight - 4 ? Math.max(4, rect.top - menu.offsetHeight - 4) : below;
    setPosition({ left, top });
    menu.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [anchor, view]);

  useEffect(() => {
    const away = (event: Event) => {
      const target = event.target as Node | null;
      if (target && (menuRef.current?.contains(target) || anchor.contains(target))) return;
      onClose();
    };
    doc.addEventListener('mousedown', away, true);
    view.addEventListener('blur', onClose);
    view.addEventListener('resize', onClose);
    return () => {
      doc.removeEventListener('mousedown', away, true);
      view.removeEventListener('blur', onClose);
      view.removeEventListener('resize', onClose);
    };
  }, [doc, view, anchor, onClose]);

  const items = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
  return createPortal(
    <div
      ref={menuRef}
      className="panel-place-menu"
      role="menu"
      aria-label={label}
      style={{ position: 'fixed', ...position }}
      onKeyDown={(event) => {
        const list = items();
        const index = list.indexOf(doc.activeElement as HTMLElement);
        const next = event.key === 'ArrowDown' ? (index + 1) % list.length
          : event.key === 'ArrowUp' ? (index - 1 + list.length) % list.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? list.length - 1 : -1;
        if (next >= 0) { event.preventDefault(); list[next]?.focus(); return; }
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); anchor.focus(); return; }
        if (event.key === 'Tab') onClose();
      }}
    >
      {choices.map((choice) => (
        <button
          key={choice.key}
          type="button"
          role="menuitem"
          tabIndex={-1}
          className="panel-place-menu__item"
          data-panel-place={choice.key === 'return' || choice.key === 'new' ? choice.key : 'add'}
          onClick={() => {
            onClose();
            choice.run(view);
          }}
        >
          {choice.label}
        </button>
      ))}
    </div>,
    doc.body,
  );
};

interface PanelWindowsProps {
  /** Whether a panel is open at all; a closed panel leaves its window. */
  isOpen: (panel: string) => boolean;
  /** A panel other than a Navigator tab, drawn full width. */
  render: (panel: string) => React.ReactNode;
  /** The Navigator, showing these tabs. */
  renderNavigator: (args: NavigatorRender) => React.ReactNode;
  /** False where panels have no dock to come from (fold layout, history). */
  enabled: boolean;
}

export const PanelWindows: React.FC<PanelWindowsProps> = ({ isOpen, render, renderNavigator, enabled }) => {
  const windows = usePanelPopoutStore((s) => s.windows);
  const placed = usePanelPopoutStore((s) => s.placed);
  const returnToDock = usePanelPopoutStore((s) => s.returnToDock);
  const returnAll = usePanelPopoutStore((s) => s.returnAll);
  const documentTitle = useEditorStore((s) => s.documentTitle);
  const panelLabel = usePanelLabel();

  useEffect(() => {
    void refreshPanelDisplays();
    const refresh = () => { void refreshPanelDisplays(); };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);

  // The editor leaving (another screen, signing out) takes its windows with it.
  useEffect(() => () => returnAll(), [returnAll]);

  useEffect(() => {
    if (!enabled) { returnAll(); return; }
    for (const panel of Object.keys(placed)) {
      if (!isOpen(panel)) returnToDock(panel);
    }
  });

  useEffect(() => {
    for (const entry of Object.values(windows)) {
      try {
        if (!entry.window.closed) entry.window.document.title = panelWindowTitle(panelLabel(entry.active), documentTitle || '');
      } catch (error) {
        console.warn('[panels] Could not retitle the panel window:', error);
      }
    }
  }, [windows, documentTitle, panelLabel]);

  if (!enabled) return null;
  return (
    <>
      {Object.entries(windows).map(([id, entry]) => {
        const showing = entry.panels.filter(isOpen);
        if (!showing.length) return null;
        const active = showing.includes(entry.active) ? entry.active : showing[0];
        return createPortal(
          <PanelPlaceContext.Provider value={{ where: 'window', windowId: id }}>
            <PanelWindowContent windowId={id} showing={showing} active={active}
              render={render} renderNavigator={renderNavigator} />
          </PanelPlaceContext.Provider>,
          entry.root,
          id,
        );
      })}
    </>
  );
};

/** One window's panels: one panel as it is; Navigator tabs as one Navigator;
 * anything else as tabs, every one kept mounted (a Table Read keeps playing
 * behind another tab). */
const PanelWindowContent: React.FC<{
  windowId: string;
  showing: string[];
  active: string;
  render: (panel: string) => React.ReactNode;
  renderNavigator: (args: NavigatorRender) => React.ReactNode;
}> = ({ windowId, showing, active, render, renderNavigator }) => {
  const { t } = useTranslation('story');
  const panelLabel = usePanelLabel();
  const showPanel = usePanelPopoutStore((s) => s.showPanel);

  if (showing.every(isNavigatorPanel)) {
    return (
      <PanelWindowBoundary panel={active}>
        <div className="panel-window" data-panel={active}>
          {renderNavigator({
            tabs: showing as NavigatorPanelId[],
            activeTab: isNavigatorPanel(active) ? active : undefined,
            onTabChange: (tab) => showPanel(tab),
            width: undefined,
          })}
        </div>
      </PanelWindowBoundary>
    );
  }
  if (showing.length === 1) {
    return (
      <PanelWindowBoundary panel={active}>
        <div className="panel-window" data-panel={active}>{render(active)}</div>
      </PanelWindowBoundary>
    );
  }
  const tabId = (panel: string) => `panel-window-tab-${windowId}-${panel}`;
  return (
    <div className="panel-window-group">
      <div className="dock-tab-bar">
        <div className="dock-tab-strip" role="tablist" aria-label={t('popout.windowTabs')}>
          {showing.map((panel) => (
            <button
              key={panel}
              type="button"
              role="tab"
              id={tabId(panel)}
              aria-selected={panel === active}
              aria-controls={`${tabId(panel)}-panel`}
              tabIndex={panel === active ? 0 : -1}
              className={`dock-tab${panel === active ? ' active' : ''}`}
              onClick={() => showPanel(panel)}
              onKeyDown={(event) => {
                const index = showing.indexOf(panel);
                const step = getComputedStyle(event.currentTarget).direction === 'rtl' ? -1 : 1;
                const next = event.key === 'ArrowRight' ? (index + step + showing.length) % showing.length
                  : event.key === 'ArrowLeft' ? (index - step + showing.length) % showing.length
                  : event.key === 'Home' ? 0 : event.key === 'End' ? showing.length - 1 : -1;
                if (next < 0) return;
                event.preventDefault();
                showPanel(showing[next]);
                event.currentTarget.ownerDocument.getElementById(tabId(showing[next]))?.focus();
              }}
            >
              <span aria-hidden="true" className="dock-tab-icon">{panelIcon(panel)}</span>
              {panelLabel(panel)}
            </button>
          ))}
        </div>
        {/* A bare Navigator tab has no header of its own to hold this. */}
        {isNavigatorPanel(active) && <PanelPopoutButton panel={active} className="dock-tab dock-tab-popout" />}
      </div>
      {showing.map((panel) => (
        <div key={panel} className="dock-tab-panel panel-window" role="tabpanel" id={`${tabId(panel)}-panel`}
          aria-labelledby={tabId(panel)} hidden={panel !== active} data-panel={panel}>
          <PanelWindowBoundary panel={panel}>
            {isNavigatorPanel(panel)
              ? renderNavigator({ tabs: [panel], activeTab: panel, bare: true, width: undefined })
              : render(panel)}
          </PanelWindowBoundary>
        </div>
      ))}
    </div>
  );
};

/** A panel that fails in its window says so there, rather than taking the
 * editor window down with it. */
class PanelWindowBoundary extends React.Component<{ panel: string; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(`[panels] The ${this.props.panel} panel failed in its window:`, error);
  }

  render() {
    if (this.state.failed) return <PanelWindowFailed panel={this.props.panel} />;
    return this.props.children;
  }
}

const PanelWindowFailed: React.FC<{ panel: string }> = ({ panel }) => {
  const { t } = useTranslation('story');
  const returnToDock = usePanelPopoutStore((s) => s.returnToDock);
  return (
    <div className="panel-window panel-window-failed" role="alert">
      <p>{t('popout.panelFailed')}</p>
      <button type="button" onClick={() => returnToDock(panel)}>{t('popout.return')}</button>
    </div>
  );
};
