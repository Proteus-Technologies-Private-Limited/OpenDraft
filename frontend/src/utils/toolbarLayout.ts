/**
 * The toolbar and the footer: which controls each bar shows, in what order,
 * on which side, how each one is labelled, and the presets a writer can start
 * from.
 *
 * Both bars are device chrome, not part of the script, so the layout lives in
 * the same local view state as the zoom. A writer who arranges the bars on a
 * laptop does not rearrange the iPad's.
 *
 * Started from the customisable toolbar in PR #217 (presets, named layouts,
 * plugin controls, overflow in the writer's order) and extended for
 * Discussion #273: a footer, start/end sides instead of pinned controls,
 * icon/text labels, a Layout switcher and a zoom slider.
 *
 * Panel buttons use the `panel:` prefix and a workspace panel id; plugin
 * controls use `plugin:` and the id they registered, so a saved layout
 * survives a plugin being turned off and back on.
 */

export type ToolbarBar = 'top' | 'bottom';
/** Where on a bar a control sits. The footer has always had a centre (the
 *  current element); the toolbar can use it too. */
export type ToolbarSide = 'start' | 'center' | 'end';
export const TOOLBAR_SIDES: readonly ToolbarSide[] = ['start', 'center', 'end'];
/** How a control is labelled. `none` exists only for drop-downs that show their value. */
export type ToolbarLabelMode = 'icon' | 'text' | 'both' | 'none';
/** A bar-wide default: every control can show an icon, its name or both. */
export type ToolbarBarLabel = 'icon' | 'text' | 'both';
export type ToolbarZoomStyle = 'buttons' | 'slider' | 'both';
export type ToolbarLayoutStyle = 'menu' | 'buttons';

export type ToolbarGroup = 'writing' | 'document' | 'view' | 'panels' | 'status';

/**
 * What a control is, which decides how its label can be shown:
 * - `button`: one or more buttons; each shows an icon, its name or both.
 * - `select`: a drop-down that shows its value; it may also show no heading.
 * - `zoom`: zoom out/in buttons, a slider, or both, with the level.
 * - `layout`: the workspace layout switcher, as a menu or a row of buttons.
 * - `status`: a line of the status bar (page, words, save state…): text the
 *   footer shows, which has no icon or label setting of its own.
 */
export type ToolbarItemKind = 'button' | 'select' | 'zoom' | 'layout' | 'status';

export interface ToolbarItemDefinition {
  id: string;
  group: ToolbarGroup;
  kind: ToolbarItemKind;
  /** Label used when the writer has not chosen one; else the bar's default. */
  defaultLabel?: ToolbarLabelMode;
  /** Side of the bar used when the writer has not chosen one. */
  defaultSide?: ToolbarSide;
  /** Never folds into the overflow menu. */
  fixed?: boolean;
  /** Hidden by the phone stylesheet, so it lives in the overflow menu there. */
  desktopOnly?: boolean;
  /** Can sit on the footer only: status lines are not toolbar controls. */
  footerOnly?: boolean;
}

/** Per-control settings. Every field is optional: unset means the default. */
export interface ToolbarItemOptions {
  label?: ToolbarLabelMode;
  side?: ToolbarSide;
  zoomStyle?: ToolbarZoomStyle;
  layoutStyle?: ToolbarLayoutStyle;
  /** Layout ids the switcher leaves out. Absent: it offers every layout. */
  hiddenLayouts?: string[];
  /** The switcher ends with "Edit layouts…" unless this is false. */
  editEntry?: boolean;
}

export interface ToolbarBars {
  top: string[];
  bottom: string[];
}

/**
 * Version of the saved layout. 2 added the status lines as footer items; a
 * layout saved before that gets them where the status bar always drew them.
 */
export const TOOLBAR_LAYOUT_VERSION = 2;

export interface ToolbarLayoutState {
  version: number;
  bars: ToolbarBars;
  options: Record<string, ToolbarItemOptions>;
  labels: Record<ToolbarBar, ToolbarBarLabel>;
}

export interface ToolbarPreset {
  id: string;
  bars: ToolbarBars;
}

/** A layout the writer saved under a name of their own. */
export interface SavedToolbarLayout extends ToolbarLayoutState {
  id: string;
  label: string;
}

/** Prefix of an item a plugin registered in the toolbar slot. */
export const TOOLBAR_PLUGIN_PREFIX = 'plugin:';
/** Prefix of a button that opens one workspace panel. */
export const TOOLBAR_PANEL_PREFIX = 'panel:';

export const TOOLBAR_ITEMS: ToolbarItemDefinition[] = [
  { id: 'undo-redo', group: 'writing', kind: 'button', fixed: true },
  { id: 'element', group: 'writing', kind: 'select', defaultLabel: 'none', fixed: true },
  { id: 'font', group: 'writing', kind: 'select', defaultLabel: 'none', desktopOnly: true },
  { id: 'font-size', group: 'writing', kind: 'select', defaultLabel: 'none', desktopOnly: true },
  { id: 'format', group: 'writing', kind: 'button', desktopOnly: true },
  { id: 'align', group: 'writing', kind: 'button', desktopOnly: true },
  { id: 'search', group: 'writing', kind: 'button' },
  { id: 'notes', group: 'writing', kind: 'button' },
  { id: 'document', group: 'document', kind: 'button' },
  { id: 'title-page', group: 'document', kind: 'button' },
  { id: 'production', group: 'document', kind: 'button' },
  { id: 'views', group: 'view', kind: 'button' },
  { id: 'layout', group: 'view', kind: 'layout', defaultSide: 'end' },
  { id: 'theme', group: 'view', kind: 'button', defaultSide: 'end' },
  /**
   * Zoom: out/in buttons, a slider or both, with the level and Fit width. One
   * control, on whichever bar the writer puts it; it was two before (the
   * toolbar's buttons and #273's footer slider, LEGACY_FOOTER_ZOOM).
   */
  { id: 'zoom', group: 'view', kind: 'zoom', defaultLabel: 'icon', defaultSide: 'end' },
  { id: 'navigator', group: 'panels', kind: 'button' },
  // The status bar's lines, footer only. Their default sides are where the
  // status bar has always drawn them.
  { id: 'status-title', group: 'status', kind: 'status', footerOnly: true },
  { id: 'status-save', group: 'status', kind: 'status', footerOnly: true },
  { id: 'status-element', group: 'status', kind: 'status', footerOnly: true, defaultSide: 'center' },
  { id: 'status-acts', group: 'status', kind: 'status', footerOnly: true, defaultSide: 'end' },
  { id: 'status-runtime', group: 'status', kind: 'status', footerOnly: true, defaultSide: 'end' },
  { id: 'status-words', group: 'status', kind: 'status', footerOnly: true, defaultSide: 'end' },
  { id: 'status-revision', group: 'status', kind: 'status', footerOnly: true, defaultSide: 'end' },
  { id: 'status-progress', group: 'status', kind: 'status', footerOnly: true, defaultSide: 'end' },
  { id: 'status-page', group: 'status', kind: 'status', footerOnly: true, defaultSide: 'end' },
];

/** The status lines, in the order the status bar has always drawn them. */
export const STATUS_ITEM_IDS = TOOLBAR_ITEMS.filter((item) => item.kind === 'status').map((item) => item.id);

/** Whether a control is one of the status bar's lines. */
export function isStatusItem(id: string): boolean {
  return ITEM_KIND_STATUS.has(id);
}
const ITEM_KIND_STATUS: ReadonlySet<string> = new Set(STATUS_ITEM_IDS);

/** Whether a control may go on this bar. */
export function canPlaceOn(id: string, bar: ToolbarBar): boolean {
  return bar === 'bottom' || !toolbarItemDefinition(id)?.footerOnly;
}

const ITEM_BY_ID = new Map(TOOLBAR_ITEMS.map((item) => [item.id, item]));

/** Panel ids a `panel:` button may name; kept in step with workspaceLayout. */
let knownPanelIds: ReadonlySet<string> = new Set();
/** Called by workspaceLayout so the two modules do not import each other. */
export function registerToolbarPanelIds(ids: Iterable<string>): void {
  knownPanelIds = new Set(ids);
}

/** The definition of a control, including panel and plugin controls. */
export function toolbarItemDefinition(id: string): ToolbarItemDefinition | undefined {
  const known = ITEM_BY_ID.get(id);
  if (known) return known;
  if (id.startsWith(TOOLBAR_PANEL_PREFIX)) return { id, group: 'panels', kind: 'button' };
  if (id.startsWith(TOOLBAR_PLUGIN_PREFIX)) return { id, group: 'view', kind: 'button' };
  return undefined;
}

function isKnownItem(id: string): boolean {
  if (ITEM_BY_ID.has(id)) return true;
  if (id.startsWith(TOOLBAR_PLUGIN_PREFIX)) return id.length > TOOLBAR_PLUGIN_PREFIX.length;
  if (id.startsWith(TOOLBAR_PANEL_PREFIX)) {
    const panel = id.slice(TOOLBAR_PANEL_PREFIX.length);
    // Before workspaceLayout registers its ids (tests, early boot) accept any.
    return panel.length > 0 && (knownPanelIds.size === 0 || knownPanelIds.has(panel));
  }
  return false;
}

/** The bars the app has always drawn, so upgrading changes nothing. */
const DEFAULT_TOP = ['undo-redo', 'element', 'font', 'font-size', 'format', 'align', 'search', 'notes'];
/** Zoom sits at the footer's end, where the status bar has had it since #273. */
const DEFAULT_BOTTOM: string[] = [...STATUS_ITEM_IDS, 'zoom'];

/** The footer's own zoom from #273, now the one `zoom` control. */
const LEGACY_FOOTER_ZOOM = 'status-zoom';

export const TOOLBAR_PRESETS: ToolbarPreset[] = [
  { id: 'default', bars: { top: DEFAULT_TOP, bottom: DEFAULT_BOTTOM } },
  {
    id: 'writing',
    bars: { top: ['undo-redo', 'element', 'font', 'font-size', 'format', 'align', 'notes', 'theme'], bottom: DEFAULT_BOTTOM },
  },
  {
    id: 'review',
    bars: { top: ['undo-redo', 'navigator', 'document', 'search', 'views', 'notes', 'layout', 'theme'], bottom: DEFAULT_BOTTOM },
  },
  {
    id: 'everything',
    bars: {
      top: [
        'undo-redo', 'document', 'title-page', 'production', 'element', 'font', 'font-size', 'format', 'align',
        'search', 'views', 'notes', 'navigator', 'layout', 'theme',
      ],
      bottom: DEFAULT_BOTTOM,
    },
  },
];

export const DEFAULT_BAR_LABELS: Record<ToolbarBar, ToolbarBarLabel> = { top: 'icon', bottom: 'text' };

export function defaultToolbarLayout(): ToolbarLayoutState {
  return {
    version: TOOLBAR_LAYOUT_VERSION,
    bars: { top: [...DEFAULT_TOP], bottom: [...DEFAULT_BOTTOM] },
    options: {},
    labels: { ...DEFAULT_BAR_LABELS },
  };
}

export function findToolbarPreset(id: string): ToolbarPreset | undefined {
  return TOOLBAR_PRESETS.find((preset) => preset.id === id);
}

// ── Labels and sides ────────────────────────────────────────────────────

/** Only a drop-down that shows its value can do without a heading. */
export function canShowNoHeading(id: string, options?: ToolbarItemOptions): boolean {
  const def = toolbarItemDefinition(id);
  if (!def) return false;
  if (def.kind === 'select') return true;
  return def.kind === 'layout' && (options?.layoutStyle ?? 'menu') === 'menu';
}

/** The label a control actually shows on a bar. A status line is always its text. */
export function effectiveLabel(id: string, bar: ToolbarBar, state: Pick<ToolbarLayoutState, 'options' | 'labels'>): ToolbarLabelMode {
  if (isStatusItem(id)) return 'text';
  const options = state.options[id];
  const fallback = state.labels[bar] ?? DEFAULT_BAR_LABELS[bar];
  const chosen = options?.label ?? toolbarItemDefinition(id)?.defaultLabel ?? fallback;
  if (chosen === 'none' && !canShowNoHeading(id, options)) return fallback;
  return chosen;
}

/**
 * The zoom control's look on a bar: what the writer chose, or by default the
 * buttons on the toolbar and the slider with its buttons on the footer, as
 * each bar has always had it.
 */
export function effectiveZoomStyle(bar: ToolbarBar, options?: ToolbarItemOptions): ToolbarZoomStyle {
  return options?.zoomStyle ?? (bar === 'bottom' ? 'both' : 'buttons');
}

export function effectiveSide(id: string, options: Record<string, ToolbarItemOptions>): ToolbarSide {
  return options[id]?.side ?? toolbarItemDefinition(id)?.defaultSide ?? 'start';
}

/** A bar's controls split by side, each in the writer's order. */
export function splitBySide(ids: string[], options: Record<string, ToolbarItemOptions>): Record<ToolbarSide, string[]> {
  const sides: Record<ToolbarSide, string[]> = { start: [], center: [], end: [] };
  for (const id of ids) sides[effectiveSide(id, options)].push(id);
  return sides;
}

// ── Normalising saved values ────────────────────────────────────────────

/** The known items in a raw list, in order, without duplicates. */
function cleanItems(raw: unknown, seen: Set<string>): string[] {
  if (!Array.isArray(raw)) return [];
  const items: string[] = [];
  for (const value of raw) {
    if (typeof value !== 'string' || !isKnownItem(value) || seen.has(value)) continue;
    seen.add(value);
    items.push(value);
  }
  return items;
}

const LABELS: ReadonlySet<string> = new Set(['icon', 'text', 'both', 'none']);
const BAR_LABELS: ReadonlySet<string> = new Set(['icon', 'text', 'both']);
const SIDES: ReadonlySet<string> = new Set(TOOLBAR_SIDES);
const ZOOM_STYLES: ReadonlySet<string> = new Set(['buttons', 'slider', 'both']);
const LAYOUT_STYLES: ReadonlySet<string> = new Set(['menu', 'buttons']);

function cleanOptions(raw: unknown): Record<string, ToolbarItemOptions> {
  const out: Record<string, ToolbarItemOptions> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isKnownItem(id) || !value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    const o: ToolbarItemOptions = {};
    if (typeof v.label === 'string' && LABELS.has(v.label)) o.label = v.label as ToolbarLabelMode;
    if (typeof v.side === 'string' && SIDES.has(v.side)) o.side = v.side as ToolbarSide;
    if (typeof v.zoomStyle === 'string' && ZOOM_STYLES.has(v.zoomStyle)) o.zoomStyle = v.zoomStyle as ToolbarZoomStyle;
    if (typeof v.layoutStyle === 'string' && LAYOUT_STYLES.has(v.layoutStyle)) o.layoutStyle = v.layoutStyle as ToolbarLayoutStyle;
    if (Array.isArray(v.hiddenLayouts)) o.hiddenLayouts = v.hiddenLayouts.filter((x): x is string => typeof x === 'string');
    if (typeof v.editEntry === 'boolean') o.editEntry = v.editEntry;
    if (Object.keys(o).length > 0) out[id] = o;
  }
  return out;
}

function cleanLabels(raw: unknown): Record<ToolbarBar, ToolbarBarLabel> {
  const labels = { ...DEFAULT_BAR_LABELS };
  if (raw && typeof raw === 'object') {
    const v = raw as Record<string, unknown>;
    if (typeof v.top === 'string' && BAR_LABELS.has(v.top)) labels.top = v.top as ToolbarBarLabel;
    if (typeof v.bottom === 'string' && BAR_LABELS.has(v.bottom)) labels.bottom = v.bottom as ToolbarBarLabel;
  }
  return labels;
}

/**
 * A saved layout, cleaned up.
 *
 * Unknown ids are dropped so a newer version's layout cannot ask for a control
 * this one does not have; a control can sit on one bar only; an empty or
 * malformed value falls back to the default layout. Plugin ids are kept
 * whether or not the plugin is installed right now: it may come back.
 *
 * `legacyItems` reads the single list PR #217's builds saved.
 */
export function normaliseToolbarLayout(raw: unknown, legacyItems?: unknown): ToolbarLayoutState {
  const fallback = defaultToolbarLayout();
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null;
  const bars = value?.bars && typeof value.bars === 'object' ? value.bars as Record<string, unknown> : null;
  const zoom = oneZoom(bars ? bars.top : legacyItems, bars?.bottom, value?.options);
  const seen = new Set<string>();
  // Status lines cannot go on the toolbar; drop any a hand-edited value put there.
  const top = cleanItems(zoom.top, seen).filter((id) => canPlaceOn(id, 'top'));
  let bottom = cleanItems(zoom.bottom, seen);
  if (top.length === 0 && bottom.length === 0) return fallback;
  const options = cleanOptions(zoom.options);
  const version = typeof value?.version === 'number' ? value.version : 1;
  if (version < 2) bottom = withStatusLines(bottom, options);
  return { version: TOOLBAR_LAYOUT_VERSION, bars: { top, bottom }, options, labels: cleanLabels(value?.labels) };
}

/**
 * One zoom control. A layout from before they were merged may have the
 * toolbar's zoom and the footer's (#273) both; the footer's stays, where the
 * slider and Fit width were, and takes its settings with it. Nothing changes
 * for a layout that has only one of them, or neither.
 */
function oneZoom(rawTop: unknown, rawBottom: unknown, rawOptions: unknown): { top: unknown; bottom: unknown; options: unknown } {
  try {
    const has = (list: unknown) => Array.isArray(list) && list.includes(LEGACY_FOOTER_ZOOM);
    if (!has(rawTop) && !has(rawBottom)) return { top: rawTop, bottom: rawBottom, options: rawOptions };
    const rename = (list: unknown) => (Array.isArray(list)
      ? list.filter((id) => id !== 'zoom').map((id) => (id === LEGACY_FOOTER_ZOOM ? 'zoom' : id))
      : list);
    let options = rawOptions;
    if (rawOptions && typeof rawOptions === 'object') {
      const { [LEGACY_FOOTER_ZOOM]: legacy, zoom: _replaced, ...rest } = rawOptions as Record<string, unknown>;
      void _replaced;
      options = legacy ? { ...rest, zoom: legacy } : rest;
    }
    return { top: rename(rawTop), bottom: rename(rawBottom), options };
  } catch (err) {
    console.warn('[toolbar] could not merge the two zoom controls; keeping the layout as saved', err);
    return { top: rawTop, bottom: rawBottom, options: rawOptions };
  }
}

/**
 * A footer saved before the status lines were items: the lines go where the
 * status bar drew them, the writer's start-side controls before them (where
 * FooterControls drew them) and their end-side controls after.
 */
function withStatusLines(bottom: string[], options: Record<string, ToolbarItemOptions>): string[] {
  const missing = STATUS_ITEM_IDS.filter((id) => !bottom.includes(id));
  const before = bottom.filter((id) => effectiveSide(id, options) === 'start');
  const after = bottom.filter((id) => effectiveSide(id, options) !== 'start');
  return [...before, ...missing, ...after];
}

/**
 * The writer's named layouts, cleaned up. An entry with no usable controls is
 * dropped rather than silently replaced by the default, which is not what
 * saving it meant.
 */
export function normaliseSavedToolbarLayouts(raw: unknown): SavedToolbarLayout[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const layouts: SavedToolbarLayout[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id : '';
    const label = typeof record.label === 'string' ? record.label.trim().slice(0, 40) : '';
    if (!id || !label || seen.has(id)) continue;
    // PR #217 saved `items`; this build saves `bars`.
    const layout = normaliseToolbarLayout(record.bars ? record : null, record.items);
    if (layout.bars.top.length === 0 && layout.bars.bottom.length === 0) continue;
    if (!record.bars && !Array.isArray(record.items)) continue;
    seen.add(id);
    layouts.push({ id, label, ...layout });
  }
  return layouts;
}

// ── Editing ─────────────────────────────────────────────────────────────

/** Where a control is, if it is on a bar. */
export function barOf(bars: ToolbarBars, id: string): ToolbarBar | null {
  if (bars.top.includes(id)) return 'top';
  if (bars.bottom.includes(id)) return 'bottom';
  return null;
}

/**
 * Put a control on a bar, before `before` (or at the end of its side), taking
 * it off wherever it was. Placing it before another control moves it to that
 * control's side, so a drop lands where the writer let go.
 */
export function placeToolbarItem(
  state: ToolbarLayoutState,
  id: string,
  bar: ToolbarBar,
  options: { before?: string | null; side?: ToolbarSide } = {},
): ToolbarLayoutState {
  if (!isKnownItem(id) || !canPlaceOn(id, bar)) return state;
  const { before = null } = options;
  let side = options.side;
  if (before && !side) side = effectiveSide(before, state.options);
  const nextOptions = { ...state.options };
  if (side && side !== effectiveSide(id, state.options)) nextOptions[id] = { ...nextOptions[id], side };
  const bars: ToolbarBars = {
    top: state.bars.top.filter((x) => x !== id),
    bottom: state.bars.bottom.filter((x) => x !== id),
  };
  const list = [...bars[bar]];
  let at = before ? list.indexOf(before) : -1;
  if (at < 0) {
    // The end of the item's side: after the last control on that side.
    const finalSide = side ?? effectiveSide(id, nextOptions);
    let last = -1;
    list.forEach((x, i) => { if (effectiveSide(x, nextOptions) === finalSide) last = i; });
    at = finalSide === 'start' && last < 0 ? 0 : last + 1;
    if (finalSide === 'end' && last < 0) at = list.length;
  }
  list.splice(at, 0, id);
  bars[bar] = list;
  return { ...state, bars, options: nextOptions };
}

/** Take a control off both bars. The toolbar keeps at least one control. */
export function removeToolbarItem(state: ToolbarLayoutState, id: string): ToolbarLayoutState {
  if (state.bars.top.length === 1 && state.bars.top[0] === id) return state;
  return {
    ...state,
    bars: { top: state.bars.top.filter((x) => x !== id), bottom: state.bars.bottom.filter((x) => x !== id) },
  };
}

/** Swap a control with its neighbour on the same side, for the arrow buttons. */
export function shiftToolbarItem(state: ToolbarLayoutState, id: string, delta: -1 | 1): ToolbarLayoutState {
  const bar = barOf(state.bars, id);
  if (!bar) return state;
  const list = [...state.bars[bar]];
  const side = effectiveSide(id, state.options);
  const same = list.filter((x) => effectiveSide(x, state.options) === side);
  const index = same.indexOf(id);
  const target = same[index + delta];
  if (!target) return state;
  const a = list.indexOf(id);
  const b = list.indexOf(target);
  [list[a], list[b]] = [list[b], list[a]];
  return { ...state, bars: { ...state.bars, [bar]: list } };
}

export function setToolbarItemOptions(state: ToolbarLayoutState, id: string, patch: ToolbarItemOptions): ToolbarLayoutState {
  const merged: ToolbarItemOptions = { ...state.options[id], ...patch };
  for (const key of Object.keys(merged) as (keyof ToolbarItemOptions)[]) {
    if (merged[key] === undefined) delete merged[key];
  }
  return { ...state, options: { ...state.options, [id]: merged } };
}

/** Every control the palette can offer, built-in first. */
export function allToolbarItemIds(panelIds: string[], pluginIds: string[]): string[] {
  return [
    ...TOOLBAR_ITEMS.map((item) => item.id),
    ...panelIds.map((id) => `${TOOLBAR_PANEL_PREFIX}${id}`),
    ...pluginIds.map((id) => `${TOOLBAR_PLUGIN_PREFIX}${id}`),
  ];
}
