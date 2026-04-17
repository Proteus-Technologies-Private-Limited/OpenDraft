/**
 * Script Structure — parses act and sequence hierarchy from a TipTap document.
 * Acts are delimited by `newAct` / `endOfAct` nodes. Sequences are optional
 * labels stored on scene-heading nodes (`sequenceId` attr) plus a `sequences`
 * array in the document's top-level attrs.
 */
import type { JSONContent } from '@tiptap/react';

export interface StructureScene {
  sceneIndex: number;          // 0-based index within the whole document
  heading: string;
  docPos: number;              // document position of the sceneHeading node
  sequenceId: string | null;
}

export interface StructureSequence {
  id: string;
  name: string;
  color: string;
  scenes: StructureScene[];
}

export interface StructureAct {
  actNumber: number;           // 1-based
  actName: string;             // e.g. "ACT TWO"
  customName: string;          // optional override shown in place of actName
  docPos: number;              // position of the newAct node, or 0 for scenes before any act
  sequences: StructureSequence[];
  /** Scenes not assigned to any sequence, in document order. */
  orphanScenes: StructureScene[];
  /** Every scene in the act (sequence-assigned + orphan), in document order. */
  scenes: StructureScene[];
}

export interface ScriptStructure {
  acts: StructureAct[];
  /** Map of sceneIndex → actNumber (null if no acts exist yet). */
  sceneActMap: Map<number, number | null>;
  /** Flat count of scene-heading nodes in the document. */
  totalScenes: number;
}

const DEFAULT_ACT_NAMES = [
  'ACT ONE', 'ACT TWO', 'ACT THREE', 'ACT FOUR', 'ACT FIVE',
  'ACT SIX', 'ACT SEVEN', 'ACT EIGHT', 'ACT NINE', 'ACT TEN',
];

export function defaultActName(actNumber: number): string {
  if (actNumber >= 1 && actNumber <= DEFAULT_ACT_NAMES.length) {
    return DEFAULT_ACT_NAMES[actNumber - 1];
  }
  return `ACT ${actNumber}`;
}

function getText(node: JSONContent): string {
  if (node.text) return node.text;
  if (!node.content) return '';
  return node.content.map(getText).join('');
}

/**
 * Compute full document structure. Called on demand (not memoized here).
 * Linear scan; O(n) in number of top-level blocks.
 */
export function computeScriptStructure(doc: JSONContent): ScriptStructure {
  const sequencesMeta: StructureSequence[] = (
    (doc.attrs as { sequences?: Array<{ id: string; name: string; color?: string }> } | undefined)
      ?.sequences || []
  ).map((s) => ({
    id: s.id,
    name: s.name || 'Untitled Sequence',
    color: s.color || '#64748b',
    scenes: [],
  }));

  const sequencesById = new Map<string, StructureSequence>();
  sequencesMeta.forEach((seq) => sequencesById.set(seq.id, seq));

  // Track position in the linear document (approximate — we track block index,
  // since TipTap node positions are not directly available from JSON traversal).
  // The first act is implicit ("Prologue") for scenes before any explicit act.
  const acts: StructureAct[] = [];
  const sceneActMap = new Map<number, number | null>();

  const pushImplicitAct = () => {
    acts.push({
      actNumber: 0,
      actName: 'PROLOGUE',
      customName: '',
      docPos: 0,
      sequences: [],
      orphanScenes: [],
      scenes: [],
    });
  };

  let currentAct: StructureAct | null = null;
  let sceneIndex = 0;
  let blockPos = 0;  // approximate TipTap pos — 1 for opening of each block, + size

  // We can't recreate exact ProseMirror positions from JSON alone, but we can
  // keep a running counter that approximates block order, which is enough for
  // "first scene in Act 2" navigation when combined with sceneIndex.
  const children = doc.content || [];
  for (const node of children) {
    blockPos += 1;

    if (node.type === 'newAct') {
      const actNumber = (node.attrs?.actNumber as number) || acts.filter(a => a.actNumber > 0).length + 1;
      const actName = (node.attrs?.actName as string) || defaultActName(actNumber);
      const customName = (node.attrs?.customName as string) || '';
      currentAct = {
        actNumber,
        actName,
        customName,
        docPos: blockPos,
        sequences: [],
        orphanScenes: [],
        scenes: [],
      };
      acts.push(currentAct);
      blockPos += 2;
      continue;
    }

    if (node.type === 'endOfAct') {
      // Close current act — subsequent scenes until next newAct are unassigned
      currentAct = null;
      blockPos += 2;
      continue;
    }

    if (node.type === 'sceneHeading') {
      const heading = getText(node);
      const sequenceId = (node.attrs?.sequenceId as string | undefined) || null;
      const scene: StructureScene = {
        sceneIndex,
        heading,
        docPos: blockPos,
        sequenceId,
      };

      // Target act: current act, or create an implicit Prologue if no acts yet
      let targetAct = currentAct;
      if (!targetAct) {
        if (acts.length === 0 || acts[acts.length - 1].actNumber !== 0) {
          pushImplicitAct();
        }
        targetAct = acts[acts.length - 1];
      }
      targetAct.scenes.push(scene);
      sceneActMap.set(sceneIndex, targetAct.actNumber > 0 ? targetAct.actNumber : null);

      // Attach to sequence if applicable
      if (sequenceId) {
        const sourceSeq = sequencesById.get(sequenceId);
        if (sourceSeq) {
          // Find or create a per-act copy of this sequence so scenes list stays local
          let actSeq = targetAct.sequences.find((s) => s.id === sequenceId);
          if (!actSeq) {
            actSeq = { id: sourceSeq.id, name: sourceSeq.name, color: sourceSeq.color, scenes: [] };
            targetAct.sequences.push(actSeq);
          }
          actSeq.scenes.push(scene);
        } else {
          targetAct.orphanScenes.push(scene);
        }
      } else {
        targetAct.orphanScenes.push(scene);
      }

      sceneIndex++;
      blockPos += 2;
      continue;
    }

    // Other block — rough size estimate for position tracking
    blockPos += Math.max(2, getText(node).length + 2);
  }

  return {
    acts,
    sceneActMap,
    totalScenes: sceneIndex,
  };
}

/**
 * Map a 0-based scene index to "Act N" label, or empty string if no acts.
 * Used by the Scenes tab to render a small act badge next to each scene.
 */
export function sceneActLabel(structure: ScriptStructure, sceneIndex: number): string {
  const actNumber = structure.sceneActMap.get(sceneIndex);
  if (actNumber == null || actNumber <= 0) return '';
  return `A${actNumber}`;
}
