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

/** A block with marks applied to its (single) text run. */
export function marked(type: string, text: string, ...markNames: string[]): JSONContent {
  return {
    type,
    content: [{ type: 'text', text, marks: markNames.map((m) => ({ type: m })) }],
  };
}

export function doc(...blocks: JSONContent[]): JSONContent {
  return { type: 'doc', content: blocks };
}

/** Build a live ProseMirror node from the JSON above. */
export function pmDoc(json: JSONContent) {
  return testSchema.nodeFromJSON(json);
}
