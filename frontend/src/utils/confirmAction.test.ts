import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dialog = vi.hoisted(() => ({ confirm: vi.fn() }));
const platform = vi.hoisted(() => ({ isTauri: vi.fn(() => false) }));
vi.mock('@tauri-apps/plugin-dialog', () => dialog);
vi.mock('../services/platform', () => platform);
vi.mock('../i18n', () => ({ t: (key: string) => key }));

import { confirmAction } from './confirmAction';

const windowConfirm = vi.fn();
beforeEach(() => {
  // The test window has no confirm(); install one to observe.
  Object.defineProperty(window, 'confirm', { value: windowConfirm, configurable: true, writable: true });
});

afterEach(() => {
  windowConfirm.mockReset();
  vi.restoreAllMocks();
  dialog.confirm.mockReset();
  platform.isTauri.mockReturnValue(false);
});

describe('confirmAction', () => {
  it('uses window.confirm in the browser', async () => {
    windowConfirm.mockReturnValue(true);
    await expect(confirmAction('Delete it?')).resolves.toBe(true);
    expect(windowConfirm).toHaveBeenCalledWith('Delete it?');
    expect(dialog.confirm).not.toHaveBeenCalled();
  });

  it('asks through the native dialog in the app, where window.confirm shows nothing', async () => {
    platform.isTauri.mockReturnValue(true);
    dialog.confirm.mockResolvedValue(false);
    await expect(confirmAction('Replace the cloud version?')).resolves.toBe(false);
    expect(dialog.confirm).toHaveBeenCalledWith('Replace the cloud version?',
      expect.objectContaining({ kind: 'warning', okLabel: 'common:ok', cancelLabel: 'common:cancel' }));
    expect(windowConfirm).not.toHaveBeenCalled();
  });

  it('does not go ahead when the native dialog cannot be shown', async () => {
    platform.isTauri.mockReturnValue(true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    dialog.confirm.mockRejectedValue(new Error('dialog unavailable'));
    await expect(confirmAction('Delete it?')).resolves.toBe(false);
  });
});

describe('confirmations in the app', () => {
  it('never call window.confirm directly, which the mobile app skips without asking', () => {
    const root = join(__dirname, '..');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) { walk(path); continue; }
        if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name) || name === 'confirmAction.ts') continue;
        const code = readFileSync(path, 'utf8').replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
        if (/(window\.|[^.\w])confirm\(/.test(code)) offenders.push(path.slice(root.length + 1));
      }
    };
    walk(root);
    expect(offenders, 'use confirmAction() from utils/confirmAction').toEqual([]);
  });
});
