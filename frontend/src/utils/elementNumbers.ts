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

/** Is this element's number the start of its own line rather than a margin note? */
export function isInlineNumbering(numbering: ElementNumbering | undefined | null): boolean {
  return numbering?.placement === 'inline';
}

const ONES = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE', 'TEN',
  'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN'];
const TENS = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];

/**
 * A count spelled out in capitals, the way a comic script heads its pages:
 * ONE, TWENTY-TWO, ONE HUNDRED FOUR. Digits from 1000 on — no script has that
 * many pages, and a number nobody can read at a glance helps no one.
 */
export function numberInWords(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999) return String(n);
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '');
  const rest = n % 100;
  return `${ONES[Math.floor(n / 100)]} HUNDRED${rest ? ` ${numberInWords(rest)}` : ''}`;
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

  /** The element whose count this one advances — itself, unless it counts with
   *  another numbered element that keeps a count of its own (one level only, so
   *  a chain or a loop of `countWith` cannot leave an element without one). */
  const counterOf = (id: string): string => {
    const w = rules[id].countWith;
    return w && w !== id && rules[w] && !rules[w].countWith ? w : id;
  };
  const counters = ids.filter((id) => counterOf(id) === id);
  const startOf = (id: string): number => {
    const s = rules[id].startAt;
    return typeof s === 'number' && Number.isFinite(s) ? Math.max(0, Math.floor(s)) : 1;
  };
  /** The number the next one of each count gets. */
  const next = new Map<string, number>(counters.map((id) => [id, startOf(id)]));
  /** For each element that restarts counts, the counts it restarts. */
  const resetBy = new Map<string, string[]>();
  for (const id of counters) {
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
    // An empty line waits for its text before taking a number — except a
    // heading whose number IS its text, which is numbered from the moment it
    // is made.
    if (!rule || (item.empty && !isInlineNumbering(rule))) return;
    const counter = counterOf(item.elementId);
    const n = next.get(counter) ?? startOf(counter);
    next.set(counter, n + 1);
    const num = rule.style === 'scene' && scene
      ? `${scene}.${n}`
      : rule.style === 'words' ? numberInWords(n) : String(n);
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
 * A node with `label` written in front of its text, as an inline-numbered
 * heading prints: PANEL 3, or PAGE ONE (SPLASH) when the writer added to it.
 */
function withLeadingLabel(node: JSONContent, label: string): JSONContent {
  const [first, ...rest] = node.content ?? [];
  const text = jsonHasText(node) ? `${label} ` : label;
  // Joined to plain text that follows it, so Word and Final Draft get one run
  // rather than two; kept apart from styled text, whose marks are not its own.
  if (first?.type === 'text' && typeof first.text === 'string' && !first.marks?.length) {
    return { ...node, content: [{ ...first, text: text + first.text }, ...rest] };
  }
  return { ...node, content: [{ type: 'text', text }, ...(first ? [first, ...rest] : [])] };
}

/**
 * A copy of `doc` whose numbered elements carry their label in
 * `attrs.elementNumber`, for an exporter to print.
 *
 * `inlineAsText` is for the outputs that only ever leave the app — PDF, Word,
 * an exported Final Draft file: an inline-numbered element (PANEL 3) gets its
 * label as the start of its text, so it prints as the line it is on screen.
 * Without it the label goes in the attribute like any other, which is what a
 * linked file wants: one read back must not come home with "PANEL 3" typed
 * into a panel the template numbers again.
 *
 * Returns `doc` itself — not a copy — when nothing is numbered or numbers are
 * hidden, so every script that does not use numbering exports exactly as it
 * did. Only the nodes on the path to a numbered element are copied.
 */
export function withElementNumbers(
  doc: JSONContent,
  opts: ElementNumberOptions & { visible: boolean; rules?: NumberingRules; inlineAsText?: boolean },
): JSONContent {
  if (!opts.visible || !doc?.content) return doc;
  const rules = opts.rules ?? getElementNumberingRules();
  if (!hasNumbering(rules)) return doc;

  const found = collectJSON(doc);
  const labels = assignElementNumbers(found.map((f) => f.item), rules, opts);
  const byNode = new Map<JSONContent, { label: string; inline: boolean }>();
  found.forEach((f, i) => {
    const label = labels[i];
    if (label == null) return;
    byNode.set(f.node, { label, inline: opts.inlineAsText === true && isInlineNumbering(rules[f.item.elementId]) });
  });
  if (byNode.size === 0) return doc;

  const copy = (node: JSONContent): JSONContent => {
    const hit = byNode.get(node);
    if (hit?.inline) return withLeadingLabel(node, hit.label);
    if (hit) return { ...node, attrs: { ...(node.attrs ?? {}), [ELEMENT_NUMBER_ATTR]: hit.label } };
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
