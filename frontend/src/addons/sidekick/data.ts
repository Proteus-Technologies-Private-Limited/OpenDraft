/**
 * Reading and changing the Sidekick record kept in the open script.
 *
 * The record lives in core's plugin document data
 * (`pluginRegistry.getDocumentData(PLUGIN_ID)`), so core saves it with the
 * script, carries it through .odraft, FDX and Fountain, and syncs it to
 * collaborators. This module never stores anything itself.
 *
 * The operations are pure functions over `SidekickData` (easy to test), and
 * `updateData` applies one to the open script.
 */
import { useMemo, useSyncExternalStore } from 'react';
import { pluginRegistry } from '../../plugins/registry';
import {
  DATA_VERSION,
  BUILT_IN_TYPES,
  DEFAULT_BEHAVIOR,
  PLUGIN_ID,
  emptyData,
  findType,
  initialStatus,
  statusForKind,
  type Excerpt,
  type SidekickData,
  type Task,
  type TaskKind,
  type TaskSource,
  type TaskStatus,
  type TaskType,
  type TaskTypeBehavior,
  KEEP_STATUSES,
  TRACK_STATUSES,
} from './model';

// ── Reading ──

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

function normalizeExcerpt(raw: unknown): Excerpt {
  const e = isObject(raw) ? raw : {};
  return {
    content: Array.isArray(e.content) ? (e.content as Excerpt['content']) : [],
    openStart: Number.isInteger(e.openStart) ? (e.openStart as number) : 0,
    openEnd: Number.isInteger(e.openEnd) ? (e.openEnd as number) : 0,
    text: str(e.text),
  };
}

function normalizeSource(raw: unknown): TaskSource {
  const s = isObject(raw) ? raw : {};
  const source: TaskSource = {
    sceneHeading: strOrNull(s.sceneHeading),
    sceneUid: strOrNull(s.sceneUid),
    sceneIndex: Number.isInteger(s.sceneIndex) ? (s.sceneIndex as number) : null,
    elementType: strOrNull(s.elementType),
  };
  if (s.navigation === 'selection' || s.navigation === 'cursor' || s.navigation === 'none') source.navigation = s.navigation;
  if (isObject(s.anchor) && typeof s.anchor.offset === 'number' && Number.isSafeInteger(s.anchor.offset) && s.anchor.offset >= 0) {
    source.anchor = { offset: s.anchor.offset, before: str(s.anchor.before).slice(-32), after: str(s.anchor.after).slice(0, 32) };
  }
  return source;
}

function normalizeBehavior(raw: Record<string, unknown>, fallback: TaskTypeBehavior): TaskTypeBehavior {
  return {
    textAction: raw.textAction === 'move' || raw.textAction === 'copy' ? raw.textAction : fallback.textAction,
    scriptLink: raw.scriptLink === 'required' || raw.scriptLink === 'optional' || raw.scriptLink === 'none' ? raw.scriptLink : fallback.scriptLink,
  };
}

const ALL_STATUSES = new Set<string>([...TRACK_STATUSES, ...KEEP_STATUSES]);

function normalizeType(raw: unknown): TaskType | null {
  if (!isObject(raw) || !str(raw.id) || !str(raw.label)) return null;
  const kind: TaskKind = raw.kind === 'keep' ? 'keep' : 'track';
  return {
    id: str(raw.id),
    label: str(raw.label),
    hint: str(raw.hint),
    kind,
    color: /^#[0-9a-f]{3,8}$/i.test(str(raw.color)) ? str(raw.color) : '#7c8aa5',
    icon: 'custom',
    builtIn: false,
    ...normalizeBehavior(raw, DEFAULT_BEHAVIOR),
  };
}

/**
 * Whatever the script holds, as a record the panel can trust: a missing,
 * older or hand-edited entry never throws, and a task that names a type the
 * script no longer has is kept (shown under "Other") rather than dropped.
 */
export function normalizeData(raw: unknown): SidekickData {
  if (!isObject(raw)) return emptyData();
  const customTypes = (Array.isArray(raw.customTypes) ? raw.customTypes : [])
    .map(normalizeType)
    .filter((type): type is TaskType => type !== null);
  const data: SidekickData = {
    version: DATA_VERSION,
    tasks: [],
    customTypes,
    hiddenTypeIds: (Array.isArray(raw.hiddenTypeIds) ? raw.hiddenTypeIds : []).filter((id): id is string => typeof id === 'string'),
    typeOverrides: {},
  };
  const overrides = isObject(raw.typeOverrides) ? raw.typeOverrides : {};
  for (const type of BUILT_IN_TYPES) {
    const override = overrides[type.id];
    if (isObject(override)) data.typeOverrides[type.id] = normalizeBehavior(override, type);
  }
  const seen = new Set<string>();
  for (const item of Array.isArray(raw.tasks) ? raw.tasks : []) {
    if (!isObject(item) || !str(item.id) || seen.has(str(item.id))) continue;
    seen.add(str(item.id));
    const type = findType(data, str(item.typeId));
    const kind: TaskKind = type?.kind ?? 'track';
    const status = ALL_STATUSES.has(str(item.status)) ? (item.status as TaskStatus) : initialStatus(kind);
    const now = new Date(0).toISOString();
    data.tasks.push({
      id: str(item.id),
      typeId: str(item.typeId, 'todo'),
      subject: str(item.subject),
      note: str(item.note),
      excerpt: normalizeExcerpt(item.excerpt),
      source: normalizeSource(item.source),
      status: statusForKind(status, kind),
      createdAt: str(item.createdAt, now),
      updatedAt: str(item.updatedAt, str(item.createdAt, now)),
      closedAt: strOrNull(item.closedAt),
    });
  }
  return data;
}

/** The open script's record (an empty one when it has none). */
export function readData(): SidekickData {
  return normalizeData(pluginRegistry.getDocumentData(PLUGIN_ID));
}

/**
 * Change the open script's record. Returns an error message instead of
 * throwing, so the panel can show it (e.g. a record over the size limit).
 */
export function updateData(change: (data: SidekickData) => SidekickData): string | null {
  try {
    const current = readData();
    const next = change(current);
    // Nothing changed: writing would only mark the script unsaved.
    if (next === current) return null;
    pluginRegistry.setDocumentData(PLUGIN_ID, next);
    return null;
  } catch (err) {
    console.error('[sidekick] could not save the change to this script', err);
    return err instanceof Error ? err.message : String(err);
  }
}

const subscribe = (onChange: () => void) => pluginRegistry.subscribeDocumentData(onChange);
const snapshot = () => pluginRegistry.getDocumentData(PLUGIN_ID);

/** The open script's record, kept current as it changes (any source). */
export function useSidekickData(): SidekickData {
  // The raw entry keeps its identity until it changes, so it is the snapshot,
  // and the normalised record keeps its identity with it.
  const raw = useSyncExternalStore(subscribe, snapshot, snapshot);
  return useMemo(() => normalizeData(raw), [raw]);
}

// ── Changing (pure) ──

let counter = 0;
/** A short id unique within a script. */
export function newId(prefix: string): string {
  counter = (counter + 1) % 1_000_000;
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}${counter.toString(36)}${random}`;
}

/** A subject from the excerpt: its first line, trimmed to a readable length. */
export function suggestSubject(excerpt: Excerpt, fallback: string): string {
  const firstLine = excerpt.text.split('\n').map((line) => line.trim()).find(Boolean) ?? '';
  if (!firstLine) return fallback;
  return firstLine.length > 60 ? `${firstLine.slice(0, 57).trimEnd()}…` : firstLine;
}

export interface NewTask {
  typeId: string;
  excerpt: Excerpt;
  source: TaskSource;
  subject?: string;
}

export function addTask(data: SidekickData, input: NewTask, now = new Date()): { data: SidekickData; task: Task } {
  const type = findType(data, input.typeId);
  if (!type) throw new Error(`There is no task type "${input.typeId}" in this script.`);
  const stamp = now.toISOString();
  const task: Task = {
    id: newId('task'),
    typeId: type.id,
    subject: (input.subject ?? suggestSubject(input.excerpt, type.label)).trim() || type.label,
    note: '',
    excerpt: input.excerpt,
    source: input.source,
    status: initialStatus(type.kind),
    createdAt: stamp,
    updatedAt: stamp,
    closedAt: null,
  };
  return { data: { ...data, tasks: [task, ...data.tasks] }, task };
}

export type TaskPatch = Partial<Pick<Task, 'subject' | 'note' | 'status' | 'typeId'>>;

export function updateTask(data: SidekickData, id: string, patch: TaskPatch, now = new Date()): SidekickData {
  return {
    ...data,
    tasks: data.tasks.map((task) => {
      if (task.id !== id) return task;
      const next: Task = { ...task, ...patch, updatedAt: now.toISOString() };
      const kind = findType(data, next.typeId)?.kind ?? 'track';
      next.status = statusForKind(next.status, kind);
      const closed = next.status === 'done' || next.status === 'used';
      next.closedAt = closed ? (task.closedAt && task.status === next.status ? task.closedAt : now.toISOString()) : null;
      return next;
    }),
  };
}

export function removeTask(data: SidekickData, id: string): SidekickData {
  return { ...data, tasks: data.tasks.filter((task) => task.id !== id) };
}

/** Put a removed task back where it was (Undo). */
export function restoreTask(data: SidekickData, task: Task, index: number): SidekickData {
  if (data.tasks.some((existing) => existing.id === task.id)) return data;
  const tasks = [...data.tasks];
  tasks.splice(Math.max(0, Math.min(index, tasks.length)), 0, task);
  return { ...data, tasks };
}

export function addCustomType(data: SidekickData, input: Partial<TaskTypeBehavior> & { label: string; kind: TaskKind; color: string; hint?: string }): { data: SidekickData; type: TaskType } {
  const label = input.label.trim();
  if (!label) throw new Error('A task type needs a name.');
  if (data.customTypes.concat().some((type) => type.label.toLowerCase() === label.toLowerCase())) {
    throw new Error(`There is already a task type called "${label}".`);
  }
  const type: TaskType = {
    id: newId('type'),
    label,
    hint: input.hint?.trim() ?? '',
    kind: input.kind,
    color: input.color,
    icon: 'custom',
    builtIn: false,
    ...normalizeBehavior(input, DEFAULT_BEHAVIOR),
  };
  return { data: { ...data, customTypes: [...data.customTypes, type] }, type };
}

export function setTypeBehavior(data: SidekickData, typeId: string, patch: Partial<TaskTypeBehavior>): SidekickData {
  const type = findType(data, typeId);
  if (!type) return data;
  const behavior = normalizeBehavior(patch, type);
  if (type.builtIn) return { ...data, typeOverrides: { ...data.typeOverrides, [typeId]: behavior } };
  return { ...data, customTypes: data.customTypes.map((custom) => custom.id === typeId ? { ...custom, ...behavior } : custom) };
}

/** Remove a type the writer added; refused while tasks still use it. */
export function removeCustomType(data: SidekickData, typeId: string): SidekickData {
  const used = data.tasks.filter((task) => task.typeId === typeId).length;
  if (used > 0) throw new Error(`${used} task${used === 1 ? '' : 's'} still use${used === 1 ? 's' : ''} this type. Move or delete them first.`);
  return { ...data, customTypes: data.customTypes.filter((type) => type.id !== typeId) };
}

export function setTypeHidden(data: SidekickData, typeId: string, hidden: boolean): SidekickData {
  const ids = new Set(data.hiddenTypeIds);
  if (hidden) ids.add(typeId);
  else ids.delete(typeId);
  return { ...data, hiddenTypeIds: [...ids] };
}
