/**
 * The Sidekick's data: task types, tasks, and the record kept in the script.
 *
 * Two kinds of task type:
 * - `track` — work to finish. A task moves open → in progress → done.
 * - `keep`  — material held for later. A task is kept, and marked used once
 *   it has been put back into the script.
 *
 * Everything here is plain JSON, because it is stored inside the script
 * through `pluginRegistry.setDocumentData` and travels with it through save,
 * .odraft, FDX and Fountain.
 */
import type { JSONContent } from '@tiptap/core';

export const PLUGIN_ID = 'od-sidekick';
export const PANEL_ID = 'od-sidekick-panel';
/** Bump when the stored shape changes; `normalizeData` upgrades older records. */
export const DATA_VERSION = 2;

export type TaskKind = 'track' | 'keep';
export type TextAction = 'copy' | 'move';
export type ScriptLink = 'required' | 'optional' | 'none';
export interface TaskTypeBehavior {
  textAction: TextAction;
  scriptLink: ScriptLink;
}
export type TrackStatus = 'open' | 'in-progress' | 'done';
export type KeepStatus = 'kept' | 'used';
export type TaskStatus = TrackStatus | KeepStatus;

export const TRACK_STATUSES: readonly TrackStatus[] = ['open', 'in-progress', 'done'];
export const KEEP_STATUSES: readonly KeepStatus[] = ['kept', 'used'];

/** Icon names the panel knows how to draw (ui/icons.tsx). */
export type TaskIcon =
  | 'todo' | 'rewrite' | 'dialogue' | 'continuity' | 'research' | 'trim'
  | 'feedback' | 'question' | 'setup' | 'production'
  | 'hold' | 'darling' | 'alternate' | 'idea' | 'reference' | 'custom';

export interface TaskType extends TaskTypeBehavior {
  id: string;
  /** English name; `labelKey` translates it. */
  label: string;
  labelKey?: string;
  /** One line on what belongs here. */
  hint: string;
  hintKey?: string;
  kind: TaskKind;
  /** CSS colour for the chip and the card's edge. */
  color: string;
  icon: TaskIcon;
  /** Shipped with the Sidekick (cannot be deleted, only hidden). */
  builtIn: boolean;
}

/** What was selected, with its formatting, as ProseMirror JSON. */
export interface Excerpt {
  /** The selection's nodes — screenplay elements with their marks. */
  content: JSONContent[];
  /** Slice depths: a selection that starts or ends inside an element is "open" there. */
  openStart: number;
  openEnd: number;
  /** Plain text, for search, previews and formats without formatting. */
  text: string;
}

/** Where in the script the excerpt came from, to find it again. */
export interface TaskSource {
  sceneHeading: string | null;
  sceneUid: string | null;
  /** Place among the scenes, from 0; null before the first heading. */
  sceneIndex: number | null;
  /** The element type the selection started in. */
  elementType: string | null;
  /** Older tasks used text lookup without an explicit navigation mode. */
  navigation?: 'selection' | 'cursor' | 'none';
  anchor?: SourceAnchor;
}

export interface SourceAnchor {
  /** ProseMirror offset from the start of the scene (or the script before it). */
  offset: number;
  /** Nearby text on either side of the position within its scene. */
  before: string;
  after: string;
}

export interface Task {
  id: string;
  typeId: string;
  subject: string;
  /** The writer's own note about it. */
  note: string;
  excerpt: Excerpt;
  source: TaskSource;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  /** When it was done (track) or used (keep). */
  closedAt: string | null;
}

/** The record the Sidekick keeps in a script. */
export interface SidekickData {
  version: number;
  tasks: Task[];
  /** Types the writer added for this script. */
  customTypes: TaskType[];
  /** Built-in types the writer hid from the drop grid (their tasks stay). */
  hiddenTypeIds: string[];
  /** Per-script overrides for the built-in types. */
  typeOverrides: Record<string, TaskTypeBehavior>;
}

const t = (id: string) => ({ labelKey: `${PLUGIN_ID}:types.${id}.label`, hintKey: `${PLUGIN_ID}:types.${id}.hint` });

/**
 * The task types every script starts with: ten to track and five to keep.
 * Colours are mid-tone so they read on both the light and dark themes.
 */
// i18n-ignore-start: built-in task names and hints seed the Sidekick translation resource
const builtInTypes: readonly Omit<TaskType, keyof TaskTypeBehavior>[] = [
  { id: 'todo', label: 'To Do', hint: 'Anything that still needs doing here.', kind: 'track', color: '#4a9eff', icon: 'todo', builtIn: true, ...t('todo') },
  { id: 'rewrite', label: 'Rewrite', hint: 'Works in idea, not yet on the page.', kind: 'track', color: '#e8833a', icon: 'rewrite', builtIn: true, ...t('rewrite') },
  { id: 'dialogue', label: 'Polish Dialogue', hint: 'Lines to sharpen, cut or give a voice.', kind: 'track', color: '#d65db1', icon: 'dialogue', builtIn: true, ...t('dialogue') },
  { id: 'continuity', label: 'Fix Continuity', hint: 'Names, props, times or facts that disagree.', kind: 'track', color: '#e0b100', icon: 'continuity', builtIn: true, ...t('continuity') },
  { id: 'research', label: 'Research / Fact-check', hint: 'Check it is true, legal or accurate.', kind: 'track', color: '#2bb3a3', icon: 'research', builtIn: true, ...t('research') },
  { id: 'trim', label: 'Trim for Length', hint: 'Could be shorter; candidate for a cut.', kind: 'track', color: '#c25450', icon: 'trim', builtIn: true, ...t('trim') },
  { id: 'feedback', label: 'Address Feedback', hint: 'A note from a reader, producer or director.', kind: 'track', color: '#8c6dd8', icon: 'feedback', builtIn: true, ...t('feedback') },
  { id: 'question', label: 'Open Question', hint: 'Something undecided, or to ask a collaborator.', kind: 'track', color: '#5b8def', icon: 'question', builtIn: true, ...t('question') },
  { id: 'setup', label: 'Setup / Payoff', hint: 'A plant that must pay off, or a payoff that needs a plant.', kind: 'track', color: '#3fa34d', icon: 'setup', builtIn: true, ...t('setup') },
  { id: 'production', label: 'Production Check', hint: 'Cost, location, cast or stunt to confirm.', kind: 'track', color: '#9a7b4f', icon: 'production', builtIn: true, ...t('production') },
  { id: 'hold', label: 'Hold for Later', hint: 'Not now — keep it to use somewhere else.', kind: 'keep', color: '#7c8aa5', icon: 'hold', builtIn: true, ...t('hold') },
  { id: 'darling', label: 'Cut but Keep', hint: 'Cut from the draft, too good to throw away.', kind: 'keep', color: '#b0607e', icon: 'darling', builtIn: true, ...t('darling') },
  { id: 'alternate', label: 'Alternate Version', hint: 'Another take on this moment.', kind: 'keep', color: '#5a9bb0', icon: 'alternate', builtIn: true, ...t('alternate') },
  { id: 'idea', label: 'Idea Bank', hint: 'A spark to develop later.', kind: 'keep', color: '#d1a03a', icon: 'idea', builtIn: true, ...t('idea') },
  { id: 'reference', label: 'Reference', hint: 'Keep for tone, research or inspiration.', kind: 'keep', color: '#6f8f6f', icon: 'reference', builtIn: true, ...t('reference') },
];
// i18n-ignore-end

export const DEFAULT_BEHAVIOR: TaskTypeBehavior = { textAction: 'copy', scriptLink: 'required' };

const builtInBehavior: Record<string, Partial<TaskTypeBehavior>> = {
  todo: { scriptLink: 'optional' },
  hold: { textAction: 'move' },
  darling: { textAction: 'move' },
  idea: { scriptLink: 'none' },
};

export const BUILT_IN_TYPES: readonly TaskType[] = builtInTypes.map((type) => ({ ...type, ...DEFAULT_BEHAVIOR, ...builtInBehavior[type.id] }));

export const DEFAULT_TYPE_ID = 'todo';
export const DEFAULT_KEEP_TYPE_ID = 'hold';

export function emptyData(): SidekickData {
  return { version: DATA_VERSION, tasks: [], customTypes: [], hiddenTypeIds: [], typeOverrides: {} };
}

/** Every type a script can use: the built-in ones, then its own. */
export function allTypes(data: SidekickData): TaskType[] {
  return [...BUILT_IN_TYPES.map((type) => ({ ...type, ...data.typeOverrides[type.id] })), ...data.customTypes];
}

/** The types offered for filing (hidden built-ins left out). */
export function visibleTypes(data: SidekickData): TaskType[] {
  const hidden = new Set(data.hiddenTypeIds);
  return allTypes(data).filter((type) => !hidden.has(type.id));
}

export function findType(data: SidekickData, typeId: string): TaskType | undefined {
  return allTypes(data).find((type) => type.id === typeId);
}

/** The first status a new task of this kind gets. */
export function initialStatus(kind: TaskKind): TaskStatus {
  return kind === 'track' ? 'open' : 'kept';
}

/** Whether a task still wants attention: open or in progress, or kept and unused. */
export function isPending(task: Task): boolean {
  return task.status === 'open' || task.status === 'in-progress' || task.status === 'kept';
}

/** A status that fits the kind — a task moved between kinds starts over. */
export function statusForKind(status: TaskStatus, kind: TaskKind): TaskStatus {
  const fits = kind === 'track' ? (TRACK_STATUSES as readonly string[]).includes(status) : (KEEP_STATUSES as readonly string[]).includes(status);
  return fits ? status : initialStatus(kind);
}
