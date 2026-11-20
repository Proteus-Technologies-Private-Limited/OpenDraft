/**
 * One dock of the workspace (Discussion #273): the left, right or bottom of
 * the script, holding the groups the layout puts there.
 *
 * - A group of Navigator panels draws one Navigator showing only those tabs,
 *   so the Classic layout's left dock is the Navigator exactly as it was.
 * - A group with one showing panel draws it as it is, with its own header.
 * - Otherwise the group's panels are tabs, or stacked one above the other.
 *
 * A dock's groups sit one above the other (rows) or side by side (columns).
 * Classic puts the right-hand panels side by side, as they always were.
 */
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorFields } from '../stores/editorStore';
import { isNavigatorPanel, visibleGroups, type DockId, type NavigatorPanelId, type PanelGroup, type WorkspaceLayout } from '../utils/workspaceLayout';
import { panelIcon, usePanelLabel } from './toolbar/toolbarMeta';

export interface DockPanelDef {
  open: boolean;
  /** `width` is the side dock's width; undefined in the bottom dock. */
  render: (width: number | undefined) => React.ReactNode;
}

export interface NavigatorRender {
  tabs: NavigatorPanelId[];
  activeTab?: NavigatorPanelId;
  onTabChange?: (tab: NavigatorPanelId) => void;
  /** In a mixed group the group's tab strip names the panel: no header of its own. */
  bare?: boolean;
  width: number | undefined;
}

interface Props {
  dock: DockId;
  /** The layout to draw: the writer's, plus any left-out panel that was opened anyway. */
  layout: WorkspaceLayout;
  panels: Record<string, DockPanelDef>;
  renderNavigator: (args: NavigatorRender) => React.ReactNode;
  /** Side docks: the dock's width. */
  width?: number;
  /** Bottom dock: its height, when it holds more than Table Read. */
  height?: number;
}


/** How long a dock or a group takes to open or close (screenplay.css keyframes match). */
const DOCK_ANIM_MS = 220;

type GroupState = 'entering' | 'shown' | 'exiting';

const WorkspaceDock: React.FC<Props> = ({ dock, layout: workspaceLayout, panels, renderNavigator, width, height }) => {
  const { t } = useTranslation('toolbar');
  const { dockActive, setDockActive } = useEditorFields('dockActive', 'setDockActive');
  const panelLabel = usePanelLabel();
  const groups = visibleGroups(workspaceLayout, dock, (panel) => !!panels[panel]?.open);
  const showingNow: Record<string, string[]> = {};
  for (const group of groups) showingNow[group.id] = group.panels.filter((p) => panels[p]?.open);
  const snapshot = groups.map((group) => `${group.id}:${showingNow[group.id].join(',')}`).join('|');

  // ── Opening and closing ──
  // A group that closes stays on screen, with the panels it showed, while it
  // collapses; one that opens grows in. Remembered from the previous render
  // (React's "storing information from previous renders" pattern).
  const reduceMotion = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const [previous, setPrevious] = useState(() => ({ key: snapshot, showing: showingNow }));
  const [exiting, setExiting] = useState<Record<string, string[]>>({});
  const [entering, setEntering] = useState<string[]>([]);
  if (previous.key !== snapshot) {
    const gone = Object.keys(previous.showing).filter((id) => !showingNow[id]);
    const added = Object.keys(showingNow).filter((id) => !previous.showing[id]);
    setPrevious({ key: snapshot, showing: showingNow });
    if (!reduceMotion) {
      if (gone.length > 0 || added.length > 0) {
        setExiting((current) => {
          const next = { ...current };
          for (const id of gone) next[id] = previous.showing[id];
          for (const id of added) delete next[id];
          return next;
        });
      }
      if (added.length > 0) setEntering(added);
    }
  }
  useEffect(() => {
    if (Object.keys(exiting).length === 0) return;
    const timer = setTimeout(() => setExiting({}), DOCK_ANIM_MS);
    return () => clearTimeout(timer);
  }, [exiting]);
  useEffect(() => {
    if (entering.length === 0) return;
    const timer = setTimeout(() => setEntering([]), DOCK_ANIM_MS);
    return () => clearTimeout(timer);
  }, [entering]);

  const items: { group: PanelGroup; showing: string[]; state: GroupState }[] = [];
  for (const id of workspaceLayout.docks[dock]) {
    const group = workspaceLayout.groups[id];
    if (!group) continue;
    if (showingNow[id]) items.push({ group, showing: showingNow[id], state: entering.includes(id) ? 'entering' : 'shown' });
    else if (exiting[id]) items.push({ group, showing: exiting[id], state: 'exiting' });
  }
  if (items.length === 0) return null;
  // The whole dock opens or closes when every group in it does; then the dock
  // itself grows or shrinks and its groups stay still inside it.
  const dockState: GroupState = items.every((item) => item.state === 'exiting') ? 'exiting'
    : items.every((item) => item.state === 'entering') ? 'entering' : 'shown';
  const arrange = workspaceLayout.arrange[dock];
  const side = dock !== 'bottom';
  // Side docks in rows share one width; in columns each group has it.
  const groupWidth = side ? width : undefined;

  const renderPanel = (panel: string, bare: boolean) => (isNavigatorPanel(panel)
    ? renderNavigator({ tabs: [panel], bare, width: groupWidth })
    : panels[panel].render(groupWidth));

  const renderGroup = (group: PanelGroup, showing: string[]) => {
    if (showing.length === 1) return renderPanel(showing[0], false);
    const navOnly = showing.every(isNavigatorPanel);
    if (navOnly && group.mode === 'tabs') {
      const active = dockActive[group.id];
      return renderNavigator({
        tabs: showing as NavigatorPanelId[],
        activeTab: active && isNavigatorPanel(active) ? active : undefined,
        onTabChange: (tab) => setDockActive(group.id, tab),
        width: groupWidth,
      });
    }
    if (group.mode === 'stacked') {
      return (
        <div className="dock-group-stack">
          {showing.map((panel) => <div key={panel} className="dock-stack-cell">{renderPanel(panel, false)}</div>)}
        </div>
      );
    }
    const active = showing.includes(dockActive[group.id]) ? dockActive[group.id] : showing[0];
    return (
      <div className="dock-group-tabs" style={groupWidth ? { width: groupWidth, minWidth: groupWidth } : undefined}>
        <div className="dock-tab-strip" role="tablist" aria-label={group.name || panelLabel(showing[0])}>
          {showing.map((panel) => (
            <button
              key={panel}
              type="button"
              role="tab"
              id={`dock-tab-${group.id}-${panel}`}
              aria-selected={panel === active}
              aria-controls={`dock-panel-${group.id}-${panel}`}
              tabIndex={panel === active ? 0 : -1}
              className={`dock-tab${panel === active ? ' active' : ''}`}
              onClick={() => setDockActive(group.id, panel)}
              onKeyDown={(event) => {
                const index = showing.indexOf(panel);
                const step = getComputedStyle(event.currentTarget).direction === 'rtl' ? -1 : 1;
                const next = event.key === 'ArrowRight' ? (index + step + showing.length) % showing.length
                  : event.key === 'ArrowLeft' ? (index - step + showing.length) % showing.length
                  : event.key === 'Home' ? 0 : event.key === 'End' ? showing.length - 1 : -1;
                if (next < 0) return;
                event.preventDefault();
                setDockActive(group.id, showing[next]);
                document.getElementById(`dock-tab-${group.id}-${showing[next]}`)?.focus();
              }}
            >
              <span aria-hidden="true" className="dock-tab-icon">{panelIcon(panel)}</span>
              {panelLabel(panel)}
            </button>
          ))}
        </div>
        {/* Every tab stays mounted, so a Table Read keeps playing behind another tab. */}
        {showing.map((panel) => (
          <div key={panel} className="dock-tab-panel" role="tabpanel" id={`dock-panel-${group.id}-${panel}`}
            aria-labelledby={`dock-tab-${group.id}-${panel}`} hidden={panel !== active}>
            {renderPanel(panel, true)}
          </div>
        ))}
      </div>
    );
  };

  const style: React.CSSProperties = {};
  if (side && arrange === 'rows' && width) { style.width = width; style.minWidth = width; }
  const onlyTableRead = !side && items.every((item) => item.showing.every((p) => p === 'table-read'));
  const sized = !side && !!height && !onlyTableRead;
  if (sized) style.height = height;
  const dockClass = dockState === 'shown' ? '' : ` dock-${dockState}`;

  return (
    <div
      className={`workspace-dock workspace-dock-${dock} dock-arrange-${arrange}${sized ? ' dock-sized' : ''}${dockClass}`}
      style={style}
      role="complementary"
      aria-label={t(`layout.dockTitle.${dock === 'start' ? 'left' : dock === 'end' ? 'right' : 'bottom'}`)}
    >
      {items.map(({ group, showing, state }) => (
        <div
          key={group.id}
          className={`dock-group dock-group-${group.mode}${dockState === 'shown' && state !== 'shown' ? ` is-${state}` : ''}`}
          data-group={group.id}
          style={groupWidth ? { '--group-w': `${groupWidth}px` } as React.CSSProperties : undefined}
          aria-hidden={state === 'exiting' ? true : undefined}
        >
          {renderGroup(group, showing)}
        </div>
      ))}
    </div>
  );
};

export default WorkspaceDock;
