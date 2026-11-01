/**
 * The TipTap side of the command layer: how a command reads and edits the live
 * editor. Everything editorial (formatting, pagination, undo grouping) stays
 * here; commands only say what should happen in screenplay terms.
 */
import type { Editor } from '@tiptap/react';
import { Fragment } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import type { BlockSpec, CommandElement, EditorAdapter, ScriptContext } from './types';

const EXTENSION_RE = /\s*\([^)]*\)\s*/g;

/** "MARGO (V.O.)" -> "MARGO". */
function cueName(text: string): string {
  return text.replace(EXTENSION_RE, ' ').trim().replace(/\s+/g, ' ').toUpperCase();
}

export function createTiptapAdapter(editor: Editor): EditorAdapter {
  const readContext = (): ScriptContext => {
    const { state } = editor;
    const { $from } = state.selection;
    const characters: string[] = [];
    const scenes: string[] = [];
    let sceneHeading: string | null = null;

    state.doc.descendants((node, pos) => {
      if (node.type.name === 'sceneHeading') {
        scenes.push(node.textContent);
        if (pos < $from.pos) sceneHeading = node.textContent;
      } else if (node.type.name === 'character') {
        const name = cueName(node.textContent);
        if (name && !characters.includes(name)) characters.push(name);
      }
      return true;
    });

    const customType = $from.parent.attrs?.customTypeId;
    return {
      sceneHeading,
      element: typeof customType === 'string' && customType ? customType : $from.parent.type.name,
      selectionText: state.doc.textBetween(state.selection.from, state.selection.to, '\n'),
      paragraphText: $from.parent.textContent,
      paragraphEmpty: $from.parent.textContent.trim() === '',
      characters,
      scenes,
    };
  };

  const insertBlocks = (blocks: BlockSpec[]): void => {
    if (blocks.length === 0) return;
    const { state } = editor;
    const { $from } = state.selection;
    if ($from.depth < 1) return;

    // The top-level block that holds the caret. In normal screenplay editing
    // that is the paragraph itself; inside a wrapper it is the wrapper, whose
    // end is still a sensible insertion point.
    const block = $from.node(1);
    const blockPos = $from.before(1);
    const replaceEmpty = block.isTextblock && block.textContent.trim() === '';
    const from = replaceEmpty ? blockPos : blockPos + block.nodeSize;
    const to = replaceEmpty ? blockPos + block.nodeSize : from;

    const nodes = blocks.map((spec) => {
      const text = spec.type === 'character' && spec.extension
        ? `${spec.text} ${spec.extension}`
        : spec.text;
      return state.schema.nodeFromJSON({
        type: spec.type,
        ...(spec.type === 'character' && spec.extension
          ? { attrs: { extension: spec.extension } }
          : {}),
        content: text ? [{ type: 'text', text }] : [],
      });
    });
    const fragment = Fragment.fromArray(nodes);
    const tr = state.tr.replaceWith(from, to, fragment);
    // Put the caret at the end of the last inserted block, so the writer (or
    // the next command) carries on where the insertion stopped.
    const end = Math.min(from + fragment.size - 1, tr.doc.content.size);
    try {
      tr.setSelection(TextSelection.near(tr.doc.resolve(Math.max(1, end))));
    } catch {
      // An empty block can leave no text position to land on; an insertion
      // without moving the caret is still better than no insertion.
    }
    editor.view.dispatch(tr.scrollIntoView());
    editor.view.focus();
  };

  return {
    context: readContext,
    insertBlocks,
    setElement: (type: CommandElement) => {
      editor.chain().focus().setNode(type).run();
    },
    replaceSelection: (text: string, element?: CommandElement) => {
      const { from, to } = editor.state.selection;
      editor.chain().focus().insertContentAt({ from, to }, text).run();
      if (element) editor.chain().focus().setNode(element).run();
    },
    insertText: (text: string) => {
      editor.chain().focus().insertContent(text).run();
    },
    undo: () => {
      editor.commands.undo();
    },
    redo: () => {
      editor.commands.redo();
    },
  };
}
