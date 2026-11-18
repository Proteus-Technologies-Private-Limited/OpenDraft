/**
 * Where the panels go: the workspace layout (Discussion #273).
 *
 * Every panel, the Navigator's five included, is placed on its own. A panel
 * sits in a group, a group sits in a dock (left, right or bottom of the
 * script), and the panels of a group show as tabs or stacked. A writer can
 * move a whole group, which is how the entire Navigator moves at once, or one
 * panel out of it. A panel can also be left out altogether.
 *
 * Docks are named by their logical side, `start` and `end`, so the layout
 * mirrors itself in right-to-left languages the way the rest of the editor
 * row does.
 *
 * The layout is device chrome, saved with the view state, like the toolbar.
 */
import { registerToolbarPanelIds } from './toolbarLayout';

export type DockId = 'start' | 'end' | 'bottom';
export const DOCK_IDS: DockId[] = ['start', 'end', 'bottom'];
/** Where a panel can be: a dock, or left out. */
export type PanelPlace = DockId | 'hidden';

export type GroupMode = 'tabs' | 'stacked';
/** Whether a dock's groups sit one above the other or side by side. */
export type DockArrange = 'rows' | 'columns';

/** The Navigator's panels: one component, five independent panels. */
export const NAVIGATOR_PANELS = ['scenes', 'pages', 'locations', 'structure', 'bookmarks'] as const;
export type NavigatorPanelId = typeof NAVIGATOR_PANELS[number];

/** The other built-in panels. */
export const TOOL_PANELS = [
  'notes', 'characters', 'tags', 'location-db', 'tuner', 'suggestions', 'add-ons', 'table-read',
] as const;

export const BUILT_IN_PANELS: string[] = [...NAVIGATOR_PANELS, ...TOOL_PANELS];
registerToolbarPanelIds(BUILT_IN_PANELS);

export function isNavigatorPanel(id: string): id is NavigatorPanelId {
  return (NAVIGATOR_PANELS as readonly string[]).includes(id);
}

export interface PanelGroup {
  id: string;
  /** The writer's name for the group; unset means a name made from its panels. */
  name?: string;
  panels: string[];
  mode: GroupMode;
}

export interface WorkspaceLayout {
  groups: Record<string, PanelGroup>;
  docks: Record<DockId, string[]>;
  hidden: string[];
  arrange: Record<DockId, DockArrange>;
}

export interface SavedWorkspaceLayout {
  id: string;
  label: string;
  layout: WorkspaceLayout;
}

export const WORKSPACE_PRESET_IDS = ['classic', 'nav-end', 'nav-bottom', 'split'] as const;
export type WorkspacePresetId = typeof WORKSPACE_PRESET_IDS[number];

const g = (id: string, panels: string[], mode: GroupMode = 'tabs'): PanelGroup => ({ id, panels, mode });

/** One group per tool panel, as the right-hand panels have always been. */
function toolGroups(panels: readonly string[]): PanelGroup[] {
  return panels.map((panel) => g(`g-${panel}`, [panel]));
}

function build(groups: PanelGroup[], docks: Record<DockId, string[]>, arrange: Record<DockId, DockArrange>, hidden: string[] = []): WorkspaceLayout {
  return { groups: Object.fromEntries(groups.map((group) => [group.id, group])), docks, hidden, arrange };
}

const RIGHT_TOOLS = TOOL_PANELS.filter((p) => p !== 'table-read');

/** The built-in layouts. Classic is the editor as it has always been. */
export function workspacePreset(id: WorkspacePresetId): WorkspaceLayout {
  const tools = toolGroups(RIGHT_TOOLS);
  const toolIds = tools.map((group) => group.id);
  const nav = g('g-navigator', [...NAVIGATOR_PANELS]);
  const tableRead = g('g-table-read', ['table-read']);
  switch (id) {
    case 'nav-end':
      return build([nav, ...tools, tableRead],
        { start: [], end: [nav.id, ...toolIds], bottom: [tableRead.id] },
        { start: 'rows', end: 'columns', bottom: 'columns' });
    case 'nav-bottom':
      return build([nav, ...tools, tableRead],
        { start: [], end: toolIds, bottom: [nav.id, tableRead.id] },
        { start: 'rows', end: 'columns', bottom: 'columns' });
    case 'split': {
      const scenes = g('g-navigator', ['scenes', 'structure']);
      const bookmarks = g('g-bookmarks', ['bookmarks']);
      const pages = g('g-pages', ['pages']);
      const script = g('g-script-tools', ['notes', 'characters', 'tags', 'location-db', 'tuner', 'suggestions']);
      const addOns = g('g-add-ons', ['add-ons']);
      const locations = g('g-locations', ['locations']);
      return build([scenes, bookmarks, pages, script, addOns, locations, tableRead],
        { start: [scenes.id, bookmarks.id], end: [pages.id, script.id, addOns.id], bottom: [locations.id, tableRead.id] },
        { start: 'rows', end: 'rows', bottom: 'columns' });
    }
    case 'classic':
    default:
      return build([nav, ...tools, tableRead],
        { start: [nav.id], end: toolIds, bottom: [tableRead.id] },
        { start: 'rows', end: 'columns', bottom: 'columns' });
  }
}

export function isWorkspacePreset(id: string): id is WorkspacePresetId {
  return (WORKSPACE_PRESET_IDS as readonly string[]).includes(id);
}

// ── Reading ─────────────────────────────────────────────────────────────

export function groupOfPanel(layout: WorkspaceLayout, panel: string): string | null {
  for (const group of Object.values(layout.groups)) if (group.panels.includes(panel)) return group.id;
  return null;
}

export function dockOfGroup(layout: WorkspaceLayout, groupId: string): DockId | null {
  for (const dock of DOCK_IDS) if (layout.docks[dock].includes(groupId)) return dock;
  return null;
}

export function placeOfPanel(layout: WorkspaceLayout, panel: string): PanelPlace {
  const group = groupOfPanel(layout, panel);
  return (group && dockOfGroup(layout, group)) || 'hidden';
}

/** The groups of a dock with at least one panel showing. */
export function visibleGroups(layout: WorkspaceLayout, dock: DockId, isOpen: (panel: string) => boolean): PanelGroup[] {
  return layout.docks[dock]
    .map((id) => layout.groups[id])
    .filter((group): group is PanelGroup => !!group && group.panels.some(isOpen));
}

/** Every panel the layout places or leaves out, in a stable order. */
export function layoutPanels(layout: WorkspaceLayout): string[] {
  const out: string[] = [];
  for (const dock of DOCK_IDS) for (const id of layout.docks[dock]) out.push(...(layout.groups[id]?.panels ?? []));
  out.push(...layout.hidden);
  return out;
}

// ── Normalising ─────────────────────────────────────────────────────────

const PANEL_ID = /^[A-Za-z0-9:_-]{1,80}$/;

/**
 * A saved layout, cleaned up and made whole.
 *
 * Unknown panels are dropped; a panel listed twice keeps its first place;
 * empty groups go; and a panel the layout does not mention (one this build
 * added, or a plugin installed since) joins its Classic place, so a new panel
 * is never lost. Plugin panels (`plugin:…`) are kept even while the add-on is
 * off, so they come back to the same place.
 */
export function normaliseWorkspaceLayout(raw: unknown, extraPanels: string[] = []): WorkspaceLayout {
  const known = new Set([...BUILT_IN_PANELS, ...extraPanels]);
  const isPanel = (id: unknown): id is string =>
    typeof id === 'string' && PANEL_ID.test(id) && (known.has(id) || id.startsWith('plugin:'));
  const fallback = workspacePreset('classic');
  if (!raw || typeof raw !== 'object') return completeLayout(fallback, known);
  const value = raw as Record<string, unknown>;
  const rawGroups = value.groups && typeof value.groups === 'object' ? value.groups as Record<string, unknown> : {};
  const rawDocks = value.docks && typeof value.docks === 'object' ? value.docks as Record<string, unknown> : {};
  const rawArrange = value.arrange && typeof value.arrange === 'object' ? value.arrange as Record<string, unknown> : {};

  const seen = new Set<string>();
  const usedGroups = new Set<string>();
  const layout: WorkspaceLayout = {
    groups: {},
    docks: { start: [], end: [], bottom: [] },
    hidden: [],
    arrange: { ...fallback.arrange },
  };
  for (const dock of DOCK_IDS) {
    const arrange = rawArrange[dock];
    if (arrange === 'rows' || arrange === 'columns') layout.arrange[dock] = arrange;
    const ids = Array.isArray(rawDocks[dock]) ? rawDocks[dock] as unknown[] : [];
    for (const groupId of ids) {
      if (typeof groupId !== 'string' || usedGroups.has(groupId)) continue;
      const rawGroup = rawGroups[groupId];
      if (!rawGroup || typeof rawGroup !== 'object') continue;
      const gv = rawGroup as Record<string, unknown>;
      const panels = (Array.isArray(gv.panels) ? gv.panels : []).filter((p): p is string => {
        if (!isPanel(p) || seen.has(p)) return false;
        seen.add(p);
        return true;
      });
      if (panels.length === 0) continue;
      usedGroups.add(groupId);
      const group: PanelGroup = { id: groupId, panels, mode: gv.mode === 'stacked' ? 'stacked' : 'tabs' };
      if (typeof gv.name === 'string' && gv.name.trim()) group.name = gv.name.trim().slice(0, 40);
      layout.groups[groupId] = group;
      layout.docks[dock].push(groupId);
    }
  }
  for (const p of Array.isArray(value.hidden) ? value.hidden : []) {
    if (isPanel(p) && !seen.has(p)) { seen.add(p); layout.hidden.push(p); }
  }
  return completeLayout(layout, known);
}

/** Give every known panel a place: its Classic one, or a new group on the right. */
function completeLayout(layout: WorkspaceLayout, known: Set<string>): WorkspaceLayout {
  const placed = new Set(layoutPanels(layout));
  const missing = [...known].filter((p) => !placed.has(p));
  if (missing.length === 0) return layout;
  const classic = workspacePreset('classic');
  let next = layout;
  for (const panel of missing) {
    const classicGroup = groupOfPanel(classic, panel);
    const dock = (classicGroup && dockOfGroup(classic, classicGroup)) || 'end';
    // Navigator panels rejoin a group that already holds Navigator panels.
    const sibling = isNavigatorPanel(panel)
      ? Object.values(next.groups).find((group) => group.panels.some(isNavigatorPanel))
      : undefined;
    next = sibling ? movePanelToGroup(next, panel, sibling.id) : movePanelToNewGroup(next, panel, dock);
  }
  return next;
}

export function normaliseSavedWorkspaceLayouts(raw: unknown, extraPanels: string[] = []): SavedWorkspaceLayout[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: SavedWorkspaceLayout[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id : '';
    const label = typeof record.label === 'string' ? record.label.trim().slice(0, 40) : '';
    if (!id || !label || seen.has(id) || isWorkspacePreset(id)) continue;
    seen.add(id);
    out.push({ id, label, layout: normaliseWorkspaceLayout(record.layout, extraPanels) });
  }
  return out;
}

// ── Editing ─────────────────────────────────────────────────────────────
// Every edit returns a new layout and leaves the one it was given alone.

function clone(layout: WorkspaceLayout): WorkspaceLayout {
  return {
    groups: Object.fromEntries(Object.entries(layout.groups).map(([id, group]) => [id, { ...group, panels: [...group.panels] }])),
    docks: { start: [...layout.docks.start], end: [...layout.docks.end], bottom: [...layout.docks.bottom] },
    hidden: [...layout.hidden],
    arrange: { ...layout.arrange },
  };
}

function dropGroup(layout: WorkspaceLayout, groupId: string): void {
  delete layout.groups[groupId];
  for (const dock of DOCK_IDS) layout.docks[dock] = layout.docks[dock].filter((id) => id !== groupId);
}

/** Take a panel out of wherever it is. A group left empty goes. */
function detach(layout: WorkspaceLayout, panel: string): void {
  const groupId = groupOfPanel(layout, panel);
  if (groupId) {
    const group = layout.groups[groupId];
    group.panels = group.panels.filter((p) => p !== panel);
    if (group.panels.length === 0) dropGroup(layout, groupId);
  }
  layout.hidden = layout.hidden.filter((p) => p !== panel);
}

function insertBefore(list: string[], id: string, before: string | null | undefined): void {
  const at = before ? list.indexOf(before) : -1;
  if (at < 0) list.push(id); else list.splice(at, 0, id);
}

function newGroupId(layout: WorkspaceLayout, panel: string): string {
  let id = `g-${panel}`;
  for (let n = 2; layout.groups[id]; n++) id = `g-${panel}-${n}`;
  return id;
}

/** Add a panel to a group as its last tab, or before `before`. */
export function movePanelToGroup(layout: WorkspaceLayout, panel: string, groupId: string, before?: string | null): WorkspaceLayout {
  if (!layout.groups[groupId]) return layout;
  const next = clone(layout);
  detach(next, panel);
  const group = next.groups[groupId];
  if (!group) return layout; // the panel was the group's only one
  insertBefore(group.panels, panel, before);
  return next;
}

/** Give a panel a group of its own in a dock, before `beforeGroup` or at the end. */
export function movePanelToNewGroup(layout: WorkspaceLayout, panel: string, dock: DockId, beforeGroup?: string | null): WorkspaceLayout {
  const current = groupOfPanel(layout, panel);
  if (current && layout.groups[current].panels.length === 1 && dockOfGroup(layout, current) === dock && !beforeGroup) {
    // Already alone at the end of that dock, or about to be: just move the group.
    return moveGroup(layout, current, dock, null);
  }
  const next = clone(layout);
  detach(next, panel);
  const id = newGroupId(next, panel);
  next.groups[id] = { id, panels: [panel], mode: 'tabs' };
  insertBefore(next.docks[dock], id, beforeGroup && next.groups[beforeGroup] ? beforeGroup : null);
  return next;
}

/** Leave a panel out of the layout. */
export function hidePanel(layout: WorkspaceLayout, panel: string): WorkspaceLayout {
  const next = clone(layout);
  detach(next, panel);
  next.hidden.push(panel);
  return next;
}

/** Move a whole group to a dock (or leave all its panels out). */
export function moveGroup(layout: WorkspaceLayout, groupId: string, place: PanelPlace, beforeGroup?: string | null): WorkspaceLayout {
  if (!layout.groups[groupId] || groupId === beforeGroup) return layout;
  const next = clone(layout);
  for (const dock of DOCK_IDS) next.docks[dock] = next.docks[dock].filter((id) => id !== groupId);
  if (place === 'hidden') {
    next.hidden.push(...next.groups[groupId].panels);
    delete next.groups[groupId];
    return next;
  }
  insertBefore(next.docks[place], groupId, beforeGroup);
  return next;
}

/** Fold one group's panels into another, as extra tabs. */
export function mergeGroups(layout: WorkspaceLayout, source: string, target: string): WorkspaceLayout {
  if (source === target || !layout.groups[source] || !layout.groups[target]) return layout;
  const next = clone(layout);
  next.groups[target].panels.push(...next.groups[source].panels);
  dropGroup(next, source);
  return next;
}

/** Split a group into one group per panel, in place. */
export function ungroup(layout: WorkspaceLayout, groupId: string): WorkspaceLayout {
  const group = layout.groups[groupId];
  const dock = dockOfGroup(layout, groupId);
  if (!group || !dock || group.panels.length < 2) return layout;
  const next = clone(layout);
  const [first, ...rest] = next.groups[groupId].panels;
  next.groups[groupId].panels = [first];
  const list = next.docks[dock];
  let at = list.indexOf(groupId);
  for (const panel of rest) {
    const id = newGroupId(next, panel);
    next.groups[id] = { id, panels: [panel], mode: 'tabs' };
    list.splice(++at, 0, id);
  }
  return next;
}

export function renameGroup(layout: WorkspaceLayout, groupId: string, name: string): WorkspaceLayout {
  if (!layout.groups[groupId]) return layout;
  const next = clone(layout);
  const clean = name.trim().slice(0, 40);
  if (clean) next.groups[groupId].name = clean; else delete next.groups[groupId].name;
  return next;
}

export function setGroupMode(layout: WorkspaceLayout, groupId: string, mode: GroupMode): WorkspaceLayout {
  if (!layout.groups[groupId] || layout.groups[groupId].mode === mode) return layout;
  const next = clone(layout);
  next.groups[groupId].mode = mode;
  return next;
}

/** Move a tab within its group, for the arrow buttons. */
export function shiftPanelInGroup(layout: WorkspaceLayout, panel: string, delta: -1 | 1): WorkspaceLayout {
  const groupId = groupOfPanel(layout, panel);
  if (!groupId) return layout;
  const panels = layout.groups[groupId].panels;
  const from = panels.indexOf(panel);
  const to = from + delta;
  if (to < 0 || to >= panels.length) return layout;
  const next = clone(layout);
  const list = next.groups[groupId].panels;
  [list[from], list[to]] = [list[to], list[from]];
  return next;
}

export function setDockArrange(layout: WorkspaceLayout, dock: DockId, arrange: DockArrange): WorkspaceLayout {
  if (layout.arrange[dock] === arrange) return layout;
  const next = clone(layout);
  next.arrange[dock] = arrange;
  return next;
}

/** True when two layouts place every panel the same way. */
export function sameWorkspaceLayout(a: WorkspaceLayout, b: WorkspaceLayout): boolean {
  const shape = (l: WorkspaceLayout) => JSON.stringify({
    docks: DOCK_IDS.map((d) => l.docks[d].map((id) => [l.groups[id]?.panels, l.groups[id]?.mode, l.groups[id]?.name ?? ''])),
    hidden: [...l.hidden].sort(),
    arrange: l.arrange,
  });
  return shape(a) === shape(b);
}
