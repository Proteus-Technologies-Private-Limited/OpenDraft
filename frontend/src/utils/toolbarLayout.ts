/**
 * The toolbar's layout: which controls it shows, in what order, and the
 * presets a writer can start from.
 *
 * The toolbar is device chrome, not part of the script, so the layout lives in
 * the same local view state as the zoom and the Goto Page bookmark list. A
 * writer who arranges the bar on a laptop does not rearrange the iPad's.
 *
 * Plugin items use the `plugin:` prefix and the panel id they registered, so a
 * saved layout survives a plugin being turned off and back on.
 */

export type ToolbarGroup = 'document' | 'format' | 'view';

export interface ToolbarItemDefinition {
  id: string;
  label: string;
  /** One line under the label, for the customise dialog. */
  description: string;
  group: ToolbarGroup;
}

export interface ToolbarPreset {
  id: string;
  label: string;
  description: string;
  items: string[];
}

/** Prefix of an item a plugin registered in the toolbar slot. */
export const TOOLBAR_PLUGIN_PREFIX = 'plugin:';

/**
 * Controls whose place is fixed in the bar, whatever the saved order says.
 * Zoom and the light/dark toggle are pinned to the right of the bar so they
 * never drift as the writer adds and removes controls; the customiser shows
 * them as pinned.
 */
export const TOOLBAR_PINNED_ITEMS: ReadonlySet<string> = new Set(['zoom', 'theme']);

/** A layout the writer saved under a name of their own. */
export interface SavedToolbarLayout {
  id: string;
  label: string;
  items: string[];
}

export const TOOLBAR_ITEMS: ToolbarItemDefinition[] = [
  {
    id: 'undo-redo',
    label: 'Undo and Redo',
    description: 'Undo and redo the last changes.',
    group: 'format',
  },
  {
    id: 'document',
    label: 'File Actions',
    description: 'New, import, save and export the script.',
    group: 'document',
  },
  {
    id: 'navigator',
    label: 'Navigator',
    description: 'Open or close the scene Navigator.',
    group: 'document',
  },
  {
    id: 'title-page',
    label: 'Title Page',
    description: 'Open the title page editor.',
    group: 'document',
  },
  {
    id: 'production',
    label: 'Scene Numbers and Reports',
    description: 'Show scene numbers, or open the Reports.',
    group: 'view',
  },
  {
    id: 'element',
    label: 'Element Picker',
    description: 'The screenplay element menu, with Dual Dialogue.',
    group: 'format',
  },
  {
    id: 'font',
    label: 'Font and Size',
    description: 'The typeface and size of the selection.',
    group: 'format',
  },
  {
    id: 'format',
    label: 'Text Style',
    description: 'Bold, italic, underline, colours and language.',
    group: 'format',
  },
  {
    id: 'align',
    label: 'Alignment',
    description: 'Left, centre, right and justified text.',
    group: 'format',
  },
  {
    id: 'search',
    label: 'Find and Go to Page',
    description: 'Search the script or jump to a page.',
    group: 'format',
  },
  {
    id: 'views',
    label: 'Views',
    description: 'Layout, the full-screen view, panels and the split pane in one menu.',
    group: 'view',
  },
  {
    id: 'theme',
    label: 'Light / Dark',
    description: 'Switch between the light and dark themes.',
    group: 'view',
  },
  {
    id: 'notes',
    label: 'Notes and Tags',
    description: 'Script notes and production tags.',
    group: 'format',
  },
  {
    id: 'zoom',
    label: 'Zoom',
    description: 'Zoom out, the zoom level and zoom in.',
    group: 'view',
  },
];

/** The bar the app has always drawn, so upgrading changes nothing. */
const DEFAULT_ITEMS = [
  'undo-redo',
  'element',
  'font',
  'format',
  'align',
  'search',
  'notes',
  'theme',
  'zoom',
];

export const TOOLBAR_PRESETS: ToolbarPreset[] = [
  {
    id: 'default',
    label: 'Default',
    description: 'The toolbar as it ships, with the light/dark toggle.',
    items: [...DEFAULT_ITEMS],
  },
  {
    id: 'writing',
    label: 'Writing',
    description: 'Only the controls used while drafting.',
    items: ['undo-redo', 'element', 'font', 'format', 'align', 'notes', 'theme'],
  },
  {
    id: 'review',
    label: 'Review',
    description: 'Files, views and notes, with the formatting folded away.',
    items: ['undo-redo', 'navigator', 'document', 'search', 'views', 'notes', 'theme', 'zoom'],
  },
  {
    id: 'everything',
    label: 'Everything',
    description: 'Every built-in control, including the Views menu.',
    items: TOOLBAR_ITEMS.map((item) => item.id),
  },
];

export function defaultToolbarItems(): string[] {
  return [...DEFAULT_ITEMS];
}

export function findToolbarPreset(id: string): ToolbarPreset | undefined {
  return TOOLBAR_PRESETS.find((preset) => preset.id === id);
}

/**
 * A saved layout, cleaned up.
 *
 * Unknown ids are dropped so a script from a newer version cannot ask for a
 * control this one does not have, duplicates are collapsed, and an empty or
 * malformed value falls back to the default bar. Plugin ids are kept whether
 * or not the plugin is installed right now: it may come back.
 */
export function normaliseToolbarItems(raw: unknown): string[] {
  const items = cleanToolbarItems(raw);
  return items.length > 0 ? items : defaultToolbarItems();
}

/** The known items in a raw list, in order, without duplicates. */
function cleanToolbarItems(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const known = new Set(TOOLBAR_ITEMS.map((item) => item.id));
  const seen = new Set<string>();
  const items: string[] = [];
  for (const value of raw) {
    if (typeof value !== 'string') continue;
    if (!known.has(value) && !value.startsWith(TOOLBAR_PLUGIN_PREFIX)) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    items.push(value);
  }
  return items;
}

/**
 * The writer's named layouts, cleaned up. An entry with no usable controls is
 * dropped rather than silently replaced by the default bar, which is not what
 * saving an empty layout meant.
 */
export function normaliseSavedLayouts(raw: unknown): SavedToolbarLayout[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const layouts: SavedToolbarLayout[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id : '';
    const label = typeof record.label === 'string' ? record.label.trim().slice(0, 40) : '';
    if (!id || !label || seen.has(id)) continue;
    const items = cleanToolbarItems(record.items);
    if (items.length === 0) continue;
    seen.add(id);
    layouts.push({ id, label, items });
  }
  return layouts;
}

export function addToolbarItem(items: string[], id: string): string[] {
  return items.includes(id) ? items : [...items, id];
}

/** Never empty: the toolbar has to keep at least one control. */
export function removeToolbarItem(items: string[], id: string): string[] {
  if (items.length <= 1) return items;
  return items.filter((item) => item !== id);
}

/** Swap an item with its neighbour. Out-of-range moves leave the list alone. */
export function moveToolbarItem(items: string[], id: string, delta: number): string[] {
  const index = items.indexOf(id);
  if (index < 0) return items;
  const target = index + delta;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/**
 * Move an item to a position, for drag and drop. `index` is where the item
 * lands after it is lifted out of the list, so dropping on a row puts the item
 * before that row. Out-of-range positions clamp to the ends.
 */
export function moveToolbarItemTo(items: string[], id: string, index: number): string[] {
  const from = items.indexOf(id);
  if (from < 0) return items;
  const target = Math.max(0, Math.min(items.length - 1, index));
  if (from === target) return items;
  const next = [...items];
  next.splice(from, 1);
  next.splice(target, 0, id);
  return next;
}
