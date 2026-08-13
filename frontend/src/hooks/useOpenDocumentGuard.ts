/**
 * Keeps this window's claim on the document it is showing, and stops a second
 * window opening the same one.
 *
 * See services/openDocuments for why: two windows editing one screenplay
 * auto-save over each other, and neither of them looks wrong while it happens.
 *
 * There are two ways in, because there are two kinds of caller:
 *
 *   guardOpen()  asks *before* the document is loaded, so a duplicate never
 *                appears on screen at all. This is what every deliberate "open
 *                this script" path should use.
 *   the effect   notices after the fact, for the paths that set the current
 *                document without going through an open — a file association,
 *                a restored session. Late is better than never; it is the
 *                pre-flight check that keeps it from being the normal case.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  claimOpenDocument,
  documentKey,
  findWindowWithDocument,
  releaseOpenDocument,
  type OpenElsewhere,
} from '../services/openDocuments';

export interface OpenDocumentGuardOptions {
  projectId: string | null;
  scriptId: string | null;
  /** Set when the document is a file being edited in place (issue #62). */
  originPath: string | null;
  documentTitle: string;
  /** Nothing to guard until the document is actually loaded. */
  ready: boolean;
}

interface Prompt {
  other: OpenElsewhere;
  title: string;
  /** Set only for a pre-flight check: the open that is waiting on an answer. */
  proceed?: () => void | Promise<void>;
}

export interface OpenDocumentGuard {
  /** The other window holding this document, while the writer decides. */
  openElsewhere: OpenElsewhere | null;
  /** Title of the document being asked about. */
  promptTitle: string;
  /**
   * True when the prompt is a pre-flight check — the document has not been
   * loaded, and this window is still showing whatever it was showing before.
   */
  promptIsPreflight: boolean;
  /**
   * Run `proceed` unless the document is already open in another window, in
   * which case ask first. Answering "open anyway" runs it then.
   */
  guardOpen: (
    key: string | null,
    title: string,
    proceed: () => void | Promise<void>,
  ) => Promise<void>;
  /** "Open anyway" — go ahead, and stop asking about this document. */
  openAnyway: () => void;
  /** Put the prompt away without opening anything. */
  dismiss: () => void;
}

export function useOpenDocumentGuard(opts: OpenDocumentGuardOptions): OpenDocumentGuard {
  const { projectId, scriptId, originPath, documentTitle, ready } = opts;
  const key = documentKey(projectId, scriptId, originPath);

  const [prompt, setPrompt] = useState<Prompt | null>(null);
  /** Documents the writer has said to open a second copy of. */
  const approvedRef = useRef<Set<string>>(new Set());
  /** The document the current prompt is about. */
  const promptKeyRef = useRef<string | null>(null);

  const guardOpen = useCallback<OpenDocumentGuard['guardOpen']>(
    async (documentId, title, proceed) => {
      if (!documentId || approvedRef.current.has(documentId)) {
        await proceed();
        return;
      }

      let other: OpenElsewhere | null = null;
      try {
        other = await findWindowWithDocument(documentId);
      } catch (err) {
        // A guard that cannot answer must not stop the document opening.
        console.warn('[windows] could not check for a duplicate window:', err);
      }

      if (!other) {
        await proceed();
        return;
      }
      promptKeyRef.current = documentId;
      setPrompt({ other, title, proceed });
    },
    [],
  );

  useEffect(() => {
    if (!ready) return;

    // Claim first: the check ignores this window's own entry, and claiming
    // late would let two windows opening at once both see a free document.
    claimOpenDocument(key, documentTitle);
    if (!key || approvedRef.current.has(key)) return;

    let cancelled = false;
    findWindowWithDocument(key)
      .then((found) => {
        if (cancelled || !found) return;
        promptKeyRef.current = key;
        setPrompt({ other: found, title: documentTitle });
      })
      .catch((err) => {
        console.warn('[windows] could not check for a duplicate window:', err);
      });

    return () => {
      cancelled = true;
    };
    // documentTitle deliberately absent: renaming a script is not a reason to
    // ask again, and the claim is refreshed on the next document change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready]);

  // A closed window's claim is cleaned up by the next window that checks, but
  // only if it ever checks — so let go on the way out as well.
  useEffect(() => {
    const release = () => releaseOpenDocument();
    window.addEventListener('pagehide', release);
    return () => {
      window.removeEventListener('pagehide', release);
      releaseOpenDocument();
    };
  }, []);

  const openAnyway = useCallback(() => {
    const pending = prompt;
    setPrompt(null);
    if (promptKeyRef.current) approvedRef.current.add(promptKeyRef.current);
    // Not awaited: the caller is a click handler, and errors inside the open
    // path already report themselves.
    void pending?.proceed?.();
  }, [prompt]);

  return {
    openElsewhere: prompt?.other ?? null,
    promptTitle: prompt?.title ?? '',
    promptIsPreflight: prompt?.proceed != null,
    guardOpen,
    openAnyway,
    dismiss: () => setPrompt(null),
  };
}
