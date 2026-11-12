import { describe, it, expect, vi } from 'vitest';
import { canDisableLanguage, onScriptLanguagesChange, setScriptLanguageEnabled } from './spellcheckLanguages';
import { spellChecker } from './spellchecker';

function fixture(enabled = ['en_US'], loaded = ['en_US']) {
  let codes = [...enabled];
  let generation = 0;
  const installed = new Set(loaded);
  const listeners = new Set<() => void>();
  const documentListeners = new Set<() => void>();
  const emit = () => listeners.forEach(listener => listener());
  const checker = {
    getEnabledLanguages: () => [...codes].sort(),
    getLoadedLanguages: () => [...installed].map(code => ({ code, label: code })),
    setEnabledLanguages: vi.fn((next: string[]) => { codes = [...next]; emit(); }),
    getDocumentGeneration: () => generation,
    onDocumentChange: (listener: () => void) => { documentListeners.add(listener); return () => { documentListeners.delete(listener); }; },
    onChange: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  const beginDocument = (next: string[] = ['en_US']) => {
    generation++; checker.setEnabledLanguages(next); documentListeners.forEach(listener => listener());
  };
  return { checker, installed, emit, beginDocument };
}

describe('shared script language choices', () => {
  it('protects the only loaded active dictionary even with unavailable enabled codes', async () => {
    const { checker } = fixture(['en_US', 'pl', 'custom']);
    expect(canDisableLanguage('en_US', checker.getEnabledLanguages(), new Set(['en_US']))).toBe(false);
    expect(await setScriptLanguageEnabled('en_US', false, { checker })).toEqual({ status: 'blocked' });
    expect(checker.setEnabledLanguages).not.toHaveBeenCalled();
  });

  it.each(['pl', 'unavailable-custom'])('removes enabled but unavailable %s without installing', async code => {
    const { checker } = fixture(['en_US', code]);
    const install = vi.fn().mockRejectedValue(new Error('offline'));
    expect(canDisableLanguage(code, checker.getEnabledLanguages(), new Set(['en_US']))).toBe(true);
    expect(await setScriptLanguageEnabled(code, false, { checker, install })).toEqual({ status: 'disabled' });
    expect(checker.getEnabledLanguages()).toEqual(['en_US']);
    expect(install).not.toHaveBeenCalled();
  });

  it('allows disabling English when another working dictionary is active', async () => {
    const { checker } = fixture(['en_US', 'pl'], ['en_US', 'pl']);
    expect(await setScriptLanguageEnabled('en_US', false, { checker })).toEqual({ status: 'disabled' });
    expect(checker.getEnabledLanguages()).toEqual(['pl']);
  });

  it('reads installed and enabled state after a successful download', async () => {
    const { checker, installed } = fixture();
    const install = vi.fn(async () => {
      installed.add('pl');
      checker.setEnabledLanguages(['en_US', 'de']);
      return { ok: true };
    });
    expect(await setScriptLanguageEnabled('pl', true, { checker, install })).toEqual({ status: 'enabled' });
    expect(checker.getEnabledLanguages()).toEqual(['de', 'en_US', 'pl']);
  });

  it('leaves the enabled set intact on failed downloads', async () => {
    const { checker } = fixture();
    expect(await setScriptLanguageEnabled('pl', true, {
      checker, install: async () => ({ ok: false, error: 'offline' }),
    })).toEqual({ status: 'failed', error: 'offline' });
    expect(checker.setEnabledLanguages).not.toHaveBeenCalled();
  });

  it('does not activate a successful install in another blank document', async () => {
    const { checker, installed, beginDocument } = fixture();
    const install = async () => { beginDocument(); installed.add('pl'); return { ok: true }; };
    expect(await setScriptLanguageEnabled('pl', true, { checker, install })).toEqual({ status: 'installed' });
    expect(checker.getEnabledLanguages()).toEqual(['en_US']);
  });

  it('does not activate a download after its editor was destroyed', async () => {
    const { checker, installed } = fixture();
    const install = async () => { installed.add('pl'); return { ok: true }; };
    expect(await setScriptLanguageEnabled('pl', true, { checker, install, isCurrent: () => false })).toEqual({ status: 'installed' });
    expect(checker.getEnabledLanguages()).toEqual(['en_US']);
  });

  it('rechecks the last working dictionary at action time, not render time', async () => {
    const { checker, installed } = fixture(['en_US', 'pl'], ['en_US', 'pl']);
    expect(canDisableLanguage('en_US', checker.getEnabledLanguages(), new Set(installed))).toBe(true);
    installed.delete('pl');
    expect(await setScriptLanguageEnabled('en_US', false, { checker })).toEqual({ status: 'blocked' });
    expect(checker.setEnabledLanguages).not.toHaveBeenCalled();
  });

  it('does not enable a dictionary that was removed again during installation', async () => {
    const { checker } = fixture();
    expect(await setScriptLanguageEnabled('pl', true, { checker, install: async () => ({ ok: true }) })).toEqual({ status: 'failed' });
    expect(checker.setEnabledLanguages).not.toHaveBeenCalled();
  });

  it('does not repeat an already-applied choice', async () => {
    const { checker } = fixture(['en_US', 'pl'], ['en_US', 'pl']);
    expect(await setScriptLanguageEnabled('pl', true, { checker })).toEqual({ status: 'unchanged' });
    expect(checker.setEnabledLanguages).not.toHaveBeenCalled();
  });
});

describe('metadata notifications', () => {
  it('notifies on language edits, ignoring global dictionary loads and rescans', async () => {
    const { checker, installed, emit } = fixture(['en_US', 'pl'], ['en_US', 'pl']);
    const changed = vi.fn();
    const stop = onScriptLanguagesChange(changed, checker);
    installed.add('de'); emit();
    checker.setEnabledLanguages(['pl', 'en_US']);
    expect(changed).not.toHaveBeenCalled();
    await setScriptLanguageEnabled('pl', false, { checker });
    expect(changed).toHaveBeenCalledTimes(1);
    stop(); checker.setEnabledLanguages(['pl']);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('does not mark loaded/restored languages as an edit, but detects the next edit', async () => {
    const { checker, beginDocument } = fixture(['en_US', 'pl'], ['en_US', 'pl']);
    const changed = vi.fn();
    const stop = onScriptLanguagesChange(changed, checker);
    beginDocument(['pl']);
    expect(changed).not.toHaveBeenCalled();
    await setScriptLanguageEnabled('en_US', true, { checker });
    expect(changed).toHaveBeenCalledTimes(1);
    stop();
  });

  it('the real engine advances only for a document load, not a language edit', () => {
    const generation = spellChecker.getDocumentGeneration();
    spellChecker.beginDocument(['en_US', 'pl']);
    expect(spellChecker.getDocumentGeneration()).toBe(generation + 1);
    spellChecker.setEnabledLanguages(['en_US']);
    expect(spellChecker.getDocumentGeneration()).toBe(generation + 1);
    spellChecker.beginDocument(['en_US']);
    expect(spellChecker.getDocumentGeneration()).toBe(generation + 2);
  });
});
