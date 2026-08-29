/**
 * A real ProseMirror schema for tests, built from the actual screenplay
 * extensions.
 *
 * The vitest environment is `node` (no DOM), so this deliberately excludes
 * extensions that reach outside the schema:
 *   - `ScreenplayImage` pulls in `services/api` → `authedFetch` → Tauri/`window`
 *   - `Grammar` / `SpellCheck` pull in stores and the spellchecker singleton
 * None of them affect inline text extraction, which is what these tests cover.
 *
 * Not named `*.test.ts` so vitest does not try to run it as a suite.
 */
import { getSchema } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Text from '@tiptap/extension-text';
import Bold from '@tiptap/extension-bold';
import Italic from '@tiptap/extension-italic';
import Underline from '@tiptap/extension-underline';
import Strike from '@tiptap/extension-strike';
import type { JSONContent } from '@tiptap/react';

import { ScreenplayHardBreak, HardBreakLeafText } from '../editor/extensions/ScreenplayHardBreak';
import { ScriptNoteMark } from '../editor/extensions/ScriptNoteMark';
import { TagMark } from '../editor/extensions/TagMark';
import { PastedHighlight } from '../editor/extensions/PastedHighlight';
import {
  SceneHeading, Action, Character, Dialogue, Parenthetical, Transition,
  General, Shot, NewAct, EndOfAct, Lyrics, ShowEpisode, CastList,
  Section, Note,
  TitlePage, CustomElement,
  DualDialogue, DualDialogueColumn,
  AvBlock, AvRow, AvCell, AvPara, AvShot, AvDirection,
  StartsNewPage,
} from '../editor/extensions';

export const testSchema = getSchema([
  Document.extend({ content: 'block+' }),
  Text,
  ScreenplayHardBreak,
  HardBreakLeafText,
  Bold, Italic, Underline, Strike,
  SceneHeading, Action, Character, Dialogue, Parenthetical, Transition,
  General, Shot, NewAct, EndOfAct, Lyrics, ShowEpisode, CastList,
  Section, Note,
  TitlePage, CustomElement,
  DualDialogue, DualDialogueColumn,
  AvBlock, AvRow, AvCell, AvPara, AvShot, AvDirection,
  StartsNewPage,
  ScriptNoteMark,
  TagMark,
  // Configured as the editor configures it: without `multicolor` the mark
  // carries no colour at all. It is here because a script note's own colour
  // used to be re-read through its parse rule — see editor/scriptNoteMarks.
  PastedHighlight.configure({ multicolor: true }),
]);

/** A hard break, for use in the `block()` builder. */
export const BR = { type: 'hardBreak' } as const;

type Part = string | typeof BR | JSONContent;

/** `block('action', 'Line one', BR, 'Line two')` */
export function block(type: string, ...parts: Part[]): JSONContent {
  return {
    type,
    content: parts.map((p) => (typeof p === 'string' ? { type: 'text', text: p } : p)),
  };
}

/** A mark by name, optionally with attributes. */
export type MarkSpec = string | { type: string; attrs: Record<string, unknown> };

/** A block with marks applied to its (single) text run. */
export function marked(type: string, text: string, ...marks: MarkSpec[]): JSONContent {
  return {
    type,
    content: [{
      type: 'text',
      text,
      marks: marks.map((m) => (typeof m === 'string' ? { type: m } : m)),
    }],
  };
}

export function doc(...blocks: JSONContent[]): JSONContent {
  return { type: 'doc', content: blocks };
}

/** Build a live ProseMirror node from the JSON above. */
export function pmDoc(json: JSONContent) {
  return testSchema.nodeFromJSON(json);
}
