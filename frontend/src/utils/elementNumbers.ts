/**
 * Running numbers on elements other than the scene heading.
 *
 * A format turns them on per element (`FormattingElementRule.numbering`): every
 * line of dialogue in a podcast, so a recording session can call "line 41";
 * every SFX cue; every shot. Each element keeps its own count, and the format
 * names the elements that start a count again (utils/formattingTypes
 * `ElementNumbering`).
 *
 * The numbers are worked out from the order of the script and never stored in
 * it. Nothing is added to the document, its history or what collaborators are
 * sent, and a script whose format numbers nothing is exactly what it was — the
 * editor draws them as decorations (editor/extensions/ElementNumbers) and the
 * exporters read them off a copy of the document (`withElementNumbers`).
 *
 * Scene headings are not numbered here: theirs are kept, locked and lettered by
 * utils/sceneNumbers. A scene heading can still restart a count.
 */
import type { JSONContent } from '@tiptap/react';
import type { ElementNumbering, FormattingElementRule } from '../stores/formattingTypes';
import { AV_BLOCK_RULE_ID, isTitlePageRuleId } from '../stores/formattingTypes';
import { useFormattingTemplateStore, findTemplate } from '../stores/formattingTemplateStore';
import { elementIdOf } from './pageBreaks';
import { NON_PRINTING_TYPES } from './nonPrinting';

/** The attribute a numbered node carries in the copy the exporters are given. */
export const ELEMENT_NUMBER_ATTR = 'elementNumber';

/**
 * The AV body's own paragraph types (editor/extensions/AvBlock
 * `AV_BASE_CELL_ELEMENT_IDS`, not imported so the exporters need not load the
 * editor). They exist only inside AV cells, which number their own shots.
 */
const AV_CELL_ONLY: ReadonlySet<string> = new Set(['avPara', 'avShot', 'avDirection', 'avGraphic']);

/** Elements whose own numbering lives elsewhere, or that never reach the page. */
const NEVER_NUMBERED: ReadonlySet<string> = new Set(['sceneHeading', AV_BLOCK_RULE_ID, ...AV_CELL_ONLY, ...NON_PRINTING_TYPES]);

/** Can a format number this element? */
export function isNumberableElementId(id: string): boolean {
  return !NEVER_NUMBERED.has(id) && !isTitlePageRuleId(id);
}

/** Can this element restart another element's count? */
export function isResetElementId(id: string): boolean {
  return id !== AV_BLOCK_RULE_ID && id !== 'note' && !AV_CELL_ONLY.has(id) && !isTitlePageRuleId(id);
}

/** The elements of a template a writer may number, in the template's own order. */
export function numberableElementIds(rules: Record<string, FormattingElementRule>): string[] {
  return Object.keys(rules).filter((id) => rules[id].enabled && isNumberableElementId(id));
}

/** The elements of a template that may restart a count, in the template's own order. */
export function resetElementIds(rules: Record<string, FormattingElementRule>): string[] {
  return Object.keys(rules).filter((id) => rules[id].enabled && isResetElementId(id));
}

/** Numbering settings keyed by element id, only for elements that are numbered. */
export type NumberingRules = Record<string, ElementNumbering>;

/** The numbered elements of a set of template rules. Empty when there are none. */
export function numberingRulesOf(rules: Record<string, FormattingElementRule> | undefined | null): NumberingRules {
  const out: NumberingRules = {};
  if (!rules) return out;
  for (const [id, rule] of Object.entries(rules)) {
    if (rule?.enabled && rule.numbering?.enabled && isNumberableElementId(id)) out[id] = rule.numbering;
  }
  return out;
}

/**
 * The numbered elements of the active template.
 *
 * Read defensively, as `getForceBreakIds` is: an export must still come out
 * when the template store has not been hydrated (tests, headless export), and
 * a script with nothing numbered is the answer that changes nothing.
 */
export function getElementNumberingRules(): NumberingRules {
  try {
    return numberingRulesOf(useFormattingTemplateStore.getState().getActiveTemplate().rules);
  } catch (err) {
    console.warn('[elementNumbers] could not read template numbering rules', err);
    return {};
  }
}

/**
 * The numbered elements of a saved script's own format — for exporting a
 * script that is not the one open in the editor, whose format the active one
 * may not be. A format this device does not have numbers nothing.
 */
export function numberingRulesForSaved(content: Record<string, unknown> | null | undefined): NumberingRules {
  try {
    const id = content?._templateId;
    return numberingRulesOf(findTemplate(typeof id === 'string' ? id : null)?.rules);
  } catch (err) {
    console.warn('[elementNumbers] could not read the saved script\'s numbering rules', err);
    return {};
  }
}

/**
 * A saved script's body, labelled with its own format's element numbers as
 * its own settings show them. Exporters print the labels they find, so this is
 * all a caller exporting saved content needs.
 */
export function labelSavedContent(doc: JSONContent, content: Record<string, unknown> | null | undefined): JSONContent {
  return withElementNumbers(doc, {
    visible: content?._elementNumbersVisible !== false,
    sceneNumbersVisible: content?._sceneNumbersVisible !== false,
    rules: numberingRulesForSaved(content),
  });
}

export function hasNumbering(rules: NumberingRules): boolean {
  return Object.keys(rules).length > 0;
}

/** One element of the script, as far as numbering is concerned. */
export interface NumberingItem {
  /** Template element id — custom elements by their rule id (`elementIdOf`). */
  elementId: string;
  /** No text yet: not counted, so the numbers below do not jump while a line is typed. */
  empty: boolean;
  /** A scene heading's number, for the 12.3 style. */
  sceneNumber?: string | null;
}

export interface ElementNumberOptions {
  /** Scene numbers are shown. The 12.3 style needs them; without, it is plain. */
  sceneNumbersVisible: boolean;
}

/**
 * The label each element should carry, in document order — null where it
 * carries none.
 */
export function assignElementNumbers(
  items: NumberingItem[],
  rules: NumberingRules,
  opts: ElementNumberOptions,
): Array<string | null> {
  const out: Array<string | null> = new Array(items.length).fill(null);
  const ids = Object.keys(rules);
  if (ids.length === 0) return out;

  const startOf = (id: string): number => {
    const s = rules[id].startAt;
    return typeof s === 'number' && Number.isFinite(s) ? Math.max(0, Math.floor(s)) : 1;
  };
  /** The number the next one of each element gets. */
  const next = new Map<string, number>(ids.map((id) => [id, startOf(id)]));
  /** For each element that restarts counts, the counts it restarts. */
  const resetBy = new Map<string, string[]>();
  for (const id of ids) {
    for (const trigger of rules[id].resetOn ?? []) {
      // An element restarting its own count would number every one of them 1.
      if (trigger === id) continue;
      resetBy.set(trigger, [...(resetBy.get(trigger) ?? []), id]);
    }
  }

  let scene: string | null = null;
  items.forEach((item, i) => {
    if (item.elementId === 'sceneHeading') {
      const n = item.sceneNumber == null ? '' : String(item.sceneNumber).trim();
      scene = opts.sceneNumbersVisible && n ? n : null;
    }
    for (const id of resetBy.get(item.elementId) ?? []) next.set(id, startOf(id));

    const rule = rules[item.elementId];
    if (!rule || item.empty) return;
    const n = next.get(item.elementId) ?? startOf(item.elementId);
    next.set(item.elementId, n + 1);
    const num = rule.style === 'scene' && scene ? `${scene}.${n}` : String(n);
    out[i] = `${rule.prefix ?? ''}${num}`;
  });
  return out;
}

// ── Walking a document ───────────────────────────────────────────────────

/** Containers whose children are numbered in reading order: left column, then right. */
const DESCEND: ReadonlySet<string> = new Set(['dualDialogue', 'dualDialogueColumn']);

/** Plain text of a JSON node, enough to know whether it is empty. */
function jsonHasText(node: JSONContent): boolean {
  if (typeof node.text === 'string' && node.text.trim() !== '') return true;
  return (node.content ?? []).some(jsonHasText);
}

/** The numbered elements of a JSON document, in reading order, with the node each came from. */
export function collectJSON(doc: JSONContent): Array<{ node: JSONContent; item: NumberingItem }> {
  const out: Array<{ node: JSONContent; item: NumberingItem }> = [];
  const walk = (nodes: JSONContent[] | undefined) => {
    for (const node of nodes ?? []) {
      if (!node || typeof node !== 'object') continue;
      const type = node.type || 'general';
      if (DESCEND.has(type)) { walk(node.content); continue; }
      // An AV body numbers its own shots (AvCueDecorations); nothing inside it is ours.
      if (type === AV_BLOCK_RULE_ID) continue;
      out.push({
        node,
        item: {
          elementId: elementIdOf({ type, attrs: node.attrs }),
          empty: !jsonHasText(node),
          sceneNumber: type === 'sceneHeading' ? (node.attrs?.sceneNumber as string | null | undefined) ?? null : undefined,
        },
      });
    }
  };
  walk(doc?.content);
  return out;
}

/**
 * A copy of `doc` whose numbered elements carry their label in
 * `attrs.elementNumber`, for an exporter to print.
 *
 * Returns `doc` itself — not a copy — when nothing is numbered or numbers are
 * hidden, so every script that does not use numbering exports exactly as it
 * did. Only the nodes on the path to a numbered element are copied.
 */
export function withElementNumbers(
  doc: JSONContent,
  opts: ElementNumberOptions & { visible: boolean; rules?: NumberingRules },
): JSONContent {
  if (!opts.visible || !doc?.content) return doc;
  const rules = opts.rules ?? getElementNumberingRules();
  if (!hasNumbering(rules)) return doc;

  const found = collectJSON(doc);
  const labels = assignElementNumbers(found.map((f) => f.item), rules, opts);
  const byNode = new Map<JSONContent, string>();
  found.forEach((f, i) => { if (labels[i] != null) byNode.set(f.node, labels[i] as string); });
  if (byNode.size === 0) return doc;

  const copy = (node: JSONContent): JSONContent => {
    const label = byNode.get(node);
    if (label != null) return { ...node, attrs: { ...(node.attrs ?? {}), [ELEMENT_NUMBER_ATTR]: label } };
    const type = node.type || 'general';
    if (DESCEND.has(type) && node.content) return { ...node, content: node.content.map(copy) };
    return node;
  };
  return { ...doc, content: doc.content.map(copy) };
}

/** The label an exporter should print beside this node, if any. */
export function elementNumberOf(node: { attrs?: Record<string, unknown> | null } | null | undefined): string | null {
  const v = node?.attrs?.[ELEMENT_NUMBER_ATTR];
  return typeof v === 'string' && v !== '' ? v : null;
}
