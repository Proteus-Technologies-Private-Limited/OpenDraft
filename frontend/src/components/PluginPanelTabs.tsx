/**
 * Right-sidebar tab strip for plugin-registered panels.
 *
 * Replaces the previous stack-them-all rendering: each plugin panel
 * becomes a vertical tab. Clicking a tab activates that panel; clicking
 * the close button (or the active tab again) collapses back to the
 * strip alone. Built-in panels (Script Notes, Characters, Tags,
 * Locations) keep their existing toggle behaviour and render alongside.
 *
 * Plugins can request that their own tab open programmatically by
 * dispatching a CustomEvent:
 *
 *   document.dispatchEvent(
 *     new CustomEvent('plugin-panel:open', {
 *       detail: { panelId: 'my-panel-id' },
 *     }),
 *   );
 *
 * This lets a plugin's own menu item or keyboard shortcut bring its
 * panel to the front without reaching into this component's state.
 */

import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { panelResize } from '../utils/panelResize';
import { useTranslation } from 'react-i18next';
import type { Editor } from '@tiptap/react';

import { pluginRegistry, resolvePluginText, type PluginPanelEntry } from '../plugins/registry';
import './PluginPanelTabs.css';
import { useEditorTransactions } from '../hooks/useEditorTransactions';

export const PLUGIN_PANEL_OPEN_EVENT = 'plugin-panel:open';
export const PLUGIN_PANEL_CLOSE_EVENT = 'plugin-panel:close';

export interface ActivePluginPanel {
  id: string;
  label: string;
  activation: number;
}

interface Props {
  editor: Editor | null;
  width: number;
  onActiveChange?: (panel: ActivePluginPanel | null) => void;
  /** Optional drag-to-resize handler. When provided, a vertical handle
   *  is rendered on the LEFT edge of the active panel content so the
   *  user can resize the right sidebar by dragging — same UX as the
   *  built-in panels (Script Notes, etc.). Wire this to the editor's
   *  `handleResizePointerDown('right', e)` so the same `rightPanelWidth`
   *  state drives both the built-in and plugin panels. */
  onResizeKeyboard?: (width: number) => void;
  onResizePointerDown?: (e: React.PointerEvent) => void;
}

export const PluginPanelTabs: React.FC<Props> = ({
  editor,
  width,
  onResizePointerDown,
  onResizeKeyboard,
  onActiveChange,
}) => {
  const { t } = useTranslation('menu');
  const panelPrefix = useId();
  const tabId = (id: string) => `${panelPrefix}-tab-${id}`;
  const contentId = (id: string) => `${panelPrefix}-panel-${id}`;
  const [panels, setPanels] = useState<PluginPanelEntry[]>(() =>
    pluginRegistry.getPanels('right-sidebar'),
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activation, setActivation] = useState(0);
  const pendingFocus = useRef<{ lost: HTMLElement; target: string | null } | null>(null);
  useEditorTransactions(editor, activeId !== null);

  // Track the registry so panels appear and disappear as plugins come and
  // go. Plugins usually register at boot, but a lazy loader can register
  // well after this mounts, and anything registered between the useState
  // initializer above and this effect would otherwise be missed — hence
  // the immediate sync before subscribing.
  useEffect(() => {
    const sync = () => {
      const next = pluginRegistry.getPanels('right-sidebar');
      const focused = document.activeElement as HTMLElement | null;
      const owner = focused?.closest<HTMLElement>('[data-plugin-panel]');
      const removed = owner?.dataset.pluginPanel;
      if (removed && !next.some(panel => panel.id === removed)) {
        const previous = Array.from(document.querySelectorAll<HTMLElement>('[role="tab"][data-plugin-panel]'));
        const target = next[Math.min(previous.findIndex(panel => panel.dataset.pluginPanel === removed), next.length - 1)] ?? next[0];
        pendingFocus.current = { lost: focused!, target: target?.id ?? null };
      }
      setPanels(next);
      setActiveId(current => current && !next.some(panel => panel.id === current) ? null : current);
    };
    sync();
    return pluginRegistry.subscribe(sync);
  }, [panelPrefix]);

  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    pendingFocus.current = null;
    if (!pending.lost.isConnected && document.activeElement === document.body) {
      const target = pending.target ? document.getElementById(`${panelPrefix}-tab-${pending.target}`)
        : document.querySelector<HTMLElement>('[role="textbox"][contenteditable="true"]');
      target?.focus({ preventScroll: true });
    }
  }, [panels, panelPrefix]);

  // Listen for external open/close requests from plugins.
  useEffect(() => {
    const openHandler = (e: Event) => {
      const detail = (e as CustomEvent<{ panelId?: string }>).detail;
      const id = detail?.panelId;
      if (id && pluginRegistry.getPanels('right-sidebar').some((p) => p.id === id)) {
        setActiveId(id);
        setActivation(value => value + 1);
      }
    };
    const closeHandler = () => {
      const content = document.activeElement?.closest<HTMLElement>('.plugin-panel-tabs__content');
      const tab = content?.getAttribute('aria-labelledby');
      if (tab) document.getElementById(tab)?.focus();
      setActiveId(null);
    };
    document.addEventListener(PLUGIN_PANEL_OPEN_EVENT, openHandler);
    document.addEventListener(PLUGIN_PANEL_CLOSE_EVENT, closeHandler);
    return () => {
      document.removeEventListener(PLUGIN_PANEL_OPEN_EVENT, openHandler);
      document.removeEventListener(PLUGIN_PANEL_CLOSE_EVENT, closeHandler);
    };
  }, []);

  useEffect(() => {
    const active = panels.find(p => p.id === activeId);
    onActiveChange?.(active ? { id: active.id, label: resolvePluginText(active.labelKey, active.label), activation } : null);
  }, [activeId, panels, activation, onActiveChange]);

  if (panels.length === 0) return null;

  const active = activeId ? panels.find((p) => p.id === activeId) ?? null : null;
  const panelLabel = (p: PluginPanelEntry) => resolvePluginText(p.labelKey, p.label);

  return (
    <>
      {panels.filter(panel => panel.id !== active?.id).map(panel => (
        <div key={panel.id} id={contentId(panel.id)} role="tabpanel" aria-labelledby={tabId(panel.id)} hidden />
      ))}
      {active && (
        <div
          className="plugin-panel-tabs__content" data-plugin-panel={active.id}
          id={contentId(active.id)} role="tabpanel" aria-labelledby={tabId(active.id)} tabIndex={0}
          style={{ width, minWidth: width }}
        >
          {onResizePointerDown && (
            <div
              className="plugin-panel-tabs__resize"
              onPointerDown={onResizePointerDown}
              style={{ touchAction: 'none' }}
              aria-label={t('pluginPanels.resize')}
              role="separator" aria-orientation="vertical"
              tabIndex={onResizeKeyboard ? 0 : undefined}
              aria-valuenow={onResizeKeyboard ? width : undefined}
              aria-valuemin={onResizeKeyboard ? 200 : undefined} aria-valuemax={onResizeKeyboard ? 600 : undefined}
              onKeyDown={event => {
                if (!onResizeKeyboard) return;
                const next = panelResize(width, event.key, 'right', getComputedStyle(event.currentTarget).direction === 'rtl');
                if (next !== null) { event.preventDefault(); onResizeKeyboard(Math.max(200, Math.min(600, next))); }
              }}
            />
          )}
          <button
            className="plugin-panel-tabs__close"
            onClick={() => { document.getElementById(tabId(active.id))?.focus(); setActiveId(null); }}
            aria-label={t('pluginPanels.closeNamed', { name: panelLabel(active) })}
            title={t('pluginPanels.close')}
            type="button"
          >
            ×
          </button>
          <active.component key={active.id} editor={editor} />
        </div>
      )}
      <nav className="plugin-panel-tabs__strip" role="tablist" aria-orientation="vertical" aria-label={t('pluginPanels.tabs')}>
        {panels.map((p) => {
          const isActive = p.id === activeId;
          return (
            <button
              key={p.id} data-plugin-panel={p.id}
              role="tab"
              id={tabId(p.id)} aria-controls={contentId(p.id)}
              tabIndex={isActive || (!active && p === panels[0]) ? 0 : -1}
              aria-selected={isActive}
              className={
                'plugin-panel-tabs__tab' +
                (isActive ? ' plugin-panel-tabs__tab--active' : '')
              }
              onClick={() => { setActiveId(isActive ? null : p.id); setActivation(value => value + 1); }}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault(); setActiveId(p.id); setActivation(value => value + 1); return;
                }
                const index = panels.findIndex(panel => panel.id === p.id);
                const next = event.key === 'ArrowDown' ? (index + 1) % panels.length
                  : event.key === 'ArrowUp' ? (index + panels.length - 1) % panels.length
                  : event.key === 'Home' ? 0 : event.key === 'End' ? panels.length - 1 : -1;
                if (next < 0) return;
                event.preventDefault();
                setActiveId(panels[next].id);
                setActivation(value => value + 1);
                document.getElementById(tabId(panels[next].id))?.focus();
              }}
              title={panelLabel(p)}
              type="button"
            >
              <span className="plugin-panel-tabs__tab-label">{panelLabel(p)}</span>
            </button>
          );
        })}
      </nav>
    </>
  );
};
