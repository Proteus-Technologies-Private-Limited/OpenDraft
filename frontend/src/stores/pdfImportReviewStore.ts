/**
 * The PDF import review (components/PdfImportReviewDialog) as something any
 * import path can wait on.
 *
 * Every way into an import — File ▸ Import, the welcome dialog, a drop on the
 * editor, an OS file association, the project view — goes through
 * parseScreenplayImport, which asks for a review here and waits. The dialog,
 * mounted once in App, answers with the document to import, or null when the
 * writer cancels. With no dialog mounted (tests, a headless caller) the
 * import goes through as read.
 */
import { create } from 'zustand';
import type { JSONContent } from '@tiptap/react';

export interface PendingPdfReview {
  /** Tells one request from the next. */
  id: number;
  filename: string;
  doc: JSONContent;
  warnings: string[];
  resolve: (doc: JSONContent | null) => void;
}

interface PdfImportReviewState {
  pending: PendingPdfReview | null;
  /** How many dialogs are mounted to answer a request. */
  reviewers: number;
  setReviewerMounted: (mounted: boolean) => void;
  finish: (doc: JSONContent | null) => void;
}

export const usePdfImportReviewStore = create<PdfImportReviewState>((set, get) => ({
  pending: null,
  reviewers: 0,
  setReviewerMounted: (mounted) => set((s) => ({ reviewers: Math.max(0, s.reviewers + (mounted ? 1 : -1)) })),
  finish: (doc) => {
    const pending = get().pending;
    set({ pending: null });
    pending?.resolve(doc);
  },
}));

let requests = 0;

/**
 * Show the writer what a PDF import found and let them correct it. Resolves
 * with the document to import, or null when they cancel.
 */
export function requestPdfImportReview(filename: string, doc: JSONContent, warnings: string[]): Promise<JSONContent | null> {
  const store = usePdfImportReviewStore.getState();
  if (store.reviewers === 0) return Promise.resolve(doc);
  // One review at a time: a second import while one is open replaces it, and
  // the first is cancelled rather than left waiting for ever.
  store.pending?.resolve(null);
  return new Promise((resolve) => {
    usePdfImportReviewStore.setState({ pending: { id: ++requests, filename, doc, warnings, resolve } });
  });
}
