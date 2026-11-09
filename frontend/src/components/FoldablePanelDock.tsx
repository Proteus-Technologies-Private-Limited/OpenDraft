import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

export interface FoldablePanel {
  id: string;
  label: string;
  open: boolean;
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
    target?.appendChild(host);
    return () => { host.remove(); };
  }, [active, dock, panel.home, host]);
  useLayoutEffect(() => {
    host.toggleAttribute('hidden', active && !selected);
    host.setAttribute('id', `fold-panel-${panel.id}`);
    if (active) {
      host.setAttribute('role', 'tabpanel');
      host.setAttribute('aria-labelledby', `fold-tab-${panel.id}`);
    } else {
      host.removeAttribute('role'); host.removeAttribute('aria-labelledby');
    }
  }, [active, selected, host, panel.id]);
  return <><div className="fold-panel-home" ref={anchor} />{createPortal(panel.content, host)}</>;
}

export default function FoldablePanelDock({ active, panels }: { active: boolean; panels: FoldablePanel[] }) {
  const { t } = useTranslation('menu');
  const dock = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState('');
  const opened = panels.filter(p => p.open);
  const openIds = JSON.stringify(opened.map(p => p.id));
  const [previous, setPrevious] = useState(openIds);
  // Detect rising open flags, rather than replacing a panel's own open state.
  // Panels hidden behind a tab remain mounted and retain their drafts.
  const newlyOpened = opened.filter(p => !(JSON.parse(previous) as string[]).includes(p.id));
  const current = newlyOpened.at(-1)?.id ?? (opened.some(p => p.id === selected) ? selected : opened.at(-1)?.id ?? '');
  if (previous !== openIds) {
    setPrevious(openIds);
    if (current !== selected) setSelected(current);
  }
  return <>
    <aside className="fold-panel-dock" hidden={!active || !opened.length}>
      <nav className="fold-panel-tabs" aria-label={t('view.panels')} role="tablist">
        {opened.map(panel => <button key={panel.id} id={`fold-tab-${panel.id}`} role="tab"
          aria-selected={current === panel.id} aria-controls={`fold-panel-${panel.id}`}
          tabIndex={current === panel.id ? 0 : -1}
          onClick={() => setSelected(panel.id)}
          onKeyDown={event => {
            const index = opened.findIndex(p => p.id === panel.id);
            const next = event.key === 'ArrowRight' ? (index + 1) % opened.length
              : event.key === 'ArrowLeft' ? (index + opened.length - 1) % opened.length
              : event.key === 'Home' ? 0 : event.key === 'End' ? opened.length - 1 : -1;
            if (next < 0) return;
            event.preventDefault(); setSelected(opened[next].id);
            document.getElementById(`fold-tab-${opened[next].id}`)?.focus();
          }}>{panel.label}</button>)}
      </nav>
      <div className="fold-panel-content" ref={dock} />
    </aside>
    {panels.map(panel => <PanelSlot key={panel.id} panel={panel} dock={dock} active={active && (!panel.keepHomeWhenClosed || panel.open)} selected={current === panel.id} />)}
  </>;
}
