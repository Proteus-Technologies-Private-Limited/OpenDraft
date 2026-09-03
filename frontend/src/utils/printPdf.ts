/**
 * Printing the PDF rather than the page.
 *
 * The editor draws its page turns rather than making them: one continuous page
 * element with separators laid over it. Printing the DOM asks the browser to
 * paginate the same document a second time, by its own rules, and the two
 * engines do not have to agree — so the printed script could break in places
 * the writer had never seen. The exporters have no such problem: they lay the
 * script out page by page themselves, which is why File → Export → PDF, and
 * printing on iOS and Android, all already go that way.
 *
 * So this route hands the printer the same file the exporter would write. What
 * comes off the printer is then the same document that gets emailed, by
 * construction rather than by keeping two layouts in step.
 *
 * How it reaches the printer differs by platform, and there is no way around
 * that. A browser can be handed the PDF and asked to print it. The desktop web
 * view cannot: WKWebView implements no `window.print` of its own — Tauri
 * supplies one for the app's own window, but nothing reaches inside a frame —
 * so the file is written out and opened in whatever the system uses for PDFs,
 * and printed from there.
 */

/** Where a print landed, for the message the writer is shown afterwards. */
export type PrintPdfOutcome = 'printed' | 'opened-externally';

/** How long to wait for the viewer to load the PDF before giving up on it. */
const LOAD_TIMEOUT_MS = 20000;

/**
 * Keep the frame around long enough for the print dialog to read it.
 *
 * Printing is asynchronous and the dialog holds a reference to the document,
 * so tearing the frame down on the next tick can leave the dialog printing a
 * blank. Nothing depends on the frame after this, and one hidden empty frame
 * costs nothing if a writer never dismisses the dialog.
 */
const CLEANUP_DELAY_MS = 120000;

/**
 * Print `bytes` through the browser's own PDF viewer.
 *
 * A hidden frame rather than a new tab or window: a tab is a pop-up as far as
 * the browser is concerned and gets blocked, and either way it leaves the
 * writer somewhere they then have to navigate back from. The frame prints and
 * disappears.
 */
async function printInFrame(bytes: Uint8Array): Promise<void> {
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0;border:0;';

  const cleanUp = () => {
    frame.remove();
    URL.revokeObjectURL(url);
  };

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(
        () => reject(new Error('the PDF viewer did not finish loading')),
        LOAD_TIMEOUT_MS,
      );
      frame.onload = () => { window.clearTimeout(timer); resolve(); };
      frame.onerror = () => {
        window.clearTimeout(timer);
        reject(new Error('the PDF could not be opened for printing'));
      };
      frame.src = url;
      document.body.appendChild(frame);
    });

    const view = frame.contentWindow;
    if (!view) throw new Error('the PDF viewer could not be reached');
    view.focus();
    view.print();
  } catch (err) {
    cleanUp();
    throw err;
  }

  window.setTimeout(cleanUp, CLEANUP_DELAY_MS);
}

/**
 * Write `bytes` where the app is allowed to write, and hand it to the system.
 *
 * The desktop web view cannot print a frame, so the printing is done by
 * whatever opens PDFs on the machine — Preview, or whatever has taken its
 * place. Written under the app's own data directory rather than a temporary
 * one, because that is the only place the file scope permits.
 */
async function printByOpening(bytes: Uint8Array, filename: string): Promise<void> {
  const { mkdir, writeFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
  const dir = 'print';
  await mkdir(dir, { baseDir: BaseDirectory.AppData, recursive: true });
  const relative = `${dir}/${filename}`;
  await writeFile(relative, bytes, { baseDir: BaseDirectory.AppData });

  const { appDataDir, join } = await import('@tauri-apps/api/path');
  const { openPath } = await import('@tauri-apps/plugin-opener');
  await openPath(await join(await appDataDir(), relative));
}

/**
 * Send an already-rendered PDF to the printer by whichever route this platform
 * has. Throws if neither works, so the caller can say so.
 */
export async function printPDFBytes(
  bytes: Uint8Array,
  filename: string,
  viaSystemViewer: boolean,
): Promise<PrintPdfOutcome> {
  if (viaSystemViewer) {
    await printByOpening(bytes, filename);
    return 'opened-externally';
  }
  await printInFrame(bytes);
  return 'printed';
}
