/**
 * Collab Metadata Sync — bridges Yjs shared maps with the Zustand editorStore
 * so that Character Profiles, Notes, Tags, Tag Categories, Beats, and Scene
 * Synopses are synced in real-time across all collaborators.
 *
 * Uses a Y.Map named "metadata" on the Yjs document. Each key holds a JSON
 * string of the corresponding data array. Changes from either side propagate
 * to the other, with a guard flag to prevent infinite loops.
 */

import * as Y from 'yjs';
import { useEditorStore } from '../stores/editorStore';
import { normalizeRevisionSettings } from '../editor/revisionColors';

const SYNC_KEYS = [
  'characterProfiles',
  'characterRelationships',
  'notes',
  'generalNotes',
  'tags',
  'tagCategories',
  'beats',
  'beatColumns',
  'beatArrangeMode',
  // Revision Mode is per script, so every collaborator marks edits the same
  // way — one writer in Revision Mode and another not would leave the draft
  // half-marked.
  'revisionMode',
  'revisionColor',
  'revisionHistory',
  'revisionSettings',
] as const;

type SyncKey = (typeof SYNC_KEYS)[number];

let metaMap: Y.Map<string> | null = null;
let fromYjs = false;
let unsubStore: (() => void) | null = null;

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
      metaMap!.set('beatArrangeMode', JSON.stringify(store.beatArrangeMode));
      metaMap!.set('revisionMode', JSON.stringify(store.revisionMode));
      metaMap!.set('revisionColor', JSON.stringify(store.revisionColor));
      metaMap!.set('revisionHistory', JSON.stringify(store.revisionHistory));
      metaMap!.set('revisionSettings', JSON.stringify(store.revisionSettings));
    });
  }

  // ── 2. Yjs → Store: observe changes from other collaborators ──
  metaMap.observe(yMapObserver);

  // For guests: apply whatever is already in the Yjs map (host may have seeded it)
  if (!isHost) {
    applyYjsToStore();
  }

  // ── 3. Store → Yjs: subscribe to Zustand store changes ──
  let prevSnapshot = takeSnapshot();

  unsubStore = useEditorStore.subscribe(() => {
    if (fromYjs || !metaMap) return; // skip if this change originated from Yjs
    const curr = takeSnapshot();
    const map = metaMap;

    // Only write keys that actually changed (by reference or stringified value)
    for (const key of SYNC_KEYS) {
      if (curr[key] !== prevSnapshot[key]) {
        map.set(key, curr[key]);
      }
    }
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
    beatArrangeMode: JSON.stringify(s.beatArrangeMode),
    revisionMode: JSON.stringify(s.revisionMode),
    revisionColor: JSON.stringify(s.revisionColor),
    revisionHistory: JSON.stringify(s.revisionHistory),
    revisionSettings: JSON.stringify(s.revisionSettings),
  };
}

function yMapObserver(_event: Y.YMapEvent<string>) {
  applyYjsToStore();
}

function applyYjsToStore() {
  if (!metaMap) return;
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

    const n = metaMap.get('notes');
    if (n) {
      try { store.setNotes(JSON.parse(n)); } catch { /* ignore */ }
    }

    const gn = metaMap.get('generalNotes');
    if (gn) {
      try { store.setGeneralNotes(JSON.parse(gn)); } catch { /* ignore */ }
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

    const bam = metaMap.get('beatArrangeMode');
    if (bam) {
      try { const mode = JSON.parse(bam); if (mode === 'auto' || mode === 'custom') store.setBeatArrangeMode(mode); } catch { /* ignore */ }
    }
  } finally {
    fromYjs = false;
  }
}
