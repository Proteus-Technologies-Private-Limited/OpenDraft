/**
 * "Paste as Fountain" — read plain text from the clipboard, parse it as
 * Fountain markup, and insert real screenplay elements at the cursor.
 *
 * An ordinary paste drops the text in as whatever element the cursor is
 * already in, so a script copied out of a Fountain file, a forum post or
 * another app arrives as one undifferentiated block.  This runs it through the
 * Fountain parser first, so scene headings, cues, dialogue and transitions
 * come out as the elements they describe.
 */
import type { Editor } from '@tiptap/react';
import type { JSONContent } from '@tiptap/react';
import { parseFountain } from './fountainParser';
import { pasteFailureMessage, readNativeText } from './clipboardCommands';

/**
 * Parse `text` as Fountain and insert it at the current selection.
 * Returns false when there was nothing to insert.
 */
export function insertFountainText(editor: Editor, text: string): boolean {
  if (!text || text.trim() === '') return false;

  const parsed = parseFountain(text) as JSONContent;
  const content = parsed.content ?? [];
  if (content.length === 0) return false;

  // Insert the blocks themselves, not the doc wrapper — setContent would
  // replace the whole script rather than paste into it.
  editor.chain().focus().insertContent(content).run();
  return true;
}

export interface PasteFountainResult {
  ok: boolean;
  /** Set when the paste could not happen; safe to show to the user. */
  error?: string;
}

/**
 * Read the clipboard and insert its text as Fountain.
 *
 * Clipboard reads need an explicit permission in the browser and a focused
 * document everywhere, so failure is normal enough to report rather than throw.
 * The Android web view refuses the permission outright, so a refusal falls
 * through to the platform's own clipboard the way the other pastes do
 * (issue #102). This one loses nothing by it: Fountain is plain text already.
 *
 * The failure message is the shared one. It used to be a second hard-coded
 * copy, which is why this path told an iPhone user to "allow clipboard access"
 * instead of telling them to tap the Paste prompt iOS was showing them.
 */
export async function pasteAsFountain(editor: Editor): Promise<PasteFountainResult> {
  let text: string;
  try {
    text = await navigator.clipboard.readText();
  } catch (err) {
    console.error('Paste as Fountain: clipboard read failed', err);
    const native = await readNativeText();
    if (!native) return { ok: false, error: pasteFailureMessage() };
    text = native;
  }

  if (!insertFountainText(editor, text)) {
    return { ok: false, error: 'The clipboard is empty.' };
  }
  return { ok: true };
}
