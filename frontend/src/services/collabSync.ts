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

const SYNC_KEYS = [
  'characterProfiles',
  'notes',
  'tags',
  'tagCategories',
  'beats',
  'beatColumns',
  'beatArrangeMode',
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
      metaMap!.set('notes', JSON.stringify(store.notes));
      metaMap!.set('tags', JSON.stringify(store.tags));
      metaMap!.set('tagCategories', JSON.stringify(store.tagCategories));
      metaMap!.set('beats', JSON.stringify(store.beats));
      metaMap!.set('beatColumns', JSON.stringify(store.beatColumns));
      metaMap!.set('beatArrangeMode', JSON.stringify(store.beatArrangeMode));
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
    notes: JSON.stringify(s.notes),
    tags: JSON.stringify(s.tags),
    tagCategories: JSON.stringify(s.tagCategories),
    beats: JSON.stringify(s.beats),
    beatColumns: JSON.stringify(s.beatColumns),
    beatArrangeMode: JSON.stringify(s.beatArrangeMode),
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

    const n = metaMap.get('notes');
    if (n) {
      try { store.setNotes(JSON.parse(n)); } catch { /* ignore */ }
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

    const bam = metaMap.get('beatArrangeMode');
    if (bam) {
      try { const mode = JSON.parse(bam); if (mode === 'auto' || mode === 'custom') store.setBeatArrangeMode(mode); } catch { /* ignore */ }
    }
  } finally {
    fromYjs = false;
  }
}
