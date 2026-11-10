import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { movePanelHost } from '../utils/movePanelHost';
import { reconcileFoldPanels, type FoldPanelSelection } from '../utils/foldPanelSelection';

export interface FoldablePanel {
  id: string;
  label: string;
  open: boolean;
  /** A new request can activate an already-open plugin panel. */
  activationKey?: string | number;
  content: ReactNode;
  /** Table Read normally lives below the script, rather than on its right. */
  home?: RefObject<HTMLDivElement | null>;
  keepHomeWhenClosed?: boolean;
}

/** Moving a stable portal host preserves panel inputs and Table Read playback.
 * Switching the portal's container itself would remount its React subtree. */
function PanelSlot({ panel, dock, active, selected }: {
  panel: FoldablePanel;
  dock: RefObject<HTMLDivElement | null>;
  active: boolean;
  selected: boolean;
}) {
  const anchor = useRef<HTMLDivElement>(null);
  const [host] = useState(() => {
    const el = document.createElement('div');
    el.className = 'fold-panel-host';
    return el;
  });
  useLayoutEffect(() => {
    const target = active ? dock.current : (panel.home?.current ?? anchor.current);
    if (target) movePanelHost(host, target);
  }, [active, dock, panel.home, host]);
  useLayoutEffect(() => () => { host.remove(); }, [host]);
  useLayoutEffect(() => {
    host.toggleAttribute('hidden', active && !selected);
    host.setAttribute('id', `fold-panel-${panel.id}`);
    host.setAttribute('data-fold-panel', panel.id);
    if (active) {
      host.setAttribute('role', 'tabpanel');
      host.setAttribute('tabindex', '0');
      host.setAttribute('aria-labelledby', `fold-tab-${panel.id}`);
    } else {
      host.removeAttribute('role');
      host.removeAttribute('tabindex');
      host.removeAttribute('aria-labelledby');
    }
  }, [active, selected, host, panel.id]);
  return <><div className="fold-panel-home" ref={anchor} />{createPortal(panel.content, host)}</>;
}

export default function FoldablePanelDock({ active, panels }: { active: boolean; panels: FoldablePanel[] }) {
  const { t } = useTranslation('menu');
  const dock = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<FoldPanelSelection>(() => ({ selected: '', opened: new Map() }));
  const nextSelection = reconcileFoldPanels(selection, panels);
  if (nextSelection !== selection) setSelection(nextSelection);
  const current = nextSelection.selected;
  const opened = panels.filter(panel => panel.open);
  const select = (id: string) => setSelection(previous => ({ ...previous, selected: id }));
  const focusedPanel = useRef<string | null>(null);
  useEffect(() => {
    const root = dock.current?.parentElement;
    if (!root) return;
    // Native events follow the DOM through portals; React's synthetic events
    // follow the component tree, where PanelSlot is outside the aside.
    const focus = (event: FocusEvent) => {
      focusedPanel.current = (event.target as HTMLElement).closest<HTMLElement>('[data-fold-panel]')?.dataset.foldPanel ?? null;
    };
    const blur = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Node && event.relatedTarget !== document.body && !root.contains(event.relatedTarget)) focusedPanel.current = null;
    };
    root.addEventListener('focusin', focus);
    root.addEventListener('focusout', blur);
    return () => { root.removeEventListener('focusin', focus); root.removeEventListener('focusout', blur); };
  }, []);
  useLayoutEffect(() => {
    const lost = focusedPanel.current;
    if (!active || !lost || opened.some(panel => panel.id === lost)) return;
    const frame = requestAnimationFrame(() => {
      focusedPanel.current = null;
      // Only repair focus lost by a removed panel; never pull it out of the script.
      const focused = document.activeElement;
      const inRemovedPanel = focused instanceof HTMLElement && dock.current?.contains(focused) && focused.closest<HTMLElement>('[data-fold-panel]')?.dataset.foldPanel === lost;
      if (focused === document.body || inRemovedPanel) {
        const target = current ? document.getElementById(`fold-tab-${current}`) : document.querySelector<HTMLElement>('.ProseMirror');
        target?.focus({ preventScroll: true });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [active, opened, current]);
  return <>
    <aside className="fold-panel-dock" aria-label={t('view.panels')} hidden={!active || !opened.length}>
      <nav className="fold-panel-tabs" aria-label={t('view.panels')} role="tablist">
        {opened.map(panel => <button key={panel.id} id={`fold-tab-${panel.id}`} data-fold-panel={panel.id} role="tab"
          aria-selected={current === panel.id} aria-controls={`fold-panel-${panel.id}`}
          tabIndex={current === panel.id ? 0 : -1}
          onClick={() => select(panel.id)}
          onKeyDown={event => {
            const index = opened.findIndex(p => p.id === panel.id);
            const step = getComputedStyle(event.currentTarget).direction === 'rtl' ? -1 : 1;
            const next = event.key === 'ArrowRight' ? (index + step + opened.length) % opened.length
              : event.key === 'ArrowLeft' ? (index - step + opened.length) % opened.length
              : event.key === 'Home' ? 0 : event.key === 'End' ? opened.length - 1 : -1;
            if (next < 0) return;
            event.preventDefault(); select(opened[next].id);
            document.getElementById(`fold-tab-${opened[next].id}`)?.focus();
          }}>{panel.label}</button>)}
      </nav>
      <div className="fold-panel-content" ref={dock} />
    </aside>
    {panels.map(panel => <PanelSlot key={panel.id} panel={panel} dock={dock} active={active && (!panel.keepHomeWhenClosed || panel.open)} selected={current === panel.id} />)}
  </>;
}
