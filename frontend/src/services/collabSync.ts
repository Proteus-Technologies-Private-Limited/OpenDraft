/**
 * Collab Metadata Sync — bridges Yjs shared maps with the Zustand editorStore
 * so that Character Profiles, Notes, Tags, Tag Categories, Beats, and Scene
 * Synopses are synced in real-time across all collaborators.
 *
 * Uses a Y.Map named "metadata" on the Yjs document. Each key holds a JSON
 * string of the corresponding data array. Changes from either side propagate
 * to the other, with a guard flag to prevent infinite loops.
 *
 * Each key is last-writer-wins, except the two notes lists. A notes list that
 * arrives is merged with this copy by note and reply id (utils/noteThreads),
 * and sent back out when the merge added to it, so a reply or note posted
 * while a collaborator was posting theirs is not lost. Deletions are recorded
 * in a second map, "noteTombstones" (id → when deleted), so the merge can tell
 * a note deleted elsewhere from one that has not reached the other side yet.
 * Older versions neither read nor write that map, and see plain notes lists.
 *
 * Plugin document data (pluginRegistry.setDocumentData) has a map of its own,
 * "pluginData", one key per plugin id holding that plugin's JSON, so two
 * collaborators' different plugins never overwrite each other; only two edits
 * to the same plugin's entry race. Older versions kept every plugin's data as
 * one value, "pluginData" in "metadata". That value is still written beside
 * the map for them, and what they write into it is merged back by plugin.
 */

import * as Y from 'yjs';
import { useFormattingTemplateStore, activeTemplateSnapshot } from '../stores/formattingTemplateStore';
import { validTemplatePageLayout } from '../utils/templateSnapshot';
import { useEditorStore, DEFAULT_PAGE_LAYOUT, type GeneralNote, type NoteInfo, type PageLayout } from '../stores/editorStore';
import { normalizeRevisionSettings } from '../editor/revisionColors';
import { normalizeScriptProfile } from '../utils/scriptProfile';
import { currentPluginData, usePluginDataStore, type PluginDocumentData } from '../stores/pluginDataStore';
import { normalizePluginData } from '../utils/pluginData';
import {
  addedNoteIds,
  mergeNoteLists,
  normalizeNoteThread,
  noteListIds,
  removedNoteIds,
  withoutDeletedNotes,
} from '../utils/noteThreads';

const SYNC_KEYS = [
  'characterProfiles',
  'characterRelationships',
  'notes',
  'generalNotes',
  'tags',
  'tagCategories',
  'beats',
  'beatColumns',
  'plotlines',
  'beatArrangeMode',
  // Revision Mode is per script, so every collaborator marks edits the same
  // way — one writer in Revision Mode and another not would leave the draft
  // half-marked.
  'revisionMode',
  'revisionColor',
  'revisionHistory',
  'revisionSettings',
  // Pacing changes everyone's runtime estimate, so it is shared like the rest.
  'scriptProfile',
  // Plugin data is not here: it has a map of its own, one key per plugin
  // (see "Plugin document data" below).
] as const;

type SyncKey = (typeof SYNC_KEYS)[number];

/** The keys merged by id rather than replaced whole. */
const NOTE_KEYS = ['notes', 'generalNotes'] as const;
type NoteKey = (typeof NOTE_KEYS)[number];
type NoteList = Array<NoteInfo | GeneralNote>;

/**
 * How long a deletion is remembered. The shared document is reset when a new
 * session starts, so this only bounds a session kept going for weeks; a copy
 * that comes back after longer than this could bring a deleted note with it.
 */
export const NOTE_TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

let metaMap: Y.Map<string> | null = null;
let tombMap: Y.Map<string> | null = null;
let pluginMap: Y.Map<string> | null = null;
/** The key in "metadata" where older versions keep all plugins' data as one value. */
const LEGACY_PLUGIN_DATA_KEY = 'pluginData';
/** One plugin's entry as last written to or read from Yjs. */
interface PluginEntrySeen { ref: unknown; json: string }
/** The plugin data store's object as last written to or read from Yjs, to skip unchanged updates by reference. */
let prevPluginData: PluginDocumentData | null = null;
let prevPluginEntries = new Map<string, PluginEntrySeen>();
/** Each plugin's JSON in the legacy value as last seen, to tell what an older version changed in it. */
let prevLegacyEntries = new Map<string, string>();
let fromYjs = false;
let unsubStore: (() => void) | null = null;
let unsubTemplates: (() => void) | null = null;
let unsubPluginData: (() => void) | null = null;
let prevFormat: string | null = null;
let prevSharedFormat: string | null = null;
let mayPublishFormat = false;
const FORMAT_KEY = 'documentFormat';
/** The store as last written to or read from Yjs, to tell what changed. */
let prevSnapshot: Record<SyncKey, string> | null = null;
let prevNoteLists: Record<NoteKey, NoteList> | null = null;
/** Ids in the last notes list received from a collaborator (NoteMergeContext.lastRemote). */
let lastRemoteIds: Record<NoteKey, Set<string> | undefined> = { notes: undefined, generalNotes: undefined };
/**
 * A guest takes the first notes list it receives as it is, rather than merging
 * it with whatever notes it had open before joining.
 */
let adoptNextNotes: Record<NoteKey, boolean> = { notes: false, generalNotes: false };

/**
 * Start syncing metadata between the Yjs doc and the Zustand store.
 * Call this after the Yjs doc + provider are set up.
 *
 * @param ydoc  The Yjs document used by the collab session
 * @param isHost  If true, seeds the Yjs map with current store data
 * @param canEditFormat  Whether this participant may publish format/layout changes
 */
export function startCollabSync(
  ydoc: Y.Doc,
  isHost: boolean,
  canEditFormat: () => boolean = () => true,
): void {
  stopCollabSync(); // clean up any previous session

  metaMap = ydoc.getMap('metadata');
  tombMap = ydoc.getMap('noteTombstones');
  pluginMap = ydoc.getMap('pluginData');

  mayPublishFormat = isHost;
  // ── 1. Host seeds Yjs map from current store ──
  if (isHost) {
    const store = useEditorStore.getState();
    ydoc.transact(() => {
      metaMap!.set('characterProfiles', JSON.stringify(store.characterProfiles));
      metaMap!.set('characterRelationships', JSON.stringify(store.characterRelationships));
      metaMap!.set('notes', JSON.stringify(store.notes));
      metaMap!.set('generalNotes', JSON.stringify(store.generalNotes));
      metaMap!.set('tags', JSON.stringify(store.tags));
      metaMap!.set('tagCategories', JSON.stringify(store.tagCategories));
      metaMap!.set('beats', JSON.stringify(store.beats));
      metaMap!.set('beatColumns', JSON.stringify(store.beatColumns));
      metaMap!.set('plotlines', JSON.stringify(store.plotlines));
      metaMap!.set('beatArrangeMode', JSON.stringify(store.beatArrangeMode));
      metaMap!.set('revisionMode', JSON.stringify(store.revisionMode));
      metaMap!.set('revisionColor', JSON.stringify(store.revisionColor));
      metaMap!.set('revisionHistory', JSON.stringify(store.revisionHistory));
      metaMap!.set('revisionSettings', JSON.stringify(store.revisionSettings));
      metaMap!.set('scriptProfile', JSON.stringify(store.scriptProfile));
      seedPluginData();
      if (canEditFormat()) metaMap!.set(FORMAT_KEY, formatSnapshot());
      pruneTombstones(Date.now());
    });
    // What the guests start from, so the merge can tell their deletions.
    lastRemoteIds = { notes: noteListIds(store.notes), generalNotes: noteListIds(store.generalNotes) };
  } else {
    adoptNextNotes = { notes: true, generalNotes: true };
  }

  // ── 2. Yjs → Store: observe changes from other collaborators ──
  metaMap.observe(yMapObserver);
  tombMap.observe(tombstoneObserver);
  pluginMap.observe(pluginMapObserver);

  // For guests: apply whatever is already in the Yjs map (host may have seeded it)
  if (!isHost) {
    applyYjsToStore();
    adoptSharedPluginData();
  }

  // ── 3. Store → Yjs: subscribe to Zustand store changes ──
  rememberStore();

  const publishChanges = () => {
    if (fromYjs || !metaMap) return; // skip if this change originated from Yjs
    const curr = takeSnapshot();
    const prev = prevSnapshot;
    const map = metaMap;

    // Only write keys that actually changed (by stringified value)
    const changed = SYNC_KEYS.filter((key) => !prev || curr[key] !== prev[key]);
    const pluginChanges = pluginDataChanges();
    const format = formatSnapshot();
    const formatChanged = mayPublishFormat && canEditFormat() && format !== prevFormat;
    if (changed.length === 0 && !formatChanged && !pluginChanges) {
      // Do not queue a restricted participant's private changes for later publication.
      prevFormat = format;
      return;
    }
    // One transaction, so a deletion's tombstone travels with the list it
    // was deleted from.
    ydoc.transact(() => {
      for (const key of NOTE_KEYS) {
        if (changed.includes(key)) recordNoteDeletions(key);
      }
      for (const key of changed) map.set(key, curr[key]);
      if (pluginChanges) writePluginChanges(pluginChanges);
      if (formatChanged) map.set(FORMAT_KEY, formatForPublishing(format, prevFormat, map.get(FORMAT_KEY)));
      prevSharedFormat = map.get(FORMAT_KEY) ?? null;
    });
    prevSnapshot = curr;
    prevFormat = format;
  };
  unsubStore = useEditorStore.subscribe(publishChanges);
  unsubTemplates = useFormattingTemplateStore.subscribe(publishChanges);
  unsubPluginData = usePluginDataStore.subscribe(publishChanges);
}

/**
 * Stop syncing and clean up observers/subscriptions.
 */
export function stopCollabSync(): void {
  if (metaMap) {
    metaMap.unobserve(yMapObserver);
    metaMap = null;
  }
  if (tombMap) {
    tombMap.unobserve(tombstoneObserver);
    tombMap = null;
  }
  if (pluginMap) {
    pluginMap.unobserve(pluginMapObserver);
    pluginMap = null;
  }
  prevPluginData = null;
  prevPluginEntries = new Map();
  prevLegacyEntries = new Map();
  prevSnapshot = null;
  prevFormat = null;
  prevSharedFormat = null;
  mayPublishFormat = false;
  unsubTemplates?.();
  unsubTemplates = null;
  unsubPluginData?.();
  unsubPluginData = null;
  prevNoteLists = null;
  lastRemoteIds = { notes: undefined, generalNotes: undefined };
  adoptNextNotes = { notes: false, generalNotes: false };
  if (unsubStore) {
    unsubStore();
    unsubStore = null;
  }
  fromYjs = false;
}

// ── Internal helpers ──

function takeSnapshot(): Record<SyncKey, string> {
  const s = useEditorStore.getState();
  return {
    characterProfiles: JSON.stringify(s.characterProfiles),
    characterRelationships: JSON.stringify(s.characterRelationships),
    notes: JSON.stringify(s.notes),
    generalNotes: JSON.stringify(s.generalNotes),
    tags: JSON.stringify(s.tags),
    tagCategories: JSON.stringify(s.tagCategories),
    beats: JSON.stringify(s.beats),
    beatColumns: JSON.stringify(s.beatColumns),
    plotlines: JSON.stringify(s.plotlines),
    beatArrangeMode: JSON.stringify(s.beatArrangeMode),
    revisionMode: JSON.stringify(s.revisionMode),
    revisionColor: JSON.stringify(s.revisionColor),
    revisionHistory: JSON.stringify(s.revisionHistory),
    revisionSettings: JSON.stringify(s.revisionSettings),
    scriptProfile: JSON.stringify(s.scriptProfile),
  };
}

/** Note what the store holds now as already in Yjs. */
function formatSnapshot(): string {
  const templates = useFormattingTemplateStore.getState();
  const store = useEditorStore.getState();
  const template = activeTemplateSnapshot();
  return JSON.stringify({
    _templateId: templates.activeTemplateId,
    ...(template != null ? { _templateSnapshot: template } : {}),
    _pageLayout: store.pageLayout,
    _sceneHeadingSpaceBefore: store.sceneHeadingSpaceBefore,
  });
}

/** Layout edits must not promote a different same-ID local library definition. */
function formatForPublishing(current: string, previous: string | null, shared: string | undefined): string {
  if (!previous || !shared) return current;
  const next = JSON.parse(current);
  const before = JSON.parse(previous);
  if (next._templateId !== before._templateId || JSON.stringify(next._templateSnapshot) !== JSON.stringify(before._templateSnapshot)) return current;
  let packet: unknown;
  try { packet = JSON.parse(shared); } catch { return current; }
  if (!packet || typeof packet !== 'object' || Array.isArray(packet)
    || !('_templateId' in packet) || !(packet._templateId === null || typeof packet._templateId === 'string')) return current;
  return JSON.stringify({
    ...packet,
    _pageLayout: next._pageLayout,
    _sceneHeadingSpaceBefore: next._sceneHeadingSpaceBefore,
  });
}

function applySharedFormat(raw: string): void {
  const packet = JSON.parse(raw) as Record<string, unknown>;
  if (!packet || typeof packet !== 'object' || !(packet._templateId === null || typeof packet._templateId === 'string')) return;
  const id = packet._templateId;
  const layout = packet._pageLayout;
  if (layout != null && !validTemplatePageLayout(layout)) return;
  mayPublishFormat = true;
  useFormattingTemplateStore.getState().restoreDocumentTemplate(id, packet._templateSnapshot);
  if (layout) useEditorStore.getState().setPageLayout({ ...DEFAULT_PAGE_LAYOUT, ...layout as Partial<PageLayout> });
  const spacing = packet._sceneHeadingSpaceBefore;
  if (spacing === null || (typeof spacing === 'number' && Number.isFinite(spacing) && spacing >= 0)) useEditorStore.getState().setSceneHeadingSpaceBefore(spacing);
}

function rememberStore() {
  const s = useEditorStore.getState();
  prevSnapshot = takeSnapshot();
  prevFormat = formatSnapshot();
  prevSharedFormat = metaMap?.get(FORMAT_KEY) ?? null;
  prevNoteLists = { notes: s.notes, generalNotes: s.generalNotes };
  rememberPluginData();
}

const isDeleted = (id: string) => !!tombMap?.has(id);

/**
 * Record what was just deleted from a notes list here, and forget the
 * deletion of anything that has just come back under its old id.
 */
function recordNoteDeletions(key: NoteKey) {
  const prev = prevNoteLists?.[key];
  const next = useEditorStore.getState()[key];
  if (!tombMap || !prevNoteLists || !prev) return;
  const now = new Date().toISOString();
  for (const id of removedNoteIds(prev, next)) tombMap.set(id, now);
  for (const id of addedNoteIds(prev, next)) {
    if (tombMap.has(id)) tombMap.delete(id);
  }
  prevNoteLists = { ...prevNoteLists, [key]: next };
}

/** Forget deletions older than NOTE_TOMBSTONE_TTL_MS, and any whose date is unreadable. */
function pruneTombstones(now: number) {
  if (!tombMap) return;
  const stale: string[] = [];
  tombMap.forEach((at, id) => {
    const t = typeof at === 'string' ? Date.parse(at) : NaN;
    if (!Number.isFinite(t) || now - t > NOTE_TOMBSTONE_TTL_MS) stale.push(id);
  });
  for (const id of stale) tombMap.delete(id);
}

function setNoteList(key: NoteKey, list: NoteList) {
  const store = useEditorStore.getState();
  if (key === 'notes') store.setNotes(list as typeof store.notes);
  else store.setGeneralNotes(list as typeof store.generalNotes);
}

/**
 * Take a notes list from a collaborator: merged with this copy, or as it is
 * for a guest's first. Returns true when the result differs from what
 * arrived, so this copy has to go back out.
 */
function applyRemoteNotes(key: NoteKey, raw: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn(`[collabSync] could not read ${key} from a collaborator`, err);
    return false;
  }
  if (!Array.isArray(parsed)) {
    console.warn(`[collabSync] ${key} from a collaborator is not a list; ignored`);
    return false;
  }
  // Repaired first, as setNotes would, so the merge compares like with like.
  const remote = (parsed as NoteList).map(normalizeNoteThread) as NoteList;
  const local = useEditorStore.getState()[key];
  const lastRemote = lastRemoteIds[key];
  lastRemoteIds[key] = noteListIds(remote);
  if (adoptNextNotes[key]) {
    adoptNextNotes[key] = false;
    setNoteList(key, remote);
    return false;
  }
  const merged = mergeNoteLists<NoteList[number]>(local, remote, { isDeleted, lastRemote });
  setNoteList(key, merged);
  return merged !== remote;
}

/** Take deleted notes and replies out of this copy. True when there were any. */
function dropDeletedNotes(key: NoteKey): boolean {
  const list = useEditorStore.getState()[key];
  const live = withoutDeletedNotes<NoteList[number]>(list, isDeleted);
  if (live === list) return false;
  setNoteList(key, live);
  return true;
}

/** Send this copy's notes lists out again after a merge changed them. */
function writeBackNotes(keys: NoteKey[]) {
  const map = metaMap;
  if (!map || keys.length === 0) return;
  const s = useEditorStore.getState();
  const write = () => {
    for (const key of keys) map.set(key, JSON.stringify(s[key]));
  };
  if (map.doc) map.doc.transact(write);
  else write();
  rememberStore();
}

function yMapObserver(event: Y.YMapEvent<string>) {
  // Our own writes are already in the store.
  if (event.transaction.local) return;
  applyYjsToStore();
  // The all-plugins value changed with no per-plugin write beside it: an
  // older version wrote it.
  if (!event.keysChanged.has(LEGACY_PLUGIN_DATA_KEY)) return;
  try {
    if (pluginMap && [...event.transaction.changed.keys()].some((t) => (t as unknown) === pluginMap)) {
      // This version wrote it with the per-plugin map: note it as seen, so
      // an older version's next write is compared with what it saw.
      const legacy = readLegacyPluginData();
      if (legacy) prevLegacyEntries = legacy.entries;
    } else {
      mergeLegacyPluginData();
    }
  } catch (err) {
    console.warn('[collabSync] could not merge plugin data from a collaborator on an older version', err);
  }
}

/**
 * A collaborator deleted something. Usually the list it was deleted from
 * changed in the same transaction and applyYjsToStore deals with both; when
 * that list lost to somebody else's, the tombstone is all that arrives.
 */
function tombstoneObserver(event: Y.YMapEvent<string>) {
  if (event.transaction.local || [...event.transaction.changed.keys()].some((t) => (t as unknown) === metaMap)) return;
  const changed: NoteKey[] = [];
  fromYjs = true;
  try {
    for (const key of NOTE_KEYS) {
      if (dropDeletedNotes(key)) changed.push(key);
    }
  } catch (err) {
    console.warn('[collabSync] could not apply notes deleted by a collaborator', err);
  } finally {
    fromYjs = false;
  }
  rememberStore();
  writeBackNotes(changed);
}

function applyYjsToStore() {
  if (!metaMap) return;
  const writeBack: NoteKey[] = [];
  fromYjs = true;
  try {
    const store = useEditorStore.getState();
    const format = metaMap.get(FORMAT_KEY);
    if (format && format !== prevSharedFormat) {
      try { applySharedFormat(format); } catch (err) { console.warn('[collabSync] could not apply document format', err); }
    }

    const cp = metaMap.get('characterProfiles');
    if (cp) {
      try { store.setCharacterProfiles(JSON.parse(cp)); } catch { /* ignore */ }
    }

    const cr = metaMap.get('characterRelationships');
    if (cr) {
      try { store.setCharacterRelationships(JSON.parse(cr)); } catch { /* ignore */ }
    }

    // Merged only when changed: the merge reads an arrival against the last
    // one, and an unchanged list is not a new arrival.
    for (const key of NOTE_KEYS) {
      try {
        const raw = metaMap.get(key);
        let differs = false;
        if (raw && raw !== prevSnapshot?.[key]) differs = applyRemoteNotes(key, raw);
        // A deletion can arrive beside a list that does not show it yet.
        if (dropDeletedNotes(key)) differs = true;
        if (differs) writeBack.push(key);
      } catch (err) {
        console.warn(`[collabSync] could not merge ${key} from a collaborator`, err);
      }
    }

    const t = metaMap.get('tags');
    if (t) {
      try { store.setTags(JSON.parse(t)); } catch { /* ignore */ }
    }

    const tc = metaMap.get('tagCategories');
    if (tc) {
      try { store.setTagCategories(JSON.parse(tc)); } catch { /* ignore */ }
    }

    const b = metaMap.get('beats');
    if (b) {
      try { store.setBeats(JSON.parse(b)); } catch { /* ignore */ }
    }

    const bc = metaMap.get('beatColumns');
    if (bc) {
      try { store.setBeatColumns(JSON.parse(bc)); } catch { /* ignore */ }
    }

    const pl = metaMap.get('plotlines');
    if (pl) {
      try { store.setPlotlines(JSON.parse(pl)); } catch { /* ignore */ }
    }

    const rm = metaMap.get('revisionMode');
    const rc = metaMap.get('revisionColor');
    const rh = metaMap.get('revisionHistory');
    const rs = metaMap.get('revisionSettings');
    if (rm || rc || rh || rs) {
      try {
        const patch: Partial<Pick<ReturnType<typeof useEditorStore.getState>, 'revisionMode' | 'revisionColor' | 'revisionHistory' | 'revisionSettings'>> = {};
        if (rm) { const v = JSON.parse(rm); if (typeof v === 'boolean') patch.revisionMode = v; }
        if (rc) { const v = JSON.parse(rc); if (typeof v === 'string' && v) patch.revisionColor = v; }
        if (rh) { const v = JSON.parse(rh); if (Array.isArray(v)) patch.revisionHistory = v; }
        // Only when it differs: a fresh object for the same settings would redraw
        // the marks, and every redraw ends the writer's undo group.
        if (rs) {
          const next = normalizeRevisionSettings(rs);
          if (JSON.stringify(next) !== JSON.stringify(useEditorStore.getState().revisionSettings)) patch.revisionSettings = next;
        }
        // Set directly: the setters also record the colour in the history,
        // which here arrives from the peer already recorded.
        useEditorStore.setState(patch);
      } catch (err) {
        console.warn('[collabSync] could not apply revision state', err);
      }
    }

    const sp = metaMap.get('scriptProfile');
    if (sp) {
      try {
        const next = normalizeScriptProfile(sp);
        if (JSON.stringify(next) !== JSON.stringify(useEditorStore.getState().scriptProfile)) {
          store.setScriptProfile(next);
        }
      } catch (err) {
        console.warn('[collabSync] could not apply script profile', err);
      }
    }

    const bam = metaMap.get('beatArrangeMode');
    if (bam) {
      try { const mode = JSON.parse(bam); if (mode === 'auto' || mode === 'custom') store.setBeatArrangeMode(mode); } catch { /* ignore */ }
    }
  } finally {
    fromYjs = false;
  }
  rememberStore();
  writeBackNotes(writeBack);
}

// ── Plugin document data ──
//
// One key per plugin id in the "pluginData" map, holding that plugin's JSON.
// The all-plugins value older versions read and write ("pluginData" in
// "metadata") is kept up to date beside it, built from the same JSON.

interface PluginChanges {
  set: Map<string, string>;
  removed: string[];
  entries: Map<string, PluginEntrySeen>;
}

function entryJson(id: string, value: unknown): string | null {
  try {
    const json = JSON.stringify(value);
    return json === undefined ? null : json;
  } catch (err) {
    console.warn(`[collabSync] could not share the "${id}" plugin's data`, err);
    return null;
  }
}

/**
 * Each plugin's entry in `data` with its JSON. An entry that is the same
 * object as last time keeps the JSON it had: setEntry leaves the other
 * plugins' entries as they were, so only the one that changed is serialized.
 */
function describePluginData(data: PluginDocumentData): Map<string, PluginEntrySeen> {
  const out = new Map<string, PluginEntrySeen>();
  for (const [id, value] of Object.entries(data)) {
    const seen = prevPluginEntries.get(id);
    if (seen && seen.ref === value) {
      out.set(id, seen);
      continue;
    }
    const json = entryJson(id, value);
    if (json !== null) out.set(id, { ref: value, json });
  }
  return out;
}

/** Note the plugin data store as it is now as already shared. */
function rememberPluginData() {
  const data = currentPluginData();
  if (data === prevPluginData) return;
  prevPluginEntries = describePluginData(data);
  prevPluginData = data;
}

/**
 * What changed in the plugin data since it was last shared, or null. The
 * store's object is replaced on every change, so an unchanged reference —
 * every editor-store or template change — costs nothing.
 */
function pluginDataChanges(): PluginChanges | null {
  const data = currentPluginData();
  if (data === prevPluginData) return null;
  const entries = describePluginData(data);
  const set = new Map<string, string>();
  for (const [id, entry] of entries) {
    if (prevPluginEntries.get(id)?.json !== entry.json) set.set(id, entry.json);
  }
  const removed = [...prevPluginEntries.keys()].filter((id) => !entries.has(id));
  prevPluginData = data;
  prevPluginEntries = entries;
  if (set.size === 0 && removed.length === 0) return null;
  return { set, removed, entries };
}

/** The all-plugins value for older versions, from JSON already made. */
function writeLegacyPluginData(entries: Map<string, PluginEntrySeen>) {
  if (!metaMap) return;
  const parts: string[] = [];
  for (const [id, entry] of entries) parts.push(`${JSON.stringify(id)}:${entry.json}`);
  metaMap.set(LEGACY_PLUGIN_DATA_KEY, `{${parts.join(',')}}`);
  prevLegacyEntries = new Map([...entries].map(([id, entry]) => [id, entry.json]));
}

/** Inside a transaction: this copy's plugin changes, by plugin. */
function writePluginChanges(changes: PluginChanges) {
  if (!pluginMap) return;
  for (const [id, json] of changes.set) pluginMap.set(id, json);
  for (const id of changes.removed) pluginMap.delete(id);
  writeLegacyPluginData(changes.entries);
}

/** Inside the host's seeding transaction: the shared plugin data becomes the host's. */
function seedPluginData() {
  if (!pluginMap) return;
  const entries = describePluginData(currentPluginData());
  const stale: string[] = [];
  pluginMap.forEach((_json, id) => { if (!entries.has(id)) stale.push(id); });
  for (const id of stale) pluginMap.delete(id);
  for (const [id, entry] of entries) {
    if (pluginMap.get(id) !== entry.json) pluginMap.set(id, entry.json);
  }
  writeLegacyPluginData(entries);
}

function setPluginDataFromYjs(next: PluginDocumentData) {
  fromYjs = true;
  try {
    usePluginDataStore.getState().setAll(next);
  } finally {
    fromYjs = false;
  }
}

/** The store becomes what the per-plugin map holds. */
function applyPluginMapToStore() {
  if (!pluginMap) return;
  const map = pluginMap;
  const current = currentPluginData();
  const next: PluginDocumentData = {};
  let differs = false;
  map.forEach((json, id) => {
    const seen = prevPluginEntries.get(id);
    if (seen && seen.json === json && current[id] === seen.ref) {
      next[id] = seen.ref;
      return;
    }
    try {
      next[id] = JSON.parse(json);
      differs = true;
    } catch (err) {
      console.warn(`[collabSync] the "${id}" plugin's data from a collaborator is unreadable; kept this copy's`, err);
      if (id in current) next[id] = current[id];
    }
  });
  for (const id of Object.keys(current)) {
    if (!map.has(id)) differs = true;
  }
  if (differs) setPluginDataFromYjs(next);
  rememberPluginData();
}

function pluginMapObserver(event: Y.YMapEvent<string>) {
  if (event.transaction.local) return;
  try {
    applyPluginMapToStore();
  } catch (err) {
    console.warn('[collabSync] could not apply plugin data from a collaborator', err);
  }
}

/** Each plugin's JSON in the all-plugins value, or null when it is absent. */
function readLegacyPluginData(): { data: PluginDocumentData; entries: Map<string, string> } | null {
  const raw = metaMap?.get(LEGACY_PLUGIN_DATA_KEY);
  if (raw === undefined) return null;
  const data = normalizePluginData(raw);
  const entries = new Map<string, string>();
  for (const [id, value] of Object.entries(data)) {
    const json = entryJson(id, value);
    if (json !== null) entries.set(id, json);
  }
  return { data, entries };
}

/**
 * An older version wrote the all-plugins value. Take only the plugins it
 * changed since the value was last seen — the rest of it may be its stale
 * copy of what another collaborator changed meanwhile — and pass them on in
 * the per-plugin map. With `adopt` (a guest joining a session that has no
 * per-plugin data yet) the value is taken whole, as before.
 */
function mergeLegacyPluginData(adopt = false) {
  if (!pluginMap) return;
  const legacy = readLegacyPluginData();
  if (!legacy) return;
  const current = currentPluginData();
  const next: PluginDocumentData = adopt ? {} : { ...current };
  const changedIds: string[] = [];
  const removedIds: string[] = [];
  for (const [id, json] of legacy.entries) {
    if (!adopt && (prevLegacyEntries.get(id) === json || pluginMap.get(id) === json)) continue;
    next[id] = legacy.data[id];
    changedIds.push(id);
  }
  if (!adopt) {
    for (const id of prevLegacyEntries.keys()) {
      if (!legacy.entries.has(id) && id in next) {
        delete next[id];
        removedIds.push(id);
      }
    }
  }
  prevLegacyEntries = legacy.entries;
  const storeChanged = adopt
    ? JSON.stringify(next) !== JSON.stringify(current)
    : changedIds.length > 0 || removedIds.length > 0;
  if (storeChanged) setPluginDataFromYjs(next);
  // Into the per-plugin map, so this version's collaborators (and anyone
  // who joins later) have it by plugin too.
  const map = pluginMap;
  const write = () => {
    for (const id of changedIds) {
      const json = legacy.entries.get(id);
      if (json !== undefined && map.get(id) !== json) map.set(id, json);
    }
    for (const id of removedIds) map.delete(id);
  };
  if (changedIds.length > 0 || removedIds.length > 0) {
    if (map.doc) map.doc.transact(write);
    else write();
  }
  rememberPluginData();
}

/** A guest joining: take the shared plugin data, by plugin or (from an older host) whole. */
function adoptSharedPluginData() {
  try {
    if (pluginMap && pluginMap.size > 0) {
      applyPluginMapToStore();
      const legacy = readLegacyPluginData();
      if (legacy) prevLegacyEntries = legacy.entries;
    } else {
      mergeLegacyPluginData(true);
    }
  } catch (err) {
    console.warn('[collabSync] could not apply the shared plugin data', err);
  }
}
