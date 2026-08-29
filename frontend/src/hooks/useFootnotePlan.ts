/**
 * The footnote plan for the open document, kept fresh without recomputing it
 * on every keystroke.
 *
 * Four things want the same answer at the same moment — the reserve pagination
 * applies, the markers drawn in the script, the block drawn at the foot of the
 * page, and the numbers shown against each note in the panel. Building it once
 * here is what stops them disagreeing, and what stops the document being walked
 * four times over.
 *
 * Returns null whenever nothing prints, which is the common case; every
 * consumer then takes the path it took before footnotes existed.
 */
import { useEffect, useMemo, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { useEditorStore } from '../stores/editorStore';
import { useAssetStore } from '../stores/assetStore';
import { useProjectStore } from '../stores/projectStore';
import { api } from '../services/api';
import { buildFootnotePlan, type FootnotePlan } from '../utils/footnotes';
import type { NoteRenderContext } from '../utils/noteContent';

/** How long to let a note's text settle before re-measuring the page. */
const SETTLE_MS = 150;

/** Asset resolution for note bodies, shared by the panel and the page. */
export function useNoteRenderContext(): NoteRenderContext {
  const { assets } = useAssetStore();
  const { currentProject } = useProjectStore();
  const projectId = currentProject?.id ?? null;
  return useMemo(
    () => ({
      assets,
      // Without a project there is no URL to fetch from, and the reference
      // falls back to its literal text rather than printing nothing at all.
      assetUrl: (a) => (projectId ? api.getAssetUrl(projectId, a.id) : null),
    }),
    [assets, projectId],
  );
}

export function useFootnotePlan(editor: Editor | null): FootnotePlan | null {
  const notes = useEditorStore((s) => s.notes);
  const generalNotes = useEditorStore((s) => s.generalNotes);
  const pageLayout = useEditorStore((s) => s.pageLayout);
  const ctx = useNoteRenderContext();

  // The document is not React state, so a version counter stands in for it.
  const [docVersion, setDocVersion] = useState(0);
  useEffect(() => {
    if (!editor) return;
    let timer: number | undefined;
    const bump = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setDocVersion((v) => v + 1), SETTLE_MS);
    };
    editor.on('update', bump);
    return () => {
      window.clearTimeout(timer);
      editor.off('update', bump);
    };
  }, [editor]);

  return useMemo(
    () => (editor ? buildFootnotePlan(editor.state.doc, pageLayout, notes, ctx, generalNotes) : null),
    // docVersion is the doc's stand-in; the editor's own identity never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, notes, generalNotes, pageLayout, ctx, docVersion],
  );
}
