import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onScriptLanguagesChange, setScriptLanguageEnabled } from './spellcheckLanguages';

let checker: typeof import('./spellchecker').spellChecker;

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(
    url.endsWith('.aff') ? 'SET UTF-8\n' : url.includes('en_US') ? '1\nhello\n' : '1\npolski\n',
  )));
  checker = (await import('./spellchecker')).spellChecker;
  await checker.init();
});

afterEach(() => vi.unstubAllGlobals());

async function loadPolish() {
  expect(await checker.loadLanguage('pl', {
    affUrl: '/pl.aff', dicUrl: '/pl.dic', persist: false,
  })).toBe(true);
}

describe('document transitions and dictionary removal', () => {
  it('advances consecutive blank documents without triggering outgoing full scans', () => {
    const scan = vi.fn();
    const stop = checker.onChange(scan);
    const generation = checker.getDocumentGeneration();
    checker.beginDocument();
    checker.beginDocument(['en_US', 'en_US']);
    checker.setEnabledLanguages([]);
    expect(checker.getDocumentGeneration()).toBe(generation + 2);
    expect(scan).not.toHaveBeenCalled();
    checker.setEnabledLanguages(['en_US', 'pl']);
    checker.setEnabledLanguages(['pl', 'en_US']);
    expect(scan).toHaveBeenCalledTimes(1);
    stop();
  });

  it('does not lose the first language edit after a silent document transition', () => {
    const changed = vi.fn();
    const stop = onScriptLanguagesChange(changed, checker);
    checker.beginDocument();
    checker.beginDocument();
    expect(changed).not.toHaveBeenCalled();
    checker.setEnabledLanguages(['en_US', 'pl']);
    expect(changed).toHaveBeenCalledTimes(1);
    checker.beginDocument(['pl']);
    expect(changed).toHaveBeenCalledTimes(1);
    checker.setEnabledLanguages(['en_US']);
    expect(changed).toHaveBeenCalledTimes(2);
    stop();
    checker.beginDocument();
    checker.setEnabledLanguages(['pl']);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it('restores working English when removing Polish alone despite unavailable enabled codes', async () => {
    await loadPolish();
    checker.beginDocument(['pl', 'unavailable']);
    const changed = vi.fn();
    const stop = onScriptLanguagesChange(changed, checker);
    const scan = vi.fn();
    const stopScan = checker.onChange(scan);
    expect(checker.check('hello')).toBe(false);
    await checker.unloadLanguage('pl');
    expect(checker.getEnabledLanguages()).toEqual(['en_US', 'unavailable']);
    expect(checker.getLoadedLanguages().map(language => language.code)).toEqual(['en_US']);
    expect(checker.check('hello')).toBe(true);
    expect(checker.check('qzxinvalid')).toBe(false);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(scan).toHaveBeenCalledTimes(1);
    stop(); stopScan();
  });

  it('preserves another working selection and cannot remove bundled English', async () => {
    await loadPolish();
    checker.setEnabledLanguages(['en_US', 'pl']);
    await checker.unloadLanguage('pl');
    await checker.unloadLanguage('en_US');
    expect(checker.getEnabledLanguages()).toEqual(['en_US']);
    expect(checker.check('hello')).toBe(true);
    await loadPolish();
    checker.setEnabledLanguages(['pl']);
    await checker.unloadLanguage('not-loaded');
    expect(checker.getEnabledLanguages()).toEqual(['pl']);
    expect(checker.check('polski')).toBe(true);
  });

  it('keeps a completed download installed without editing the next document', async () => {
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const changed = vi.fn();
    const stop = onScriptLanguagesChange(changed, checker);
    const result = setScriptLanguageEnabled('pl', true, {
      checker,
      install: async () => { await pending; await loadPolish(); return { ok: true }; },
    });
    checker.beginDocument();
    finish();
    expect(await result).toEqual({ status: 'installed' });
    expect(checker.getEnabledLanguages()).toEqual(['en_US']);
    expect(changed).not.toHaveBeenCalled();
    expect(await setScriptLanguageEnabled('pl', true, { checker })).toEqual({ status: 'enabled' });
    expect(changed).toHaveBeenCalledTimes(1);
    stop();
  });
});
