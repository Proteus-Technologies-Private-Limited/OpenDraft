import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PmNode } from '@tiptap/pm/model';
import type { PageLayout } from '../stores/editorStore';

export const paginationPluginKey = new PluginKey('pagination');

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

// Space before each element type in lines
const SPACE_BEFORE: Record<string, number> = {
  sceneHeading: 1, action: 1, character: 1, dialogue: 0,
  parenthetical: 0, transition: 1, general: 0, shot: 1,
  newAct: 2, endOfAct: 2, lyrics: 0, showEpisode: 1, castList: 0,
};

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
}

export interface PaginationState {
  pageCount: number;
  breaks: BreakInfo[];
}

export function createPaginationPlugin(
  onUpdate: (state: PaginationState) => void,
  getLayout: () => PageLayout,
) {
  return new Plugin({
    key: paginationPluginKey,
    state: {
      init(_, state) {
        const result = computeBreaks(state.doc, getLayout());
        setTimeout(() => onUpdate(result), 0);
        return result;
      },
      apply(tr, oldState, _oldEditorState, newEditorState) {
        if (!tr.docChanged && !tr.getMeta('forceRepaginate')) return oldState;
        const result = computeBreaks(newEditorState.doc, getLayout());
        onUpdate(result);
        return result;
      },
    },
    props: {
      decorations(state) {
        const ps = paginationPluginKey.getState(state) as PaginationState | undefined;
        if (!ps || ps.breaks.length === 0) return DecorationSet.empty;
        const layout = getLayout();
        const { linesPerPage, sepHeightPx } = getPageMetrics(layout);
        const lineHeightPx = LINE_HEIGHT_PT * (96 / 72);
        const decos: Decoration[] = [];
        for (const brk of ps.breaks) {
          const whitespacePx = Math.max(0, linesPerPage - brk.linesOnPage) * lineHeightPx;
          // Dialogue splits need extra space for the CONT'D label on the next page
          const contdPx = brk.isDialogueSplit ? lineHeightPx : 0;
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

function getTextLines(text: string, cpl: number): number {
  return text.length === 0 ? 1 : Math.ceil(text.length / cpl);
}

function computeBreaks(doc: PmNode, layout: PageLayout): PaginationState {
  const { linesPerPage } = getPageMetrics(layout);

  interface NodeInfo {
    typeName: string; spaceBefore: number; text: string;
    offset: number; nodeSize: number;
  }
  const nodes: NodeInfo[] = [];
  let isFirst = true;
  doc.forEach((node, offset) => {
    const typeName = node.type.name;
    const sb = isFirst ? 0 : (SPACE_BEFORE[typeName] ?? 0);
    nodes.push({ typeName, spaceBefore: sb, text: node.textContent || '', offset, nodeSize: node.nodeSize });
    isFirst = false;
  });

  const breaks: BreakInfo[] = [];
  let lineCount = 0;
  let pageNumber = 2;
  let i = 0;

  while (i < nodes.length) {
    const node = nodes[i];
    const cpl = CHARS_PER_LINE[node.typeName] || 62;
    const textLines = getTextLines(node.text, cpl);
    const totalLines = node.spaceBefore + textLines;

    // Build character+dialogue block
    let blockLines = totalLines;
    let blockEnd = i;

    if (node.typeName === 'character' && i + 1 < nodes.length) {
      let j = i + 1;
      while (j < nodes.length && DIALOGUE_BLOCK_TYPES.has(nodes[j].typeName)) {
        const dn = nodes[j];
        const dc = CHARS_PER_LINE[dn.typeName] || 36;
        blockLines += dn.spaceBefore + getTextLines(dn.text, dc);
        j++;
      }
      blockEnd = j - 1;
    } else if (node.typeName === 'sceneHeading' && i + 1 < nodes.length) {
      const nn = nodes[i + 1];
      const nc = CHARS_PER_LINE[nn.typeName] || 62;
      blockLines += nn.spaceBefore + getTextLines(nn.text, nc);
      blockEnd = i + 1;
    }

    if (lineCount + blockLines > linesPerPage && lineCount > 0) {
      const remaining = linesPerPage - lineCount;

      // Try to split character+dialogue blocks
      if (node.typeName === 'character' && blockEnd > i) {
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
              characterName: node.text.trim(),
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
        isDialogueSplit: false, characterName: '',
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
