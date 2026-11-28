/**
 * Plugin panels under the script (`bottom-panel` slot) and plugin items at the
 * end of the status bar (`status-bar` slot).
 *
 * Bottom panels work like the right sidebar's plugin tabs, turned on their
 * side: a strip of tabs sits above the status bar, and choosing one opens its
 * panel above the strip, at a height the writer can drag or set from the
 * keyboard. Nothing is drawn while no plugin registers a bottom panel.
 *
 * A plugin opens its own panel the same way as a sidebar one:
 *
 *   document.dispatchEvent(new CustomEvent('plugin-panel:open', { detail: { panelId: 'my-panel' } }));
 */

import React, { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Editor } from '@tiptap/react';

import { pluginRegistry, resolvePluginText, type PluginPanelEntry } from '../plugins/registry';
import { PLUGIN_PANEL_CLOSE_EVENT, PLUGIN_PANEL_OPEN_EVENT } from './PluginPanelTabs';
import { isCloseRequestFor } from '../plugins/panelClose';
import './PluginBottomPanels.css';

const HEIGHT_KEY = 'opendraft:plugin-bottom-panel:height';
const DEFAULT_HEIGHT = 240;
const MIN_HEIGHT = 120;
const STEP = 24;

function maxHeight(): number {
  return Math.max(MIN_HEIGHT, Math.round((globalThis.innerHeight || 800) * 0.6));
}

function clampHeight(height: number, limit: number = maxHeight()): number {
  return Math.max(MIN_HEIGHT, Math.min(limit, Math.round(height)));
}

function readHeight(): number {
  try {
    const stored = Number(globalThis.localStorage?.getItem(HEIGHT_KEY));
    return Number.isFinite(stored) && stored > 0 ? clampHeight(stored) : DEFAULT_HEIGHT;
  } catch (err) {
    console.warn('[plugins] could not read the bottom panel height', err);
    return DEFAULT_HEIGHT;
  }
}

function writeHeight(height: number): void {
  try {
    globalThis.localStorage?.setItem(HEIGHT_KEY, String(height));
  } catch (err) {
    console.warn('[plugins] could not remember the bottom panel height', err);
  }
}

/**
 * The panels a slot has right now, kept current as plugins come and go.
 * `onChange` hears each new list (to close a panel whose plugin went away).
 */
function useSlotPanels(
  slot: PluginPanelEntry['slot'],
  onChange?: (panels: PluginPanelEntry[]) => void,
): PluginPanelEntry[] {
  const read = () => {
    try {
      return pluginRegistry.getPanels(slot);
    } catch (err) {
      console.error(`[plugins] could not read the ${slot} panels`, err);
      return [];
    }
  };
  const [panels, setPanels] = useState<PluginPanelEntry[]>(read);
  const changed = useRef(onChange);
  useEffect(() => { changed.current = onChange; });
  useEffect(() => {
    const sync = () => {
      const next = read();
      setPanels(next);
      changed.current?.(next);
    };
    // Anything registered between the first render and this effect is picked up here.
    sync();
    return pluginRegistry.subscribe(sync);
    // `read` only closes over `slot`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot]);
  return panels;
}

/** Catches a plugin panel that throws, so the rest of the editor keeps working. */
class PanelBoundary extends React.Component<{ id: string; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    console.error(`[plugins] the "${this.props.id}" panel stopped working`, error);
  }

  render(): React.ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

export const PluginStatusBarItems: React.FC<{ editor: Editor | null }> = ({ editor }) => {
  const panels = useSlotPanels('status-bar');
  return (
    <>
      {panels.map((p) => (
        <PanelBoundary key={p.id} id={p.id}>
          <p.component editor={editor} />
        </PanelBoundary>
      ))}
    </>
  );
};

export const PluginBottomPanels: React.FC<{ editor: Editor | null }> = ({ editor }) => {
  const { t } = useTranslation('menu');
  const prefix = useId();
  const tabId = (id: string) => `${prefix}-tab-${id}`;
  const contentId = (id: string) => `${prefix}-panel-${id}`;
  const [activeId, setActiveId] = useState<string | null>(null);
  // A panel whose plugin went away (or was turned off) closes.
  const panels = useSlotPanels('bottom-panel', (next) => {
    setActiveId((current) => (current && !next.some((p) => p.id === current) ? null : current));
  });
  const [height, setHeightState] = useState(readHeight);
  // The latest height, ahead of the render that shows it: a drag's last
  // pointermove may not have rendered yet when pointerup saves it.
  const heightRef = useRef(height);
  const setHeight = (next: number) => {
    heightRef.current = next;
    setHeightState(next);
  };
  const [limit, setLimit] = useState(maxHeight);
  const drag = useRef<{ startY: number; startHeight: number } | null>(null);

  // A smaller window lowers the 60% ceiling: the panel, what is announced and
  // what is remembered all follow it, not just the next mount.
  useEffect(() => {
    const onResize = () => {
      try {
        const nextLimit = maxHeight();
        setLimit(nextLimit);
        const clamped = clampHeight(heightRef.current, nextLimit);
        if (clamped !== heightRef.current) {
          heightRef.current = clamped;
          setHeightState(clamped);
          writeHeight(clamped);
        }
      } catch (err) {
        console.warn('[plugins] could not fit the bottom panel to the window', err);
      }
    };
    globalThis.addEventListener?.('resize', onResize);
    return () => globalThis.removeEventListener?.('resize', onResize);
  }, []);

  useEffect(() => {
    const ids = () => pluginRegistry.getPanels('bottom-panel').map((p) => p.id);
    const open = (e: Event) => {
      const id = (e as CustomEvent<{ panelId?: string }>).detail?.panelId;
      if (id && ids().includes(id)) setActiveId(id);
    };
    const close = (e: Event) => {
      const id = (e as CustomEvent<{ panelId?: string }>).detail?.panelId;
      // Without an id, close only when the request comes from inside a bottom panel.
      if (!isCloseRequestFor('bottom-panel', id, document.activeElement)) return;
      setActiveId((current) => (!id || current === id ? null : current));
    };
    document.addEventListener(PLUGIN_PANEL_OPEN_EVENT, open);
    document.addEventListener(PLUGIN_PANEL_CLOSE_EVENT, close);
    return () => {
      document.removeEventListener(PLUGIN_PANEL_OPEN_EVENT, open);
      document.removeEventListener(PLUGIN_PANEL_CLOSE_EVENT, close);
    };
  }, []);

  if (panels.length === 0) return null;

  const active = activeId ? panels.find((p) => p.id === activeId) ?? null : null;
  const label = (p: PluginPanelEntry) => resolvePluginText(p.labelKey, p.label);

  const resizeTo = (next: number) => {
    const clamped = clampHeight(next);
    setHeight(clamped);
    writeHeight(clamped);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    drag.current = { startY: e.clientY, startHeight: heightRef.current };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (err) {
      console.warn('[plugins] could not capture the pointer for resizing', err);
    }
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    setHeight(clampHeight(drag.current.startHeight + (drag.current.startY - e.clientY)));
  };
  const onPointerUp = () => {
    if (!drag.current) return;
    drag.current = null;
    writeHeight(heightRef.current);
  };

  const choose = (id: string) => setActiveId((current) => (current === id ? null : id));

  return (
    <div className="plugin-bottom-panels">
      {panels.filter((p) => p.id !== active?.id).map((p) => (
        <div key={p.id} id={contentId(p.id)} role="tabpanel" aria-labelledby={tabId(p.id)} hidden />
      ))}
      {active && (
        <div
          className="plugin-bottom-panels__content" data-plugin-panel={active.id}
          id={contentId(active.id)} role="tabpanel" aria-labelledby={tabId(active.id)} tabIndex={0}
          style={{ height }}
        >
          <div
            className="plugin-bottom-panels__resize"
            role="separator" aria-orientation="horizontal" tabIndex={0}
            aria-label={t('pluginPanels.resize')}
            aria-valuenow={height} aria-valuemin={MIN_HEIGHT} aria-valuemax={limit}
            style={{ touchAction: 'none' }}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove}
            onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
            onKeyDown={(e) => {
              const next = e.key === 'ArrowUp' ? height + STEP
                : e.key === 'ArrowDown' ? height - STEP
                : e.key === 'Home' ? limit
                : e.key === 'End' ? MIN_HEIGHT : null;
              if (next === null) return;
              e.preventDefault();
              resizeTo(next);
            }}
          />
          <button
            className="plugin-bottom-panels__close" type="button"
            onClick={() => { document.getElementById(tabId(active.id))?.focus(); setActiveId(null); }}
            aria-label={t('pluginPanels.closeNamed', { name: label(active) })}
            title={t('pluginPanels.close')}
          >
            ×
          </button>
          <div className="plugin-bottom-panels__body">
            <PanelBoundary key={active.id} id={active.id}>
              <active.component editor={editor} />
            </PanelBoundary>
          </div>
        </div>
      )}
      <nav className="plugin-bottom-panels__strip" role="tablist" aria-orientation="horizontal" aria-label={t('pluginPanels.tabs')}>
        {panels.map((p, index) => {
          const isActive = p.id === activeId;
          return (
            <button
              key={p.id} type="button" role="tab" data-plugin-panel={p.id}
              id={tabId(p.id)} aria-controls={contentId(p.id)} aria-selected={isActive}
              tabIndex={isActive || (!active && index === 0) ? 0 : -1}
              className={`plugin-bottom-panels__tab${isActive ? ' plugin-bottom-panels__tab--active' : ''}`}
              onClick={() => choose(p.id)}
              onKeyDown={(e) => {
                const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
                const forward = rtl ? 'ArrowLeft' : 'ArrowRight';
                const back = rtl ? 'ArrowRight' : 'ArrowLeft';
                const next = e.key === forward ? (index + 1) % panels.length
                  : e.key === back ? (index + panels.length - 1) % panels.length
                  : e.key === 'Home' ? 0 : e.key === 'End' ? panels.length - 1 : -1;
                if (next < 0) return;
                e.preventDefault();
                setActiveId(panels[next].id);
                document.getElementById(tabId(panels[next].id))?.focus();
              }}
              title={label(p)}
            >
              {label(p)}
            </button>
          );
        })}
      </nav>
    </div>
  );
};
