import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import type { Node as PmNode } from '@tiptap/pm/model';
import type { PageLayout } from '../stores/editorStore';
import { resolveMoresContds } from '../stores/editorStore';
import { singleLine } from '../utils/nodeText';
// Line counting lives with the PDF exporter's word wrapper — the two must
// agree exactly or the editor paginates differently from the exported file.
import { getTextLines } from '../utils/wrapText';
import { DEFAULT_SPACE_BEFORE, buildSpaceBefore, getSpaceBefore, type SpaceBeforeSource } from '../utils/elementSpacing';
import { findTitlePageRegion, titlePageAttrsCarryData } from '../utils/titlePageRegion';
import { useFormattingTemplateStore } from '../stores/formattingTemplateStore';

export const paginationPluginKey = new PluginKey('pagination');

/** Template hints that influence pagination — supplied by the active FormattingTemplate. */
export interface TemplateHints {
  /** Element ids that must start on a new page (e.g. sitcom: every sceneHeading). */
  forceBreakBefore: Set<string>;
  /** Per-element line-height multiplier (e.g. dialogue: 2.0 for double-spaced sitcom). */
  lineHeightMultiplier: Record<string, number>;
  /**
   * Blank lines before each element, from the template's per-element
   * `marginTop`. Previously pagination used a hardcoded map, so a template that
   * changed an element's spacing moved it on screen but not in the page count.
   */
  spaceBefore: Record<string, number>;
}

const EMPTY_HINTS: TemplateHints = {
  forceBreakBefore: new Set(),
  lineHeightMultiplier: {},
  spaceBefore: DEFAULT_SPACE_BEFORE,
};

/** Source shape for hints — the subset of FormattingTemplate pagination cares about. */
export interface HintSource extends SpaceBeforeSource {
  forceBreakBefore?: string[];
  lineHeightMultiplier?: Record<string, number>;
}

// computeBreaks runs on every doc change, so cache the derived Set per template
// object rather than rebuilding it on each keystroke.
const hintCache = new WeakMap<object, TemplateHints>();

/** Derive pagination hints from a formatting template (memoized per template object). */
export function buildTemplateHints(tpl: HintSource | null | undefined): TemplateHints {
  if (!tpl) return EMPTY_HINTS;
  const cached = hintCache.get(tpl as object);
  if (cached) return cached;
  const hints: TemplateHints = {
    forceBreakBefore: new Set(tpl.forceBreakBefore ?? []),
    lineHeightMultiplier: tpl.lineHeightMultiplier ?? {},
    spaceBefore: buildSpaceBefore(tpl),
  };
  hintCache.set(tpl as object, hints);
  return hints;
}

/**
 * Hints for the active template with any per-document spacing override applied.
 *
 * Use this, not `buildTemplateHints`, anywhere a real open document is being
 * paginated. `buildTemplateHints` is memoized on the template object and
 * deliberately knows nothing about document state, so an override would never
 * invalidate its cache.
 */
export function activeTemplateHints(): TemplateHints {
  try {
    const tpl = useFormattingTemplateStore.getState().getActiveTemplate();
    return { ...buildTemplateHints(tpl), spaceBefore: getSpaceBefore() };
  } catch (err) {
    console.warn('[pagination] could not read template hints', err);
    return EMPTY_HINTS;
  }
}

/** Resolve the effective element id for a top-level node (built-in name or customTypeId). */
function getElementId(node: PmNode): string {
  if (node.type.name === 'customElement') {
    const t = (node.attrs as { customTypeId?: string }).customTypeId;
    if (t) return t;
  }
  return node.type.name;
}

const LINE_HEIGHT_PT = 12;

// Final Draft Courier ≈ 10.33 chars/inch
const FD_CPI = 10.33;

// Final Draft absolute indents from page edge (inches)
const FD_INDENTS: Record<string, [number, number]> = {
  sceneHeading: [1.50, 7.50], action: [1.50, 7.50], character: [3.50, 7.50],
  dialogue: [2.50, 6.00], parenthetical: [3.00, 5.50], transition: [5.50, 7.50],
  general: [1.50, 7.50], shot: [1.50, 7.50], newAct: [1.50, 7.50],
  endOfAct: [1.50, 7.50], lyrics: [2.50, 6.00], showEpisode: [1.50, 7.50],
  castList: [1.50, 7.50],
};

const CHARS_PER_LINE: Record<string, number> = {};
for (const [type, [l, r]] of Object.entries(FD_INDENTS)) {
  CHARS_PER_LINE[type] = Math.round((r - l) * FD_CPI);
}

// Space before each element now comes from the template, via
// hints.spaceBefore — see utils/elementSpacing.ts for the defaults.

const DIALOGUE_BLOCK_TYPES = new Set(['dialogue', 'parenthetical', 'lyrics']);

export function getPageMetrics(layout: PageLayout) {
  const contentHeightPt = layout.pageHeight * 72 - layout.topMargin - layout.bottomMargin;
  const linesPerPage = Math.floor(contentHeightPt / LINE_HEIGHT_PT);
  const lineHeightPx = LINE_HEIGHT_PT * (96 / 72);
  const pageContentPx = linesPerPage * lineHeightPx;
  const sepHeightPx = Math.round(
    (layout.bottomMargin / 72) * 96 + 40 + (layout.topMargin / 72) * 96
  );
  const contentStartPx = (layout.topMargin / 72) * 96;
  return { linesPerPage, pageContentPx, sepHeightPx, contentStartPx };
}

export interface BreakInfo {
  nodeIndex: number;
  offset: number;
  nodeSize: number;
  pageNumber: number;
  linesOnPage: number;
  isDialogueSplit: boolean;
  characterName: string;
  /** True for the break that separates the title page from the script body.
   *  The title page is its own unnumbered page and is not part of the script
   *  page count, so this break does not consume a page number. */
  isTitlePage: boolean;
}

export interface PaginationState {
  pageCount: number;
  breaks: BreakInfo[];
}

/** True when two break sets would place content differently on the page. */
function breaksDiffer(a: PaginationState, b: PaginationState): boolean {
  if (a.breaks.length !== b.breaks.length) return true;
  for (let i = 0; i < a.breaks.length; i++) {
    if (a.breaks[i].offset !== b.breaks[i].offset) return true;
    if (a.breaks[i].linesOnPage !== b.breaks[i].linesOnPage) return true;
  }
  return false;
}

/** Nearest scrollable ancestor — the editor scrolls inside a pane, not the window. */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement || null;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

/** Is the caret inside the visible area of the scrolling pane? */
function caretVisible(view: EditorView): boolean {
  try {
    const coords = view.coordsAtPos(view.state.selection.head);
    const pane = scrollParent(view.dom as HTMLElement);
    const box = pane
      ? pane.getBoundingClientRect()
      : { top: 0, bottom: window.innerHeight } as DOMRect;
    return coords.top >= box.top && coords.bottom <= box.bottom;
  } catch {
    // Position not renderable yet — treat as visible so we never scroll blindly.
    return true;
  }
}

export function createPaginationPlugin(
  onUpdate: (state: PaginationState) => void,
  getLayout: () => PageLayout,
  getHints: () => TemplateHints = () => EMPTY_HINTS,
) {
  // An edit that introduces a page break moves the caret a whole page down, but
  // the transaction's own scrollIntoView ran before these decorations existed —
  // so ProseMirror measured the pre-break position and stayed put. Re-reveal the
  // caret once the margins are actually in the DOM.
  let revealCaret = false;

  return new Plugin({
    key: paginationPluginKey,
    state: {
      init(_, state) {
        const result = computeBreaks(state.doc, getLayout(), getHints());
        setTimeout(() => onUpdate(result), 0);
        return result;
      },
      apply(tr, oldState, _oldEditorState, newEditorState) {
        if (!tr.docChanged && !tr.getMeta('forceRepaginate')) return oldState;
        const result = computeBreaks(newEditorState.doc, getLayout(), getHints());
        // Only for real edits: a template or page-layout repagination must not
        // yank the view around while the writer is looking somewhere else.
        if (tr.docChanged && breaksDiffer(oldState, result)) revealCaret = true;
        onUpdate(result);
        return result;
      },
    },

    view() {
      return {
        update(view: EditorView) {
          if (!revealCaret) return;
          revealCaret = false;
          // Wait for the decoration margins to be laid out before measuring.
          requestAnimationFrame(() => {
            if (view.isDestroyed || caretVisible(view)) return;
            // docChanged is false here, so this dispatch cannot re-arm the flag.
            view.dispatch(view.state.tr.setMeta('addToHistory', false).scrollIntoView());
          });
        },
      };
    },
    props: {
      decorations(state) {
        const ps = paginationPluginKey.getState(state) as PaginationState | undefined;
        if (!ps || ps.breaks.length === 0) return DecorationSet.empty;
        const layout = getLayout();
        const { linesPerPage, sepHeightPx } = getPageMetrics(layout);
        const lineHeightPx = LINE_HEIGHT_PT * (96 / 72);
        // Only reserve room for the CONT'D label when the marker is actually shown.
        const showDialogueBreakContd = resolveMoresContds(layout).dialogueBreakContd;
        const decos: Decoration[] = [];
        for (const brk of ps.breaks) {
          const whitespacePx = Math.max(0, linesPerPage - brk.linesOnPage) * lineHeightPx;
          // Dialogue splits need extra space for the CONT'D label on the next page
          const contdPx = brk.isDialogueSplit && showDialogueBreakContd ? lineHeightPx : 0;
          const marginTop = Math.round(whitespacePx + sepHeightPx + contdPx);
          decos.push(
            Decoration.node(brk.offset, brk.offset + brk.nodeSize, {
              style: `margin-top: ${marginTop}px !important`,
            })
          );
        }
        return DecorationSet.create(state.doc, decos);
      },
    },
  });
}

export function computeBreaks(doc: PmNode, layout: PageLayout, hints: TemplateHints = EMPTY_HINTS): PaginationState {
  const { linesPerPage } = getPageMetrics(layout);

  interface NodeInfo {
    typeName: string; elementId: string; spaceBefore: number; text: string;
    offset: number; nodeSize: number; lineMul: number; fixedLines?: number;
    startsNewPage: boolean; hasTitleData: boolean;
  }
  const nodes: NodeInfo[] = [];
  let isFirst = true;
  doc.forEach((node, offset) => {
    const typeName = node.type.name;
    const elementId = getElementId(node);
    const sb = isFirst ? 0 : (hints.spaceBefore[elementId] ?? 0);
    const lineMul = hints.lineHeightMultiplier[elementId] ?? 1;
    // Images occupy a fixed estimated number of lines (no text to wrap).
    const fixedLines = typeName === 'screenplayImage'
      ? Math.max(1, Number(node.attrs?.heightLines) || 8)
      : undefined;
    nodes.push({
      typeName, elementId, spaceBefore: sb, text: node.textContent || '',
      offset, nodeSize: node.nodeSize, lineMul, fixedLines,
      startsNewPage: node.attrs?.startsNewPage === true,
      hasTitleData: titlePageAttrsCarryData(node.attrs as Record<string, unknown> | undefined),
    });
    isFirst = false;
  });

  const breaks: BreakInfo[] = [];
  let lineCount = 0;
  let pageNumber = 2;
  let i = 0;
  // Title page handling: the leading title-page region forms a separate,
  // unnumbered page, and the script body starts on a fresh one after it.
  //
  // The region is resolved by the same helper the PDF and DOCX exporters use, so
  // the break the writer sees on screen is the break they get in the file — the
  // two used to part company as soon as anything sat above the title (#52).
  const titleRegion = findTitlePageRegion(
    nodes.map((n) => ({
      type: n.typeName,
      hasText: n.text.trim().length > 0,
      hasTitleData: n.hasTitleData,
    })),
  );
  const titleRegionLength = titleRegion.isReal ? titleRegion.length : 0;
  let titleBroken = false;

  while (i < nodes.length) {
    const node = nodes[i];

    if (!titleBroken && titleRegionLength > 0 && i >= titleRegionLength && lineCount > 0) {
      // First script element after the title page → start it on a fresh page.
      // pageNumber stays at its current value (the title page does not consume a
      // number); the body's first page remains the implicit unnumbered page 1.
      titleBroken = true;
      breaks.push({
        nodeIndex: i,
        offset: node.offset, nodeSize: node.nodeSize,
        pageNumber: 1, linesOnPage: lineCount,
        isDialogueSplit: false, characterName: '', isTitlePage: true,
      });
      lineCount = 0; // fall through and lay this node out at the top of the body page
    }

    const cpl = CHARS_PER_LINE[node.typeName] || 62;
    const textLines = node.fixedLines !== undefined
      ? node.fixedLines
      : getTextLines(node.text, cpl) * node.lineMul;
    const totalLines = node.spaceBefore + textLines;

    // An element that must open its own page can never be absorbed into the
    // block above it — doing so would skip past it and its break would never be
    // evaluated (e.g. a scene heading swallowing the act that follows it).
    const opensOwnPage = (n: NodeInfo) =>
      n.startsNewPage || hints.forceBreakBefore.has(n.elementId);

    // Build character+dialogue block
    let blockLines = totalLines;
    let blockEnd = i;

    if (node.typeName === 'character' && i + 1 < nodes.length) {
      let j = i + 1;
      while (j < nodes.length && DIALOGUE_BLOCK_TYPES.has(nodes[j].typeName) && !opensOwnPage(nodes[j])) {
        const dn = nodes[j];
        const dc = CHARS_PER_LINE[dn.typeName] || 36;
        blockLines += dn.spaceBefore + getTextLines(dn.text, dc) * dn.lineMul;
        j++;
      }
      blockEnd = j - 1;
    } else if (node.typeName === 'sceneHeading' && i + 1 < nodes.length && !opensOwnPage(nodes[i + 1])) {
      const nn = nodes[i + 1];
      const nc = CHARS_PER_LINE[nn.typeName] || 62;
      blockLines += nn.spaceBefore + getTextLines(nn.text, nc) * nn.lineMul;
      blockEnd = i + 1;
    }

    // Force break: the template can require certain elements to start a new page
    // (e.g. sitcom sceneHeading, TV newAct), or the writer can flag a single
    // element manually via Format → Start On New Page.
    const forceBreak = lineCount > 0
      && (node.startsNewPage || hints.forceBreakBefore.has(node.elementId));

    if ((forceBreak || lineCount + blockLines > linesPerPage) && lineCount > 0) {
      const remaining = linesPerPage - lineCount;

      // Try to split character+dialogue blocks. A forced break is never split —
      // the whole point is that the element opens a page of its own.
      if (!forceBreak && node.typeName === 'character' && blockEnd > i) {
        const charLines = node.spaceBefore + getTextLines(node.text, CHARS_PER_LINE[node.typeName] || 41);

        const MIN_DL = 2; // FD: at least 2 lines of dialogue on each side of split

        // Can we fit character + at least 2 lines of dialogue?
        if (remaining >= charLines + MIN_DL) {
          let fittedLines = charLines;
          let lastFittedNode = i;
          let fittedDL = 0;
          for (let j = i + 1; j <= blockEnd; j++) {
            const dn = nodes[j];
            const dc = CHARS_PER_LINE[dn.typeName] || 36;
            const dl = getTextLines(dn.text, dc);
            const dnTotal = dn.spaceBefore + dl;
            if (fittedLines + dnTotal <= remaining) {
              fittedLines += dnTotal;
              fittedDL += dl;
              lastFittedNode = j;
            } else {
              break;
            }
          }

          // Check remaining dialogue lines on next page >= 2
          let remainDL = 0;
          for (let j = lastFittedNode + 1; j <= blockEnd; j++) {
            const dn = nodes[j];
            const dc = CHARS_PER_LINE[dn.typeName] || 36;
            remainDL += getTextLines(dn.text, dc);
          }

          if (lastFittedNode > i && fittedDL >= MIN_DL && remainDL >= MIN_DL) {
            lineCount += fittedLines;
            const splitIdx = lastFittedNode + 1;
            const splitNode = splitIdx < nodes.length ? nodes[splitIdx] : nodes[blockEnd];
            breaks.push({
              nodeIndex: Math.min(splitIdx, nodes.length - 1),
              offset: splitNode.offset, nodeSize: splitNode.nodeSize,
              pageNumber, linesOnPage: lineCount,
              isDialogueSplit: true,
              // One line by definition — this becomes the (MORE)/(CONT'D)
              // page-break label, which a newline would break.
              characterName: singleLine(node.text),
              isTitlePage: false,
            });
            pageNumber++;
            lineCount = 1; // CONT'D line
            for (let j = splitIdx; j <= blockEnd; j++) {
              if (j >= nodes.length) break;
              const dn = nodes[j];
              const dc = CHARS_PER_LINE[dn.typeName] || 36;
              lineCount += (j === splitIdx ? getTextLines(dn.text, dc) : dn.spaceBefore + getTextLines(dn.text, dc));
            }
            i = blockEnd + 1;
            continue;
          }
        }
      }

      // Default: push entire block to next page
      breaks.push({
        nodeIndex: i,
        offset: node.offset, nodeSize: node.nodeSize,
        pageNumber, linesOnPage: lineCount,
        isDialogueSplit: false, characterName: '', isTitlePage: false,
      });
      pageNumber++;
      lineCount = blockLines - node.spaceBefore;
    } else {
      lineCount += blockLines;
    }

    i = blockEnd + 1;
  }

  return { pageCount: pageNumber - 1, breaks };
}

// ── Scene length computation ────────────────────────────────────────────

/**
 * Compute the length of each scene in pages (decimal).
 * Returns an array of page lengths, one per scene heading in document order.
 */
export function computeSceneLengths(
  doc: PmNode,
  layout: PageLayout,
  hints: TemplateHints = EMPTY_HINTS,
): number[] {
  const { linesPerPage } = getPageMetrics(layout);
  const lengths: number[] = [];
  let sceneLines = 0;
  let inScene = false;
  let nodeIdx = 0;

  doc.forEach((node) => {
    const typeName = node.type.name;
    const cpl = CHARS_PER_LINE[typeName] || 62;
    const textLines = getTextLines(node.textContent || '', cpl);
    const sb = nodeIdx === 0 ? 0 : (hints.spaceBefore[typeName] ?? 0);

    if (typeName === 'sceneHeading') {
      if (inScene) lengths.push(sceneLines / linesPerPage);
      sceneLines = sb + textLines;
      inScene = true;
    } else if (inScene) {
      sceneLines += sb + textLines;
    }
    nodeIdx++;
  });
  if (inScene) lengths.push(sceneLines / linesPerPage);
  return lengths;
}

// ── Page block computation for page preview ─────────────────────────────

export interface PageBlockInfo {
  typeName: string;
  lineStart: number;
  lineCount: number;
  docPos: number;
  text: string;
}

export interface PageContentInfo {
  pageNumber: number;
  blocks: PageBlockInfo[];
  linesPerPage: number;
}

/**
 * Compute content blocks per page for page-preview thumbnails.
 * Uses the same break algorithm as the pagination plugin for accuracy.
 */
export function computePageBlocks(
  doc: PmNode,
  layout: PageLayout,
  hints: TemplateHints = EMPTY_HINTS,
): PageContentInfo[] {
  const { linesPerPage } = getPageMetrics(layout);
  const { breaks } = computeBreaks(doc, layout, hints);

  // Collect top-level nodes
  const nodes: { typeName: string; text: string; offset: number }[] = [];
  doc.forEach((node, offset) => {
    nodes.push({ typeName: node.type.name, text: node.textContent || '', offset });
  });

  if (nodes.length === 0) return [];

  // Determine page boundaries from breaks
  const pageBounds: { pageNumber: number; startNode: number; endNode: number; dialogueSplit: boolean }[] = [];

  if (breaks.length === 0) {
    pageBounds.push({ pageNumber: 1, startNode: 0, endNode: nodes.length - 1, dialogueSplit: false });
  } else {
    // Page 1
    if (breaks[0].nodeIndex > 0) {
      pageBounds.push({ pageNumber: 1, startNode: 0, endNode: breaks[0].nodeIndex - 1, dialogueSplit: false });
    }
    // Pages from breaks
    for (let i = 0; i < breaks.length; i++) {
      const endNode = i + 1 < breaks.length ? breaks[i + 1].nodeIndex - 1 : nodes.length - 1;
      pageBounds.push({
        pageNumber: breaks[i].pageNumber,
        startNode: breaks[i].nodeIndex,
        endNode,
        dialogueSplit: breaks[i].isDialogueSplit,
      });
    }
  }

  // Build page content
  const pages: PageContentInfo[] = [];

  for (const pb of pageBounds) {
    if (pb.startNode > pb.endNode || pb.startNode >= nodes.length) continue;
    const blocks: PageBlockInfo[] = [];
    let lineOnPage = pb.dialogueSplit ? 1 : 0; // 1 for CONT'D overhead
    let firstOnPage = true;

    for (let i = pb.startNode; i <= Math.min(pb.endNode, nodes.length - 1); i++) {
      const node = nodes[i];
      const cpl = CHARS_PER_LINE[node.typeName] || 62;
      const textLines = getTextLines(node.text, cpl);
      const sb = firstOnPage ? 0 : (hints.spaceBefore[node.typeName] ?? 0);
      firstOnPage = false;

      blocks.push({
        typeName: node.typeName,
        lineStart: lineOnPage + sb,
        lineCount: textLines,
        docPos: node.offset,
        text: node.text,
      });
      lineOnPage += sb + textLines;
    }

    pages.push({ pageNumber: pb.pageNumber, blocks, linesPerPage });
  }

  return pages;
}
