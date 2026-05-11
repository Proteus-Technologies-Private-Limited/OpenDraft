import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Transaction, EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { pluginRegistry, type GrammarIssue } from '../../plugins/registry';
import { grammarIgnore, GrammarIgnore } from '../grammar/grammarIgnore';
import { useEditorStore } from '../../stores/editorStore';

export const grammarPluginKey = new PluginKey('grammar');

interface GrammarPluginState {
  decorations: DecorationSet;
  enabled: boolean;
  /** All issues currently in the doc, mapped through edits like decorations. */
  issues: GrammarIssue[];
  activeFrom: number;
  activeTo: number;
  /** Range awaiting (or in flight for) rescan. -1 = none pending. */
  pendingFrom: number;
  pendingTo: number;
  /** Bumped whenever a new scan is required; in-flight scans check it to bail. */
  scanGen: number;
}

const RESCAN_DEBOUNCE_MS = 150;
const INITIAL_SCAN_DELAY_MS = 50;

function expandToBlockRange(
  doc: ProseMirrorNode,
  from: number,
  to: number,
): { from: number; to: number } {
  const docSize = doc.content.size;
  const safeFrom = Math.max(0, Math.min(from, docSize));
  const safeTo = Math.max(safeFrom, Math.min(to, docSize));
  try {
    const $from = doc.resolve(safeFrom);
    const $to = doc.resolve(safeTo);
    const blockFrom = $from.depth > 0 ? $from.before($from.depth) : safeFrom;
    const blockTo = $to.depth > 0 ? $to.after($to.depth) : safeTo;
    return { from: Math.max(0, blockFrom), to: Math.min(docSize, blockTo) };
  } catch {
    return { from: safeFrom, to: safeTo };
  }
}

function getChangedRange(tr: Transaction): { from: number; to: number } | null {
  let from = -1;
  let to = -1;
  for (const stepMap of tr.mapping.maps) {
    stepMap.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      if (from === -1 || newStart < from) from = newStart;
      if (newEnd > to) to = newEnd;
    });
  }
  return from === -1 ? null : { from, to };
}

function makeDecoration(issue: GrammarIssue, isActive: boolean): Decoration {
  const cls = isActive
    ? `grammar-issue grammar-${issue.severity} grammar-active`
    : `grammar-issue grammar-${issue.severity}`;
  return Decoration.inline(issue.from, issue.to, {
    class: cls,
    'data-grammar-rule': issue.ruleId,
    'data-grammar-message': issue.message,
  });
}

/**
 * Walk textblock nodes (each screenplay element — scene heading, action,
 * character, dialogue, etc. — is its own textblock) overlapping [from, to]
 * and return their inline content as a single string per block.
 *
 * We send each block independently to grammar providers so they can't run
 * sentence segmentation across block boundaries. Even without terminal
 * punctuation, the text of one element is treated as a standalone unit.
 *
 * Within a block we concatenate text-node fragments (which marks split into
 * pieces) and replace atom inline nodes (hardBreak, mentions, etc.) with a
 * space. Each atom occupies one PM position, so the linear mapping
 * `baseOffset + index` stays valid for mapping issue offsets back to doc
 * positions.
 */
function collectTextNodes(
  doc: ProseMirrorNode,
  from: number,
  to: number,
): { text: string; pos: number }[] {
  const out: { text: string; pos: number }[] = [];
  // Clamp to current doc bounds — a scheduled scan can carry a stale range
  // from before a deletion. nodesBetween crashes if `to` exceeds the doc.
  const docSize = doc.content.size;
  const safeFrom = Math.max(0, Math.min(from, docSize));
  const safeTo = Math.max(safeFrom, Math.min(to, docSize));
  if (safeFrom === safeTo) return out;
  doc.nodesBetween(safeFrom, safeTo, (node, pos) => {
    if (!node.isTextblock) return true;
    let blockText = '';
    node.forEach((child) => {
      if (child.isText && child.text) {
        blockText += child.text;
      } else if (child.isInline) {
        // Atom (1 PM position wide) — use a space so the offset mapping
        // stays linear.
        blockText += ' ';
      }
    });
    if (blockText.trim().length > 0) {
      // baseOffset = doc position of the first character inside the block
      out.push({ text: blockText, pos: pos + 1 });
    }
    return false; // don't recurse into the textblock's inline content
  });
  return out;
}

export const Grammar = Extension.create({
  name: 'grammar',

  addProseMirrorPlugins() {
    let scanTimeout: ReturnType<typeof setTimeout> | null = null;
    let scanController: AbortController | null = null;

    return [
      new Plugin({
        key: grammarPluginKey,
        state: {
          init(): GrammarPluginState {
            return {
              decorations: DecorationSet.empty,
              enabled: false,
              issues: [],
              activeFrom: 0,
              activeTo: 0,
              pendingFrom: -1,
              pendingTo: -1,
              scanGen: 0,
            };
          },
          apply(
            tr: Transaction,
            value: GrammarPluginState,
            _oldState: EditorState,
            newState: EditorState,
          ): GrammarPluginState {
            const meta = tr.getMeta(grammarPluginKey) as
              | {
                  toggle?: boolean;
                  applyResult?: {
                    decorations: DecorationSet;
                    issues: GrammarIssue[];
                    /** Set when the scan that produced this result has finished and pending should clear. */
                    clearPending?: boolean;
                  };
                  activeRange?: { from: number; to: number } | null;
                  rescanAll?: boolean;
                  ignoredRulesChanged?: boolean;
                }
              | undefined;

            if (meta?.toggle !== undefined) {
              const enabled = meta.toggle;
              if (!enabled) {
                return {
                  decorations: DecorationSet.empty,
                  enabled: false,
                  issues: [],
                  activeFrom: 0,
                  activeTo: 0,
                  pendingFrom: -1,
                  pendingTo: -1,
                  scanGen: value.scanGen + 1,
                };
              }
              return {
                ...value,
                enabled,
                pendingFrom: 0,
                pendingTo: newState.doc.content.size,
                scanGen: value.scanGen + 1,
              };
            }

            if ((meta?.rescanAll || meta?.ignoredRulesChanged) && value.enabled) {
              return {
                ...value,
                pendingFrom: 0,
                pendingTo: newState.doc.content.size,
                scanGen: value.scanGen + 1,
              };
            }

            if (meta?.activeRange !== undefined) {
              if (meta.activeRange === null) {
                const decos = value.issues.map((i) => makeDecoration(i, false));
                return {
                  ...value,
                  activeFrom: 0,
                  activeTo: 0,
                  decorations: DecorationSet.create(newState.doc, decos),
                };
              }
              const { from, to } = meta.activeRange;
              const decos = value.issues.map((i) =>
                makeDecoration(i, i.from === from && i.to === to),
              );
              return {
                ...value,
                activeFrom: from,
                activeTo: to,
                decorations: DecorationSet.create(newState.doc, decos),
              };
            }

            if (meta?.applyResult) {
              const { decorations, issues, clearPending } = meta.applyResult;
              return {
                ...value,
                decorations,
                issues,
                pendingFrom: clearPending ? -1 : value.pendingFrom,
                pendingTo: clearPending ? -1 : value.pendingTo,
              };
            }

            if (tr.docChanged && value.enabled) {
              // Map decorations and issues through the transaction.
              const mapped = value.decorations.map(tr.mapping, tr.doc);
              const mappedIssues = value.issues
                .map((i) => {
                  const from = tr.mapping.map(i.from, 1);
                  const to = tr.mapping.map(i.to, -1);
                  return to > from ? { ...i, from, to } : null;
                })
                .filter((i): i is GrammarIssue => i !== null);

              const changed = getChangedRange(tr);
              if (!changed) {
                return { ...value, decorations: mapped, issues: mappedIssues };
              }
              const block = expandToBlockRange(tr.doc, changed.from, changed.to);

              // Merge with any pending range from earlier transactions.
              // The stored pending positions are in the OLD doc — map them
              // through this transaction so they refer to valid positions
              // in the new doc (otherwise a delete can leave pendingTo past
              // the doc end and crash nodesBetween).
              const newDocSize = tr.doc.content.size;
              let pendingFrom = value.pendingFrom;
              let pendingTo = value.pendingTo;
              if (pendingFrom !== -1) {
                pendingFrom = Math.max(0, Math.min(tr.mapping.map(pendingFrom, 1), newDocSize));
                pendingTo = Math.max(pendingFrom, Math.min(tr.mapping.map(pendingTo, -1), newDocSize));
              }
              if (pendingFrom === -1) {
                pendingFrom = block.from;
                pendingTo = block.to;
              } else {
                pendingFrom = Math.min(pendingFrom, block.from);
                pendingTo = Math.max(pendingTo, block.to);
              }

              return {
                ...value,
                decorations: mapped,
                issues: mappedIssues,
                pendingFrom,
                pendingTo,
                scanGen: value.scanGen + 1,
              };
            }

            return value;
          },
        },
        props: {
          decorations(state: EditorState) {
            const ps = grammarPluginKey.getState(state) as GrammarPluginState | undefined;
            return ps?.decorations || DecorationSet.empty;
          },
        },
        view(editorView: EditorView) {
          const runScan = async (gen: number, rangeFrom: number, rangeTo: number) => {
            const ps0 = grammarPluginKey.getState(editorView.state) as GrammarPluginState | undefined;
            if (!ps0?.enabled || ps0.scanGen !== gen) return;

            const store = useEditorStore.getState();
            const rulesEnabled = store.grammarRulesEnabled || {};
            const categoryActive = (cat: string) => rulesEnabled[cat] !== false;

            const providers = pluginRegistry.getGrammarProviders();
            const segments = collectTextNodes(editorView.state.doc, rangeFrom, rangeTo);

            // Cancel any in-flight scan.
            scanController?.abort();
            scanController = new AbortController();
            const signal = scanController.signal;

            let allIssues: GrammarIssue[] = [];
            if (providers.length > 0 && segments.length > 0) {
              const calls: Promise<GrammarIssue[]>[] = [];
              for (const seg of segments) {
                for (const { name, provider } of providers) {
                  calls.push(
                    provider(seg.text, seg.pos, signal)
                      .then((issues) => issues.map((i) => ({ ...i, source: i.source ?? name })))
                      .catch((err) => {
                        if (signal.aborted) return [];
                        console.error(`Grammar provider "${name}" failed`, err);
                        return [];
                      }),
                  );
                }
              }
              try {
                const results = await Promise.all(calls);
                allIssues = results.flat();
              } catch {
                return;
              }
              if (signal.aborted) return;
            }

            // Filter ignored issues. Use the segment containing the issue to build the
            // same context fingerprint used by "Ignore once".
            const filtered: GrammarIssue[] = [];
            for (const issue of allIssues) {
              if (!categoryActive(issue.ruleId)) continue;
              if (grammarIgnore.isRuleIgnored(issue.ruleId)) continue;
              const seg = segments.find(
                (s) => issue.from >= s.pos && issue.to <= s.pos + s.text.length,
              );
              if (seg) {
                const localIdx = issue.from - seg.pos;
                const len = issue.to - issue.from;
                const ctxKey = GrammarIgnore.buildContextKey(seg.text, localIdx, len);
                if (grammarIgnore.isIgnoredOnce(issue.ruleId, ctxKey)) continue;
              }
              filtered.push(issue);
            }

            const ps2 = grammarPluginKey.getState(editorView.state) as GrammarPluginState | undefined;
            if (!ps2?.enabled || ps2.scanGen !== gen) return;

            // Replace decorations and issues that fall inside the rescanned range.
            const stale = ps2.decorations.find(rangeFrom, rangeTo);
            let nextDecos = ps2.decorations.remove(stale);
            const newDecos = filtered.map((i) =>
              makeDecoration(i, i.from === ps2.activeFrom && i.to === ps2.activeTo),
            );
            if (newDecos.length > 0) {
              nextDecos = nextDecos.add(editorView.state.doc, newDecos);
            }
            const remainingIssues = ps2.issues.filter((i) => i.to <= rangeFrom || i.from >= rangeTo);
            const nextIssues = [...remainingIssues, ...filtered];

            const tr = editorView.state.tr.setMeta(grammarPluginKey, {
              applyResult: {
                decorations: nextDecos,
                issues: nextIssues,
                clearPending: true,
              },
            });
            editorView.dispatch(tr);
          };

          const schedule = (gen: number, from: number, to: number, delay: number) => {
            if (scanTimeout) clearTimeout(scanTimeout);
            scanTimeout = setTimeout(() => {
              scanTimeout = null;
              runScan(gen, from, to);
            }, delay);
          };

          // If a Pro plugin registers a new provider, rescan everything.
          const unsubProviders = pluginRegistry.subscribeGrammar(() => {
            const ps = grammarPluginKey.getState(editorView.state) as GrammarPluginState | undefined;
            if (!ps?.enabled) return;
            const tr = editorView.state.tr.setMeta(grammarPluginKey, { rescanAll: true });
            editorView.dispatch(tr);
          });

          // If the user toggles a rule in the rules panel, rescan everything.
          const unsubStore = useEditorStore.subscribe((next, prev) => {
            const ps = grammarPluginKey.getState(editorView.state) as GrammarPluginState | undefined;
            if (!ps?.enabled) return;
            if (next.grammarRulesEnabled === prev.grammarRulesEnabled) return;
            const tr = editorView.state.tr.setMeta(grammarPluginKey, { rescanAll: true });
            editorView.dispatch(tr);
          });

          return {
            update(view: EditorView) {
              const ps = grammarPluginKey.getState(view.state) as GrammarPluginState | undefined;
              if (!ps?.enabled) {
                if (scanTimeout) {
                  clearTimeout(scanTimeout);
                  scanTimeout = null;
                }
                scanController?.abort();
                return;
              }
              if (ps.pendingFrom < 0) return;
              const isFullDocPending = ps.pendingFrom === 0 && ps.pendingTo === view.state.doc.content.size;
              schedule(ps.scanGen, ps.pendingFrom, ps.pendingTo, isFullDocPending ? INITIAL_SCAN_DELAY_MS : RESCAN_DEBOUNCE_MS);
            },
            destroy() {
              if (scanTimeout) clearTimeout(scanTimeout);
              scanController?.abort();
              unsubProviders();
              unsubStore();
            },
          };
        },
      }),
    ];
  },
});
