/**
 * Draws element numbers (utils/elementNumbers) beside the elements a format
 * numbers — every line of dialogue in a podcast, every SFX cue.
 *
 * Automatic labels are decorations. Locked and manually edited references
 * are document attributes, so native saves, undo and collaborators retain them.
 * Inserted elements receive unused suffixes without renumbering existing text.
 */
import { Fragment, Slice } from '@tiptap/pm/model';
import { Mapping } from '@tiptap/pm/transform';
import { uuid } from '../../utils/uuid';
import { REVISION_SKIP_META } from '../revisionMarks';
import {
  NUMBERABLE_BLOCK_TYPES,
  numberingGroups,
  rulesWithStoredNumbers,
  storedElementNumber,
} from '../../utils/lockedElementNumbers';
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PmNode } from '@tiptap/pm/model';
import {
  assignElementNumbers,
  hasNumbering,
  isInlineNumbering,
  type NumberingItem,
  type NumberingRules,
} from '../../utils/elementNumbers';
import { elementIdOf } from '../../utils/pageBreaks';
import { AV_BLOCK_RULE_ID } from '../../stores/formattingTypes';

export const elementNumbersPluginKey = new PluginKey<DecorationSet>(
  'elementNumbers',
);

/** Set on a transaction to recompute after something outside the document
 *  changed: the format's numbering, or whether scene numbers are shown. */
export const ELEMENT_NUMBERS_REFRESH = 'elementNumbersRefresh';

export interface ElementNumbersOptions {
  /** The active format's numbered elements. */
  getRules: () => NumberingRules;
  /** Whether scene numbers are shown — the 12.3 style needs them. */
  getSceneNumbersVisible: () => boolean;
}

const DESCEND: ReadonlySet<string> = new Set([
  'doc',
  'dualDialogue',
  'dualDialogueColumn',
]);

/** Every element of the document in reading order, with where it sits. */
export function collectNumberedElements(
  doc: PmNode,
): Array<{ from: number; to: number; node: PmNode; item: NumberingItem }> {
  const out: Array<{
    from: number;
    to: number;
    node: PmNode;
    item: NumberingItem;
  }> = [];
  doc.descendants((node, pos) => {
    const type = node.type.name;
    if (DESCEND.has(type)) return true;
    if (type === AV_BLOCK_RULE_ID) return false;
    if (!node.isBlock) return false;
    out.push({
      node,
      from: pos,
      to: pos + node.nodeSize,
      item: {
        elementId: elementIdOf({ type, attrs: node.attrs }),
        empty: node.textContent.trim() === '',
        number: NUMBERABLE_BLOCK_TYPES.includes(type)
          ? storedElementNumber(node.attrs.elementNumber)
          : null,
        numberLocked: node.attrs.elementNumberLocked === true,
        numberAutomatic: node.attrs.elementNumberAutomatic === true,
        sceneNumber:
          type === 'sceneHeading'
            ? ((node.attrs.sceneNumber as string | null) ?? null)
            : undefined,
      },
    });
    return false;
  });
  return out;
}

/** The decorations for `doc`. Exported for tests. */
export function buildElementNumberDecorations(
  doc: PmNode,
  rules: NumberingRules,
  sceneNumbersVisible: boolean,
): DecorationSet {
  const found = collectNumberedElements(doc);
  rules = rulesWithStoredNumbers(
    found.map((f) => f.item),
    rules,
  );
  if (!hasNumbering(rules) && !found.some((f) => f.item.number))
    return DecorationSet.empty;
  const labels = assignElementNumbers(
    found.map((f) => f.item),
    rules,
    { sceneNumbersVisible },
  );
  const decorations: Decoration[] = [];
  found.forEach((f, i) => {
    const label = labels[i];
    if (label == null) return;
    // An inline number (PANEL 3) is drawn as the start of the line, not in the
    // margin — a different attribute, so the margin rule never picks it up.
    const attr = isInlineNumbering(rules[f.item.elementId])
      ? 'data-element-label'
      : 'data-element-number';
    decorations.push(Decoration.node(f.from, f.to, { [attr]: label }));
  });
  return decorations.length
    ? DecorationSet.create(doc, decorations)
    : DecorationSet.empty;
}

/** Numbering that cannot be computed must not take the editor down — the
 *  script still renders, just without numbers. */
function safeBuild(
  state: Pick<EditorState, 'doc'>,
  opts: ElementNumbersOptions,
): DecorationSet {
  try {
    return buildElementNumberDecorations(
      state.doc,
      opts.getRules(),
      opts.getSceneNumbersVisible(),
    );
  } catch (err) {
    console.warn('[elementNumbers] could not compute element numbers', err);
    return DecorationSet.empty;
  }
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    elementNumbers: {
      lockElementNumbers: () => ReturnType;
      unlockElementNumbers: () => ReturnType;
      setElementNumber: (
        number: string | null,
        position?: number,
      ) => ReturnType;
    };
  }
}
export function elementNumbersAreLocked(doc: PmNode): boolean {
  return collectNumberedElements(doc).some((f) => f.item.numberLocked);
}
export function elementNumberAt(doc: PmNode, position: number) {
  return (
    collectNumberedElements(doc).find(
      (f) =>
        NUMBERABLE_BLOCK_TYPES.includes(f.node.type.name) &&
        position >= f.from &&
        position < f.to,
    ) ?? null
  );
}
const NUMBER_REPAIR = 'elementNumberRepair';

export const ElementNumbers = Extension.create<ElementNumbersOptions>({
  name: 'elementNumbers',
  addGlobalAttributes() {
    return [
      {
        types: NUMBERABLE_BLOCK_TYPES,
        attributes: {
          elementNumber: {
            default: null,
            keepOnSplit: false,
            parseHTML: (el: HTMLElement) =>
              el.getAttribute('data-stored-element-number'),
            renderHTML: (attrs: Record<string, unknown>) =>
              attrs.elementNumber
                ? { 'data-stored-element-number': String(attrs.elementNumber) }
                : {},
          },
          elementNumberAutomatic: {
            default: false,
            keepOnSplit: false,
            parseHTML: (el: HTMLElement) =>
              el.getAttribute('data-element-number-automatic') === 'true',
            renderHTML: (attrs: Record<string, unknown>) =>
              attrs.elementNumberAutomatic
                ? { 'data-element-number-automatic': 'true' }
                : {},
          },
          elementNumberLocked: {
            default: false,
            keepOnSplit: false,
            parseHTML: (el: HTMLElement) =>
              el.getAttribute('data-element-number-locked') === 'true',
            renderHTML: (attrs: Record<string, unknown>) =>
              attrs.elementNumberLocked
                ? { 'data-element-number-locked': 'true' }
                : {},
          },
          elementNumberId: {
            default: null,
            keepOnSplit: false,
            parseHTML: (el: HTMLElement) =>
              el.getAttribute('data-element-number-id'),
            renderHTML: (attrs: Record<string, unknown>) =>
              attrs.elementNumberId
                ? { 'data-element-number-id': String(attrs.elementNumberId) }
                : {},
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      lockElementNumbers:
        () =>
        ({ state, tr, dispatch }) => {
          const found = collectNumberedElements(state.doc);
          const labels = assignElementNumbers(
            found.map((f) => f.item),
            this.options.getRules(),
            { sceneNumbersVisible: this.options.getSceneNumbersVisible() },
          );
          if (!labels.some(Boolean)) return false;
          if (dispatch) {
            found.forEach((f, i) => {
              if (
                labels[i] &&
                NUMBERABLE_BLOCK_TYPES.includes(f.node.type.name)
              ) {
                tr.setNodeAttribute(f.from, 'elementNumber', labels[i]);
                tr.setNodeAttribute(f.from, 'elementNumberLocked', true);
                tr.setNodeAttribute(f.from, 'elementNumberAutomatic', false);
                tr.setNodeAttribute(
                  f.from,
                  'elementNumberId',
                  f.node.attrs.elementNumberId || uuid(),
                );
              }
            });
            dispatch(tr.setMeta(REVISION_SKIP_META, true));
          }
          return true;
        },
      unlockElementNumbers:
        () =>
        ({ state, tr, dispatch }) => {
          const found = collectNumberedElements(state.doc);
          if (!found.some((f) => f.item.numberLocked)) return false;
          if (dispatch) {
            for (const f of found)
              if (f.item.numberLocked) {
                tr.setNodeAttribute(f.from, 'elementNumberAutomatic', true);
                tr.setNodeAttribute(f.from, 'elementNumberLocked', false);
              }
            dispatch(tr.setMeta(REVISION_SKIP_META, true));
          }
          return true;
        },
      setElementNumber:
        (number, position) =>
        ({ state, tr, dispatch }) => {
          const target = elementNumberAt(
            state.doc,
            position ?? state.selection.from,
          );
          if (!target) return false;
          const value = number == null ? null : number.trim();
          if (
            value !== null &&
            (!value ||
              value.length > 40 ||
              [...value].some((char) => char.charCodeAt(0) < 32))
          )
            return false;
          const found = collectNumberedElements(state.doc);
          const rules = rulesWithStoredNumbers(
            found.map((f) => f.item),
            this.options.getRules(),
          );
          const index = found.findIndex((f) => f.from === target.from);
          const resolved = assignElementNumbers(
            found.map((f) => f.item),
            rules,
            { sceneNumbersVisible: this.options.getSceneNumbersVisible() },
          );
          const checkRules = {
            ...rules,
            [target.item.elementId]: rules[target.item.elementId] ?? {
              enabled: true,
              resetOn: [],
            },
          };
          const group = numberingGroups(
            found.map((f) => f.item),
            checkRules,
          ).find((g) => g.includes(index));
          if (
            value &&
            group?.some(
              (i) =>
                i !== index &&
                resolved[i]?.toUpperCase() === value.toUpperCase(),
            )
          )
            return false;
          if (dispatch) {
            tr.setNodeAttribute(target.from, 'elementNumberAutomatic', false);
            tr.setNodeAttribute(target.from, 'elementNumber', value);
            tr.setNodeAttribute(
              target.from,
              'elementNumberId',
              value ? target.node.attrs.elementNumberId || uuid() : null,
            );
            if (!value)
              tr.setNodeAttribute(target.from, 'elementNumberLocked', false);
            dispatch(tr.setMeta(REVISION_SKIP_META, true));
          }
          return true;
        },
    };
  },

  addOptions() {
    return { getRules: () => ({}), getSceneNumbersVisible: () => false };
  },

  addProseMirrorPlugins() {
    const opts = this.options;
    return [
      new Plugin<DecorationSet>({
        key: elementNumbersPluginKey,
        // Plugin state, not `decorations(state)`, so a cursor move does not
        // re-walk the document: the numbers change only with the document or
        // an explicit refresh.
        state: {
          init: (_config, state) => safeBuild(state, opts),
          apply: (tr, value) => {
            if (!tr.docChanged && !tr.getMeta(ELEMENT_NUMBERS_REFRESH))
              return value;
            return safeBuild(tr, opts);
          },
        },
        appendTransaction(transactions, oldState, newState) {
          if (
            !transactions.some(
              (tr) => tr.docChanged || tr.getMeta(ELEMENT_NUMBERS_REFRESH),
            ) ||
            transactions.some(
              (tr) => tr.getMeta(NUMBER_REPAIR) || tr.getMeta('preventUpdate'),
            )
          )
            return null;
          const found = collectNumberedElements(newState.doc);
          const previous = collectNumberedElements(oldState.doc);
          const mapping = new Mapping();
          for (const tr of transactions) mapping.appendMapping(tr.mapping);
          const protectedPositions = new Set(
            previous
              .filter((f) => f.item.number)
              .map((f) => mapping.map(f.from, 1)),
          );
          const seenIds = new Map<string, number>();
          const clear = new Set<number>();
          for (const f of found) {
            const id = f.node.attrs.elementNumberId;
            if (!id) continue;
            const held = seenIds.get(id);
            if (held !== undefined) {
              if (protectedPositions.has(f.from)) {
                clear.add(held);
                seenIds.set(id, f.from);
              } else clear.add(f.from);
            } else seenIds.set(id, f.from);
          }
          const items = found.map((f) =>
            clear.has(f.from)
              ? { ...f.item, number: null, numberLocked: false }
              : f.item,
          );
          const rules = rulesWithStoredNumbers(items, opts.getRules());
          for (const group of numberingGroups(items, rules)) {
            const byLabel = new Map<string, number[]>();
            for (const i of group)
              if (items[i].number) {
                const key = items[i].number!.toUpperCase();
                byLabel.set(key, [...(byLabel.get(key) ?? []), i]);
              }
            for (const [label, indices] of byLabel) {
              if (
                indices.length < 2 ||
                !previous.some((f) => f.item.number?.toUpperCase() === label)
              )
                continue;
              const ordered = [...indices].sort((a, b) =>
                String(found[a].node.attrs.elementNumberId ?? '').localeCompare(
                  String(found[b].node.attrs.elementNumberId ?? ''),
                ),
              );
              for (const i of ordered.slice(1)) {
                clear.add(found[i].from);
                items[i] = { ...items[i], number: null, numberLocked: false };
              }
            }
          }
          const locked = found.some((f) => f.item.numberLocked);
          const labels = assignElementNumbers(items, rules, {
            sceneNumbersVisible: opts.getSceneNumbersVisible(),
          });
          const tr = newState.tr;
          found.forEach((f, i) => {
            if (clear.has(f.from)) {
              tr.setNodeAttribute(f.from, 'elementNumberAutomatic', false);
              tr.setNodeAttribute(f.from, 'elementNumber', null);
              tr.setNodeAttribute(f.from, 'elementNumberLocked', false);
              tr.setNodeAttribute(f.from, 'elementNumberId', null);
            }
            if (
              locked &&
              labels[i] &&
              !items[i].number &&
              NUMBERABLE_BLOCK_TYPES.includes(f.node.type.name)
            ) {
              tr.setNodeAttribute(f.from, 'elementNumberAutomatic', false);
              tr.setNodeAttribute(f.from, 'elementNumber', labels[i]);
              tr.setNodeAttribute(f.from, 'elementNumberLocked', true);
              tr.setNodeAttribute(f.from, 'elementNumberId', uuid());
            }
          });
          return tr.steps.length
            ? tr
                .setMeta(NUMBER_REPAIR, true)
                .setMeta('addToHistory', false)
                .setMeta(REVISION_SKIP_META, true)
            : null;
        },
        props: {
          transformPasted(slice, view) {
            const existing = new Set(
              collectNumberedElements(view.state.doc)
                .filter((f) => f.item.number)
                .map((f) => JSON.stringify([f.item.elementId, f.item.number])),
            );
            const walk = (fragment: Fragment): Fragment => {
              const nodes: PmNode[] = [];
              fragment.forEach((node) => {
                if (node.isText) {
                  nodes.push(node);
                  return;
                }
                const content = node.content.size
                  ? walk(node.content)
                  : node.content;
                const key = JSON.stringify([
                  elementIdOf({ type: node.type.name, attrs: node.attrs }),
                  storedElementNumber(node.attrs.elementNumber),
                ]);
                const attrs = existing.has(key)
                  ? {
                      ...node.attrs,
                      elementNumber: null,
                      elementNumberLocked: false,
                      elementNumberAutomatic: false,
                      elementNumberId: null,
                    }
                  : node.attrs;
                nodes.push(node.type.create(attrs, content, node.marks));
              });
              return Fragment.from(nodes);
            };
            return new Slice(
              walk(slice.content),
              slice.openStart,
              slice.openEnd,
            );
          },
          decorations(state) {
            return (
              elementNumbersPluginKey.getState(state) ?? DecorationSet.empty
            );
          },
        },
      }),
    ];
  },
});
