/**
 * Selected pages reach the printer by File → Print's own route on each
 * platform: the share sheet on iOS, PrintManager on Android, and the print
 * dialog or the system viewer everywhere else.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const saveFile = vi.fn(async () => true);
const invoke = vi.fn(async () => undefined);
const writeFile = vi.fn(async () => undefined);
const mkdir = vi.fn(async () => undefined);
const openPath = vi.fn(async () => undefined);

vi.mock('./fileOps', () => ({ saveFile }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile, mkdir, BaseDirectory: { AppData: 'AppData' } }));
vi.mock('@tauri-apps/api/path', () => ({ appDataDir: async () => '/data', join: async (...p: string[]) => p.join('/') }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openPath }));

const { printPDFOnRoute } = await import('./printPdf');

const bytes = new Uint8Array([37, 80, 68, 70]);

describe('printPDFOnRoute', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('hands the file to the share sheet on iOS', async () => {
    expect(await printPDFOnRoute(bytes, 'Sides.pdf', 'ios-share-sheet', false)).toBe('share-sheet');
    expect(saveFile).toHaveBeenCalledWith(bytes, 'Sides.pdf', [{ name: 'PDF', extensions: ['pdf'] }]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('sends the bytes to PrintManager on Android', async () => {
    expect(await printPDFOnRoute(bytes, 'Sides.pdf', 'android-print-service', false)).toBe('printed');
    expect(invoke).toHaveBeenCalledWith('android_print_pdf', { filename: 'Sides.pdf', contents: [37, 80, 68, 70] });
    expect(saveFile).not.toHaveBeenCalled();
  });

  it('opens the file in the system viewer on the desktop', async () => {
    expect(await printPDFOnRoute(bytes, 'Sides.pdf', 'dialog', true)).toBe('opened-externally');
    expect(writeFile).toHaveBeenCalledWith('print/Sides.pdf', bytes, { baseDir: 'AppData' });
    expect(openPath).toHaveBeenCalledWith('/data/print/Sides.pdf');
  });

  it('passes a refusal on with its reason', async () => {
    invoke.mockRejectedValueOnce(new Error('no printer service'));
    await expect(printPDFOnRoute(bytes, 'Sides.pdf', 'android-print-service', false)).rejects.toThrow('no printer service');
  });
});
