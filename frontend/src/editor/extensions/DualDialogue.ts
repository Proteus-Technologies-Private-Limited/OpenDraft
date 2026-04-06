import { Node, mergeAttributes } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { showToast } from '../../components/Toast';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    dualDialogue: {
      toggleDualDialogue: () => ReturnType;
    };
  }
}

/**
 * Column wrapper inside a DualDialogue.
 */
export const DualDialogueColumn = Node.create({
  name: 'dualDialogueColumn',
  content: '(character | dialogue | parenthetical)+',
  defining: true,
  isolating: true,

  parseHTML() {
    return [{ tag: 'div[data-type="dual-dialogue-column"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'dual-dialogue-column',
        class: 'dual-dialogue-column',
      }),
      0,
    ];
  },
});

const DIALOGUE_NODE_TYPES = new Set(['character', 'dialogue', 'parenthetical']);

/**
 * DualDialogue container — two columns side by side.
 */
export const DualDialogue = Node.create({
  name: 'dualDialogue',
  group: 'block',
  content: 'dualDialogueColumn dualDialogueColumn',
  defining: true,
  isolating: true,

  parseHTML() {
    return [{ tag: 'div[data-type="dual-dialogue"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'dual-dialogue',
        class: 'screenplay-element dual-dialogue',
      }),
      0,
    ];
  },

  addCommands() {
    return {
      toggleDualDialogue: () => ({ editor, tr, dispatch }) => {
        const { state } = editor;
        const { $from } = state.selection;

        // If already inside a dualDialogue, unwrap it
        for (let d = $from.depth; d >= 0; d--) {
          const node = $from.node(d);
          if (node.type.name === 'dualDialogue') {
            if (!dispatch) return true;
            const start = $from.before(d);
            const end = $from.after(d);
            const children: PmNode[] = [];
            node.forEach((col: PmNode) => {
              col.forEach((child: PmNode) => {
                children.push(child);
              });
            });
            tr.replaceWith(start, end, children);
            dispatch(tr);
            return true;
          }
        }

        // Collect top-level blocks using doc.resolve to get correct positions
        const doc = state.doc;
        interface BlockInfo { pos: number; end: number; node: PmNode; }
        const blocks: BlockInfo[] = [];

        let scanPos = 1; // first child starts at position 1 (after doc open tag)
        for (let i = 0; i < doc.childCount; i++) {
          const child = doc.child(i);
          const resolved = doc.resolve(scanPos);
          const before = resolved.before(resolved.depth);
          const after = resolved.after(resolved.depth);
          blocks.push({ pos: before, end: after, node: child });
          scanPos = after + 1;
          // Safety: don't go past doc
          if (scanPos > doc.content.size) break;
        }

        // Find cursor block
        const cursorPos = $from.pos;
        let curIdx = -1;
        for (let i = 0; i < blocks.length; i++) {
          if (cursorPos >= blocks[i].pos && cursorPos <= blocks[i].end) {
            curIdx = i;
            break;
          }
        }

        if (curIdx < 0) {
          showToast('Place cursor on a character or dialogue element', 'error');
          return false;
        }

        // Find the dialogue group containing cursor (walk back to character)
        let g1Start = curIdx;
        while (g1Start > 0 && DIALOGUE_NODE_TYPES.has(blocks[g1Start - 1].node.type.name)) {
          g1Start--;
        }
        if (blocks[g1Start].node.type.name !== 'character') {
          for (let i = curIdx; i >= 0; i--) {
            if (blocks[i].node.type.name === 'character') { g1Start = i; break; }
            if (!DIALOGUE_NODE_TYPES.has(blocks[i].node.type.name)) break;
          }
        }
        if (blocks[g1Start].node.type.name !== 'character') {
          showToast('Place cursor on a character or dialogue element', 'error');
          return false;
        }

        // First group: character + following dialogue/parenthetical
        let g1End = g1Start;
        for (let i = g1Start + 1; i < blocks.length; i++) {
          const t = blocks[i].node.type.name;
          if (t === 'dialogue' || t === 'parenthetical') { g1End = i; }
          else break;
        }

        // Look for second group after first
        let g2Start = g1End + 1;
        let g2End = -1;
        if (g2Start < blocks.length && blocks[g2Start].node.type.name === 'character') {
          g2End = g2Start;
          for (let i = g2Start + 1; i < blocks.length; i++) {
            const t = blocks[i].node.type.name;
            if (t === 'dialogue' || t === 'parenthetical') { g2End = i; }
            else break;
          }
        }

        // If no second group after, maybe cursor is on the second group — look before
        if (g2End < 0) {
          let prevEnd = g1Start - 1;
          if (prevEnd >= 0 && DIALOGUE_NODE_TYPES.has(blocks[prevEnd].node.type.name)) {
            let prevStart = prevEnd;
            while (prevStart > 0 && DIALOGUE_NODE_TYPES.has(blocks[prevStart - 1].node.type.name)) {
              prevStart--;
            }
            if (blocks[prevStart].node.type.name === 'character') {
              // Previous group is first, current is second
              g2Start = g1Start;
              g2End = g1End;
              g1Start = prevStart;
              g1End = g2Start - 1;
              // Recalculate g1End
              for (let i = g1Start + 1; i < g2Start; i++) {
                const t = blocks[i].node.type.name;
                if (t === 'dialogue' || t === 'parenthetical') g1End = i;
                else break;
              }
            }
          }
        }

        if (g2End < 0) {
          showToast('Dual dialogue requires two adjacent character/dialogue groups', 'error');
          return false;
        }

        if (!dispatch) return true;

        // Build the dual dialogue node
        const col1Nodes: PmNode[] = [];
        for (let i = g1Start; i <= g1End; i++) col1Nodes.push(blocks[i].node);
        const col2Nodes: PmNode[] = [];
        for (let i = g2Start; i <= g2End; i++) col2Nodes.push(blocks[i].node);

        const { schema } = state;
        const col1 = schema.nodes.dualDialogueColumn.create(null, col1Nodes);
        const col2 = schema.nodes.dualDialogueColumn.create(null, col2Nodes);
        const dualNode = schema.nodes.dualDialogue.create(null, [col1, col2]);

        // Use the positions from doc.resolve which are correct absolute positions
        const from = blocks[g1Start].pos;
        const to = blocks[g2End].end;

        tr.replaceWith(from, to, dualNode);
        dispatch(tr);
        return true;
      },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-d': () => {
        return this.editor.commands.toggleDualDialogue();
      },
    };
  },
});
