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

import React, { useEffect, useState } from 'react';

import { pluginRegistry, type PluginPanelEntry } from '../plugins/registry';
import './PluginPanelTabs.css';

export const PLUGIN_PANEL_OPEN_EVENT = 'plugin-panel:open';
export const PLUGIN_PANEL_CLOSE_EVENT = 'plugin-panel:close';

interface Props {
  editor: any;
  width: number;
  /** Optional drag-to-resize handler. When provided, a vertical handle
   *  is rendered on the LEFT edge of the active panel content so the
   *  user can resize the right sidebar by dragging — same UX as the
   *  built-in panels (Script Notes, etc.). Wire this to the editor's
   *  `handleResizePointerDown('right', e)` so the same `rightPanelWidth`
   *  state drives both the built-in and plugin panels. */
  onResizePointerDown?: (e: React.PointerEvent) => void;
}

export const PluginPanelTabs: React.FC<Props> = ({
  editor,
  width,
  onResizePointerDown,
}) => {
  const [panels, setPanels] = useState<PluginPanelEntry[]>(() =>
    pluginRegistry.getPanels('right-sidebar'),
  );
  const [activeId, setActiveId] = useState<string | null>(null);

  // Track the registry so panels appear and disappear as plugins come and
  // go. Plugins usually register at boot, but a lazy loader can register
  // well after this mounts, and anything registered between the useState
  // initializer above and this effect would otherwise be missed — hence
  // the immediate sync before subscribing.
  useEffect(() => {
    const sync = () => setPanels(pluginRegistry.getPanels('right-sidebar'));
    sync();
    return pluginRegistry.subscribe(sync);
  }, []);

  // If the open panel's plugin goes away, drop the selection rather than
  // holding an id that would re-open it should the plugin come back.
  useEffect(() => {
    if (activeId && !panels.some((p) => p.id === activeId)) setActiveId(null);
  }, [panels, activeId]);

  // Listen for external open/close requests from plugins.
  useEffect(() => {
    const openHandler = (e: Event) => {
      const detail = (e as CustomEvent<{ panelId?: string }>).detail;
      const id = detail?.panelId;
      if (id && panels.some((p) => p.id === id)) {
        setActiveId(id);
      }
    };
    const closeHandler = () => setActiveId(null);
    document.addEventListener(PLUGIN_PANEL_OPEN_EVENT, openHandler);
    document.addEventListener(PLUGIN_PANEL_CLOSE_EVENT, closeHandler);
    return () => {
      document.removeEventListener(PLUGIN_PANEL_OPEN_EVENT, openHandler);
      document.removeEventListener(PLUGIN_PANEL_CLOSE_EVENT, closeHandler);
    };
  }, [panels]);

  if (panels.length === 0) return null;

  const active = activeId ? panels.find((p) => p.id === activeId) ?? null : null;

  return (
    <>
      {active && (
        <div
          className="plugin-panel-tabs__content"
          style={{ width, minWidth: width }}
        >
          {onResizePointerDown && (
            <div
              className="plugin-panel-tabs__resize"
              onPointerDown={onResizePointerDown}
              style={{ touchAction: 'none' }}
              aria-label="Resize panel"
              role="separator"
            />
          )}
          <button
            className="plugin-panel-tabs__close"
            onClick={() => setActiveId(null)}
            aria-label={`Close ${active.label}`}
            title="Close panel"
            type="button"
          >
            ×
          </button>
          <active.component editor={editor} />
        </div>
      )}
      <nav className="plugin-panel-tabs__strip" role="tablist" aria-label="Plugin panels">
        {panels.map((p) => {
          const isActive = p.id === activeId;
          return (
            <button
              key={p.id}
              role="tab"
              aria-selected={isActive}
              className={
                'plugin-panel-tabs__tab' +
                (isActive ? ' plugin-panel-tabs__tab--active' : '')
              }
              onClick={() => setActiveId(isActive ? null : p.id)}
              title={p.label}
              type="button"
            >
              <span className="plugin-panel-tabs__tab-label">{p.label}</span>
            </button>
          );
        })}
      </nav>
    </>
  );
};
