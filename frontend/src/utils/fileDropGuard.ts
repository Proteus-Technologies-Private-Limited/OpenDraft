/**
 * Stop the web view opening a file dropped outside every drop target.
 *
 * Desktop windows have Tauri's native drag-and-drop handler off (see
 * `desktop_windows::with_panel_windows`), so file drops reach the page as
 * plain HTML5 events everywhere. A `drop` nobody cancels makes WebView2 /
 * WKWebView (and browsers) navigate to the file, replacing the whole app —
 * unsaved treatment edits included. This guard sits on `window`, the last
 * stop of a drag event's bubble path, so it only acts on what nothing else
 * took:
 *
 *   drop zone (React, at the root) → ScreenplayEditor (document) → this (window)
 *
 * A real drop target (Fonts, the Asset Manager, the script editor's import)
 * cancels the event first and this leaves it alone. Drags that carry no files
 * (text, plugin items) are never touched.
 */

export function dragCarriesFiles(e: DragEvent): boolean {
  try {
    return Array.from(e.dataTransfer?.types ?? []).includes('Files');
  } catch {
    return false;
  }
}

export function installFileDropGuard(target: EventTarget = window): () => void {
  const onDragOver = (ev: Event) => {
    const e = ev as DragEvent;
    if (!dragCarriesFiles(e) || e.defaultPrevented) return;
    // Cancelled with no drop effect: the cursor shows "not allowed" and the
    // drop never happens, so there is nothing for the web view to open.
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
  };
  const onDrop = (ev: Event) => {
    const e = ev as DragEvent;
    if (!dragCarriesFiles(e) || e.defaultPrevented) return;
    e.preventDefault();
    console.info('[drop] Ignored a file dropped outside any drop target');
  };
  target.addEventListener('dragover', onDragOver);
  target.addEventListener('drop', onDrop);
  return () => {
    target.removeEventListener('dragover', onDragOver);
    target.removeEventListener('drop', onDrop);
  };
}
