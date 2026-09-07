/**
 * Applies a script-format template to the editor: sets the active formatting
 * template (so CSS, toolbar elements, and pagination hints update) and seeds
 * the document with the template's starter content.
 *
 * Used by the New Screenplay flow after the user picks a format. The id may
 * name a built-in format or one of the writer's own templates — callers must
 * have awaited `ensureTemplatesLoaded()` for the latter to resolve.
 */

import type { Editor } from '@tiptap/react';
import { findTemplate, useFormattingTemplateStore } from '../stores/formattingTemplateStore';
import { INDUSTRY_STANDARD_ID } from '../stores/formattingTypes';

const DEFAULT_DOC = {
  type: 'doc',
  content: [{ type: 'sceneHeading', content: [] as unknown[] }],
};

export function applyScriptFormat(editor: Editor | null, templateId: string): void {
  if (!editor || editor.isDestroyed) return;

  const tpl = findTemplate(templateId);
  if (!tpl && templateId !== INDUSTRY_STANDARD_ID) {
    // Nothing answers to the id — a template deleted on another device, or one
    // asked for before its storage had loaded. Industry Standard is the honest
    // fallback, but say so rather than leaving the writer to wonder why their
    // format did not take.
    console.warn('[applyScriptFormat] unknown template id, using Industry Standard', templateId);
  }
  // Industry Standard is the implicit default — store represents it as null.
  const idForStore = tpl && templateId !== INDUSTRY_STANDARD_ID ? templateId : null;
  useFormattingTemplateStore.getState().setActiveTemplateId(idForStore);

  // Tiptap's setContent has a tightly-typed signature; the prior inline call site
  // in MenuBar uses the same shape, but extracted into a helper TS narrows it. Cast
  // to `any` at the boundary — Tiptap accepts JSONContent shapes at runtime.
  if (tpl?.starterDocument && tpl.starterDocument.length > 0) {
    try {
      editor.commands.setContent(
        { type: 'doc', content: tpl.starterDocument } as unknown as Parameters<Editor['commands']['setContent']>[0],
        true,
      );
      return;
    } catch (err) {
      console.warn('[applyScriptFormat] failed to seed starter document', err);
    }
  }
  editor.commands.setContent(DEFAULT_DOC as unknown as Parameters<Editor['commands']['setContent']>[0], true);
}
