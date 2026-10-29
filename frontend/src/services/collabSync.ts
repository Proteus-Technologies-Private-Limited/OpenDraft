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
 */

import * as Y from 'yjs';
import { useEditorStore, type GeneralNote, type NoteInfo } from '../stores/editorStore';
import { normalizeRevisionSettings } from '../editor/revisionColors';
import { normalizeScriptProfile } from '../utils/scriptProfile';
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
let fromYjs = false;
let unsubStore: (() => void) | null = null;
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
 */
export function startCollabSync(ydoc: Y.Doc, isHost: boolean): void {
  stopCollabSync(); // clean up any previous session

  metaMap = ydoc.getMap('metadata');
  tombMap = ydoc.getMap('noteTombstones');

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

  // For guests: apply whatever is already in the Yjs map (host may have seeded it)
  if (!isHost) {
    applyYjsToStore();
  }

  // ── 3. Store → Yjs: subscribe to Zustand store changes ──
  rememberStore();

  unsubStore = useEditorStore.subscribe(() => {
    if (fromYjs || !metaMap) return; // skip if this change originated from Yjs
    const curr = takeSnapshot();
    const prev = prevSnapshot;
    const map = metaMap;

    // Only write keys that actually changed (by stringified value)
    const changed = SYNC_KEYS.filter((key) => !prev || curr[key] !== prev[key]);
    if (changed.length === 0) return;
    // One transaction, so a deletion's tombstone travels with the list it
    // was deleted from.
    ydoc.transact(() => {
      for (const key of NOTE_KEYS) {
        if (changed.includes(key)) recordNoteDeletions(key);
      }
      for (const key of changed) map.set(key, curr[key]);
    });
    prevSnapshot = curr;
  });
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
  prevSnapshot = null;
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
function rememberStore() {
  const s = useEditorStore.getState();
  prevSnapshot = takeSnapshot();
  prevNoteLists = { notes: s.notes, generalNotes: s.generalNotes };
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
