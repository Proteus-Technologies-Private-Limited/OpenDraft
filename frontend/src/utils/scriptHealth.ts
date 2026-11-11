/** Local, deterministic checks. No model, network access, grading or edits. */
import type { Node as PmNode } from '@tiptap/pm/model';
import { collectNumberedElements } from '../editor/extensions/ElementNumbers';
import type { FormattingTemplate } from '../stores/formattingTypes';
import { noteAnchors } from './noteAnchors';
import { assignElementNumbers, numberingRulesOf, type NumberingRules } from './elementNumbers';
import { numberingGroups } from './lockedElementNumbers';
import { isNonPrintingType } from './nonPrinting';
import { isTitlePageRuleId } from '../stores/formattingTypes';

export type HealthCheck = 'emptyScript' | 'emptyScene' | 'duplicateScene' | 'duplicateElement'
  | 'emptyCue' | 'missingDialogue' | 'orphanDialogue' | 'orphanParenthetical' | 'openNote';

export interface HealthFinding {
  check: HealthCheck;
  /** A text selection in this exact immutable document; null for lost anchors. */
  position: number | null;
  scene: string | null;
  sceneNumber?: string | null;
  excerpt: string;
  reference?: string;
  noteId?: string;
}

export interface HealthNote {
  id: string;
  content: string;
  resolved?: boolean;
  replies?: readonly { content?: string }[];
}

export interface HealthOptions {
  numbering: NumberingRules;
  sceneNumbersVisible: boolean;
  /** Only enable cue/dialogue checks when the format uses that Enter flow. */
  dialogueChecks: boolean;
  notes: readonly HealthNote[];
}

export function healthOptionsForFormat(rules: FormattingTemplate['rules'], sceneNumbersVisible: boolean, notes: readonly HealthNote[]): HealthOptions {
  return { numbering: numberingRulesOf(rules), sceneNumbersVisible, notes,
    dialogueChecks: !!rules.character?.enabled && !!rules.dialogue?.enabled && rules.character.nextOnEnter === 'dialogue' };
}

const excerpt = (text: string) => text.replace(/\s+/gu, ' ').trim().slice(0, 180);
const ignored = (type: string) => type === 'titlePage' || isNonPrintingType(type) || isTitlePageRuleId(type);

export function analyzeScriptHealth(doc: PmNode, options: HealthOptions): HealthFinding[] {
  const findings: HealthFinding[] = [];
  const found = collectNumberedElements(doc);
  const scenes = new Map<number, string | null>();
  const sceneScopes = new Map<number, number>();
  const sceneNumbers = new Map<number, string | null>();
  let currentNumber: string | null = null;
  let namedSceneOrdinal = 0;
  let currentScene: string | null = null;
  let sceneOrdinal = 0;
  found.forEach((block, index) => {
    if (block.node.type.name === 'sceneHeading') {
      currentScene = excerpt(block.node.textContent) || null;
      sceneOrdinal++;
      if (currentScene) namedSceneOrdinal++;
      const stored = block.node.attrs.sceneNumber;
      currentNumber = stored != null && String(stored).trim() ? String(stored) : currentScene ? String(namedSceneOrdinal) : null;
    }
    scenes.set(index, currentScene);
    sceneNumbers.set(index, currentNumber);
    sceneScopes.set(index, sceneOrdinal);
  });
  const indexAt = (position: number | null) => {
    let index = -1;
    if (position !== null) {
      let low = 0, high = found.length - 1;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (found[mid].from <= position) { index = mid; low = mid + 1; }
        else high = mid - 1;
      }
    }
    return index;
  };
  const addBlock = (index: number, check: HealthCheck, reference?: string) => {
    const block = found[index];
    findings.push({ check, reference, position: block.from + 1,
      scene: scenes.get(index) ?? null, excerpt: excerpt(block.node.textContent) });
  };

  // Compare full labels within the same counter/reset scope, including countWith.
  // Unconfigured imported references are compared per element type and scene:
  // without a counter definition, there is no basis for assuming global scope.
  const items = found.map((block) => block.item);
  const labels = assignElementNumbers(items, options.numbering, { sceneNumbersVisible: options.sceneNumbersVisible });
  const groups = numberingGroups(items, options.numbering);
  const imported = new Map<string, number[]>();
  found.forEach((block, index) => {
    if (options.numbering[block.item.elementId] || !block.item.number) return;
    const key = JSON.stringify([block.item.elementId, sceneScopes.get(index)]);
    const group = imported.get(key) ?? [];
    group.push(index);
    imported.set(key, group);
  });
  const duplicates = (indices: number[], labelAt: (index: number) => string | null, check: HealthCheck) => {
    const byLabel = new Map<string, number[]>();
    for (const index of indices) {
      const label = labelAt(index)?.trim();
      if (!label) continue;
      const key = label.toUpperCase();
      const same = byLabel.get(key) ?? [];
      same.push(index);
      byLabel.set(key, same);
    }
    for (const same of byLabel.values()) {
      if (same.length > 1) same.forEach((index) => addBlock(index, check, labelAt(index)!.trim()));
    }
  };
  for (const group of [...groups, ...imported.values()]) {
    duplicates(group, (index) => labels[index], 'duplicateElement');
  }
  const headings = found.flatMap((block, index) => block.node.type.name === 'sceneHeading' ? [index] : []);
  duplicates(headings, (index) => {
    const value: unknown = found[index].node.attrs.sceneNumber;
    return typeof value === 'string' ? value : null;
  }, 'duplicateScene');
  for (const index of headings) if (!found[index].node.textContent.trim()) addBlock(index, 'emptyScene');

  let printable = false;
  const anchors = noteAnchors(doc);
  doc.descendants((node) => {
    if (ignored(node.type.name)) return false;
    if (node.isText && node.textContent.trim()) printable = true;
    return true;
  });
  if (!printable) findings.push({ check: 'emptyScript', position: null, scene: null, excerpt: '' });

  // Each column is its own speech flow. Never carry a speaker across a scene,
  // act, action, AV body or the opposite column of a dual-dialogue container.
  if (options.dialogueChecks) {
    const scan = (parent: PmNode, contentStart: number, initialScene: string | null) => {
      let scene = initialScene;
      let cue: { node: PmNode; position: number } | null = null;
      let spoken = false;
      const flush = () => {
        if (cue && cue.node.textContent.trim() && !spoken) findings.push({ check: 'missingDialogue', position: cue.position,
          scene, excerpt: excerpt(cue.node.textContent) });
        cue = null;
        spoken = false;
      };
      parent.forEach((node, offset) => {
        const type = node.type.name;
        const position = contentStart + offset + 1;
        if (ignored(type) || (type === 'customElement' && node.attrs.customTypeId === 'stageDirection')) return;
        if (type === 'dualDialogue') {
          flush();
          node.forEach((column, columnOffset) => scan(column, position + columnOffset + 1, scene));
          return;
        }
        if (type === 'sceneHeading') {
          flush();
          scene = excerpt(node.textContent) || null;
          return;
        }
        if (type === 'character') {
          flush();
          cue = { node, position };
          if (!node.textContent.trim()) findings.push({ check: 'emptyCue', position, scene, excerpt: '' });
          return;
        }
        if (type === 'dialogue' || type === 'parenthetical') {
          if (!node.textContent.trim()) return;
          if (!cue) findings.push({ check: type === 'dialogue' ? 'orphanDialogue' : 'orphanParenthetical',
            position, scene, excerpt: excerpt(node.textContent) });
          if (type === 'dialogue' && cue) spoken = true;
          return;
        }
        if (type === 'lyrics' && cue) {
          if (node.textContent.trim()) spoken = true;
          return;
        }
        flush();
      });
      flush();
    };
    scan(doc, 0, null);
  }
  for (const note of options.notes) {
    if (note.resolved) continue;
    const position = anchors.get(note.id)?.position ?? null;
    const index = indexAt(position);
    findings.push({ check: 'openNote', noteId: note.id, position, scene: scenes.get(index) ?? null, excerpt: excerpt(note.content.trim() || (note.replies ?? []).map(reply => reply.content ?? '').join(' ')) });
  }
  for (const finding of findings) {
    finding.sceneNumber = sceneNumbers.get(indexAt(finding.position)) ?? null;
  }
  return findings.sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity));
}
