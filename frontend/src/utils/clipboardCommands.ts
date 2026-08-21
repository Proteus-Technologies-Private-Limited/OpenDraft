/**
 * Cut, Copy and Paste for the app's own menus.
 *
 * These ran `document.execCommand('cut' | 'copy' | 'paste')`, which acts on the
 * *DOM* selection — and by the time a menu item is tapped, focus has left the
 * editor. On iOS that collapses the selection with it, so Cut and Copy quietly
 * did nothing; `execCommand('paste')` is not implemented by WebKit at all, so
 * Paste never worked from a menu on any platform. Long-press kept working the
 * whole time because that is WebKit's own editing callout, acting on the live
 * selection inside the web view rather than on anything we asked for.
 *
 * Everything here works from ProseMirror's selection instead, which does not
 * care where focus went, and writes through the async clipboard API, which does
 * not need a selection at all.
 *
 * Paste is the one that cannot be made whole. Reading the clipboard from a web
 * view needs `navigator.clipboard`, and on iOS every such read raises the system
 * "Paste" callout — even for text this very app copied a moment ago, because
 * WebKit judges the page, not the app that owns the pasteboard. That tap is the
 * platform's to demand; all we can do is fail with a message that says so.
 */
import type { Editor } from '@tiptap/react';
import { DOMSerializer } from '@tiptap/pm/model';
import { getOS } from '../services/platform';

export interface ClipboardResult {
  ok: boolean;
  /** Set when the command could not run; safe to show to the writer. */
  error?: string;
}

/** Said when the clipboard cannot be read, which on iOS is usually the prompt. */
function pasteFailureMessage(): string {
  return getOS() === 'ios'
    ? 'Could not read the clipboard. iOS asks permission for every paste — tap “Paste” when it appears, or press and hold in the script and use Paste there.'
    : 'Could not read the clipboard. Allow clipboard access for OpenDraft and try again.';
}

/**
 * The current selection as the two flavours a clipboard carries.
 *
 * `data-pm-slice` is what ProseMirror stamps on its own clipboard HTML, and
 * what marks a paste as coming from inside the editor — see PasteFormatting,
 * which leaves an internal paste's fonts alone on the strength of it. Copying
 * without it would make the editor's own copy look foreign to its own paste.
 */
export function serializeSelection(editor: Editor): { html: string; text: string } | null {
  const { state } = editor;
  if (state.selection.empty) return null;

  const slice = state.selection.content();
  const serializer = DOMSerializer.fromSchema(state.schema);
  const wrap = document.createElement('div');
  wrap.appendChild(serializer.serializeFragment(slice.content));

  const first = wrap.firstChild;
  if (first && first.nodeType === 1) {
    (first as HTMLElement).setAttribute('data-pm-slice', `${slice.openStart} ${slice.openEnd} []`);
  }

  return {
    html: wrap.innerHTML,
    // The separator ProseMirror uses for its own clipboard text: one blank line
    // between blocks, so a copied scene pastes back as separate elements rather
    // than one run-on paragraph.
    text: slice.content.textBetween(0, slice.content.size, '\n\n'),
  };
}

/**
 * Put both flavours on the clipboard, degrading rather than failing.
 *
 * `ClipboardItem` carries the HTML, so emphasis survives a copy; where it is
 * missing the plain text still goes over; and where the async API is missing
 * altogether we are back to `execCommand`, which at least works on a desktop
 * browser that never lost the selection in the first place.
 */
export async function writeClipboard(html: string, text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ]);
      return true;
    }
  } catch (err) {
    console.warn('[clipboard] rich copy failed, falling back to plain text:', err);
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) {
    console.warn('[clipboard] plain-text copy failed, falling back to execCommand:', err);
  }

  try {
    return document.execCommand('copy');
  } catch (err) {
    console.error('[clipboard] copy failed outright:', err);
    return false;
  }
}

/** Copy the selection. Returns ok:false with a reason when there is nothing to copy. */
export async function copySelection(editor: Editor | null): Promise<ClipboardResult> {
  if (!editor) return { ok: false };

  const payload = serializeSelection(editor);
  if (!payload) return { ok: false, error: 'Select something to copy first.' };

  const written = await writeClipboard(payload.html, payload.text);
  return written ? { ok: true } : { ok: false, error: 'Could not copy to the clipboard.' };
}

/**
 * Copy the selection and remove it.
 *
 * The delete only happens once the write has resolved: a cut that dropped the
 * text before the clipboard had it would lose the writer their words outright.
 */
export async function cutSelection(editor: Editor | null): Promise<ClipboardResult> {
  if (!editor) return { ok: false };

  // The range is read before the write is awaited, and deleted by range rather
  // than by "the selection" afterwards. Awaiting the clipboard hands control
  // back to the platform — on iOS to a system prompt — and whatever the
  // selection has become by the time it returns is not what was copied.
  const { from, to } = editor.state.selection;

  const result = await copySelection(editor);
  if (!result.ok) return result;

  editor.chain().focus().deleteRange({ from, to }).run();
  return { ok: true };
}

/**
 * Paste at the cursor, through ProseMirror's own paste path.
 *
 * `pasteHTML`/`pasteText` are the same entry points a keyboard paste uses, so
 * everything hung off a paste — the font stripping, image handling, the
 * screenplay schema's own parse rules — applies here too rather than being
 * quietly skipped by a menu item that inserts content directly.
 */
/**
 * Put the cursor back where the writer left it, before pasting into it.
 *
 * Reading the clipboard is asynchronous, and on iOS the writer spends that time
 * in a system prompt — outside the web view entirely. Focus comes back with the
 * selection collapsed to the top of the document, so a paste issued at "the
 * current selection" landed in the first element of the script (the scene
 * heading) rather than where the writer was typing. The range is captured
 * before the await and restored here, after it.
 */
function restoreCursor(editor: Editor, at: { from: number; to: number }): void {
  const size = editor.state.doc.content.size;
  const from = Math.min(at.from, size);
  const to = Math.min(at.to, size);
  editor.chain().focus().setTextSelection({ from, to }).run();
}

export async function pasteIntoEditor(editor: Editor | null): Promise<ClipboardResult> {
  if (!editor) return { ok: false };

  const at = editor.state.selection;

  // The HTML flavour, so this menu item and the long-press callout produce the
  // same paste. It briefly did not: iOS charges a system "Paste" prompt for
  // every touch of the clipboard and the item API costs two — one to `read()`,
  // another for `getType()` — so this took the single-prompt `readText()` route
  // instead and quietly dropped bold, italic and colour with the plain text.
  // A second prompt is worth less than a paste that loses the writer's
  // emphasis, so the rich path is used everywhere.
  if (navigator.clipboard?.read && typeof ClipboardItem !== 'undefined') {
    try {
      const items = await navigator.clipboard.read();
      // Exactly one `getType`, whichever flavour is richest: on iOS each one is
      // another prompt, so asking for HTML and then for text would cost three.
      const html = items.find((item) => item.types.includes('text/html'));
      if (html) {
        const markup = await (await html.getType('text/html')).text();
        if (markup) {
          restoreCursor(editor, at);
          if (editor.view.pasteHTML(markup)) return { ok: true };
        }
      }
      const plain = items.find((item) => item.types.includes('text/plain'));
      if (plain) {
        const text = await (await plain.getType('text/plain')).text();
        if (text) {
          restoreCursor(editor, at);
          if (editor.view.pasteText(text)) return { ok: true };
        }
      }
      return { ok: false, error: 'The clipboard is empty.' };
    } catch (err) {
      console.error('[clipboard] read failed:', err);
      return { ok: false, error: pasteFailureMessage() };
    }
  }

  try {
    const text = await navigator.clipboard.readText();
    if (!text) return { ok: false, error: 'The clipboard is empty.' };
    restoreCursor(editor, at);
    editor.view.pasteText(text);
    return { ok: true };
  } catch (err) {
    console.error('[clipboard] readText failed:', err);
    return { ok: false, error: pasteFailureMessage() };
  }
}

/**
 * Paste as plain text, dropping whatever styling the source carried.
 *
 * Distinct from {@link pasteIntoEditor}: this deliberately never asks for the
 * HTML flavour, so the text arrives as the destination element's own.
 */
export async function pasteWithoutFormatting(editor: Editor | null): Promise<ClipboardResult> {
  if (!editor) return { ok: false };

  const at = editor.state.selection;
  try {
    const text = await navigator.clipboard.readText();
    if (!text) return { ok: false, error: 'The clipboard is empty.' };
    restoreCursor(editor, at);
    editor.view.pasteText(text);
    return { ok: true };
  } catch (err) {
    console.error('[clipboard] readText failed:', err);
    return { ok: false, error: pasteFailureMessage() };
  }
}
