import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  native: true, os: 'windows', destination: '/chosen/script.fdx' as string | null,
  error: null as unknown, failCommand: 'save_text_to_path',
}));
vi.mock('./platform', () => ({
  isTauri: () => fake.native, getOS: () => fake.os,
  isDesktopTauri: () => fake.native && !['ios', 'android'].includes(fake.os),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: async () => fake.destination }));
vi.mock('@tauri-apps/api/app', () => ({ getVersion: async () => '9.8.7' }));
vi.mock('@tauri-apps/api/path', () => ({ appDataDir: async () => '/application-data' }));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (command: string) => {
    if (fake.error && command === fake.failCommand) throw fake.error;
    if (command === 'stat_path') return { exists: true, modified_ms: 1 };
    return null;
  },
}));

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  fake.native = true;
  fake.os = 'windows';
  fake.destination = '/chosen/script.fdx';
  fake.error = null;
  fake.failCommand = 'save_text_to_path';
});

describe('file failure diagnostics', () => {
  it.each(['destination', 'staging', 'backup', 'replacement', 'cleanup'] as const)('records the native %s stage and preserves the original rejection', async (stage) => {
    fake.error = `Save failed during ${stage}: Operation not permitted (os error 1)`;
    const { saveFile } = await import('../utils/fileOps');
    const diagnostics = await import('./fileDiagnostics');
    await expect(saveFile('private screenplay text', 'script.fdx')).rejects.toBe(fake.error);
    const failure = diagnostics.getLastFileFailure()!;
    expect(failure).toMatchObject({ stage, operation: 'export', format: 'fdx', command: 'save_text_to_path', message: fake.error });
    expect(Number.isFinite(Date.parse(failure.occurredAt))).toBe(true);
    expect(JSON.stringify(failure)).not.toContain('private screenplay text');
    expect(failure).not.toHaveProperty('path');
    expect(failure).not.toHaveProperty('contents');
  });
  it('records binary writes without retaining the bytes or guessing from an OS error code', async () => {
    fake.failCommand = 'save_binary_to_path';
    fake.error = new Error('Operation not permitted (os error 1)');
    fake.destination = '/chosen/script.pdf';
    const { saveFile } = await import('../utils/fileOps');
    await expect(saveFile(new Uint8Array([255, 0, 19]), 'script.pdf')).rejects.toBe(fake.error);
    const { getLastFileFailure } = await import('./fileDiagnostics');
    expect(getLastFileFailure()).toMatchObject({ stage: 'native-write', command: 'save_binary_to_path', format: 'pdf' });
    expect(getLastFileFailure()).not.toHaveProperty('contents');
  });
  it('does not record dialog cancellation or clear a past failure on success/cancellation', async () => {
    const { saveFile } = await import('../utils/fileOps');
    const { getLastFileFailure } = await import('./fileDiagnostics');
    fake.destination = null;
    expect(await saveFile('data', 'script.fdx')).toBe(false);
    expect(getLastFileFailure()).toBeNull();
    fake.destination = '/chosen/script.fdx';
    fake.error = 'Save failed during staging: denied';
    await expect(saveFile('data', 'script.fdx')).rejects.toBe(fake.error);
    const previous = getLastFileFailure();
    fake.error = null;
    expect(await saveFile('data', 'script.fdx')).toBe(true);
    expect(getLastFileFailure()).toEqual(previous);
    fake.destination = null;
    expect(await saveFile('data', 'script.fdx')).toBe(false);
    expect(getLastFileFailure()).toEqual(previous);
  });
  it('records in-place save failures only around the actual write', async () => {
    fake.failCommand = 'save_text_atomic';
    fake.error = 'Save failed during replacement: denied';
    const { saveDocumentInPlace } = await import('../utils/fileOps');
    await expect(saveDocumentInPlace('/selected/script.odraft', '{}')).rejects.toBe(fake.error);
    const { getLastFileFailure } = await import('./fileDiagnostics');
    expect(getLastFileFailure()).toMatchObject({ operation: 'save-in-place', format: 'odraft', command: 'save_text_atomic', stage: 'replacement' });
  });
  it.each([['ios', 'ios_save_and_share'], ['android', 'android_save_and_share']])('captures %s share failures', async (os, command) => {
    fake.os = os;
    fake.failCommand = command;
    fake.error = 'Share service unavailable';
    const { saveFile } = await import('../utils/fileOps');
    await expect(saveFile('data', 'script.fountain')).rejects.toBe(fake.error);
    const { getLastFileFailure } = await import('./fileDiagnostics');
    expect(getLastFileFailure()).toMatchObject({ stage: 'share', format: 'fountain', command });
  });
  it('captures browser download failures', async () => {
    fake.native = false;
    const { saveFile } = await import('../utils/fileOps');
    vi.stubGlobal('URL', { createObjectURL: () => { throw new Error('Download unavailable'); } });
    await expect(saveFile('data', 'script.txt')).rejects.toThrow('Download unavailable');
    const { getLastFileFailure } = await import('./fileDiagnostics');
    expect(getLastFileFailure()).toMatchObject({ stage: 'download', format: 'txt' });
  });
  it('returns independent bounded snapshots', async () => {
    const diagnostics = await import('./fileDiagnostics');
    await expect(diagnostics.withFileDiagnostics({ operation: 'export', format: 'txt', stage: 'download' }, () => {
      throw 'x'.repeat(10000);
    })).rejects.toHaveLength(10000);
    const first = diagnostics.getLastFileFailure()!;
    expect(first.message).toHaveLength(2048);
    first.stage = 'backup';
    expect(diagnostics.getLastFileFailure()!.stage).toBe('download');
  });
  it('includes the failure and native version in a copied diagnostic report', async () => {
    const files = await import('./fileDiagnostics');
    await expect(files.withFileDiagnostics({ operation: 'export', format: 'pdf', stage: 'native-write', command: 'save_binary_to_path' }, () => {
      throw 'Save failed during staging: Operation not permitted (os error 1)';
    })).rejects.toBeTypeOf('string');
    const { collectDiagnostics, formatReport } = await import('./diagnostics');
    const report = await collectDiagnostics();
    expect(report.appVersion).toBe('9.8.7');
    expect(formatReport(report)).toContain('Stage: staging');
    expect(formatReport(report)).toContain('Command: save_binary_to_path');
    expect(formatReport(report)).toContain('(os error 1)');
  });
  it('extracts only a filename extension, not dots in parent folders or opaque handles', async () => {
    const { fileFormat } = await import('./fileDiagnostics');
    expect(fileFormat('/a.folder/no-extension')).toBe('unknown');
    expect(fileFormat('content://provider/123')).toBe('unknown');
    expect(fileFormat('C:\\folder\\Script.FDX')).toBe('fdx');
    expect(fileFormat('/folder/script.pdf')).toBe('pdf');
  });
});
