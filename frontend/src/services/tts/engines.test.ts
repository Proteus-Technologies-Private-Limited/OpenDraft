import { describe, it, expect, afterEach, vi } from 'vitest';
import { activeEngineKind, availableEngineKinds, selectedEngineKind } from './engines';

/** A window as the browser or the app's web view would present it. */
function stubWindow(opts: { tauri: boolean; speech: boolean }) {
  const win: Record<string, unknown> = {};
  if (opts.tauri) win.__TAURI_INTERNALS__ = {};
  if (opts.speech) {
    win.speechSynthesis = {};
    win.SpeechSynthesisUtterance = function SpeechSynthesisUtterance() {};
  }
  vi.stubGlobal('window', win);
  vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh)', maxTouchPoints: 0 });
}

afterEach(() => vi.unstubAllGlobals());

const base = { aiProvider: '' as const, apiKeys: {}, compatibleBaseUrl: '' };
const unchosen = { ...base, enginePreference: 'system' as const, engineChosen: false };
const chose = (p: 'system' | 'ai') => ({ ...base, enginePreference: p, engineChosen: true });

describe('voice source', () => {
  it('in the app: installed voices unless AI is chosen, no question asked', () => {
    stubWindow({ tauri: true, speech: false });
    expect(availableEngineKinds()).toEqual(['system', 'ai']);
    expect(activeEngineKind(unchosen)).toBe('system');
    expect(selectedEngineKind(unchosen)).toBe('system');
    expect(activeEngineKind(chose('ai'))).toBe('ai');
  });

  it('in a browser with speech: asks first, then reads with what was chosen', () => {
    stubWindow({ tauri: false, speech: true });
    expect(availableEngineKinds()).toEqual(['system', 'ai']);
    // Not chosen yet: 'ai' with no provider is what opens the setup dialog.
    expect(activeEngineKind(unchosen)).toBe('ai');
    expect(selectedEngineKind(unchosen)).toBeNull();
    expect(activeEngineKind(chose('system'))).toBe('system');
    expect(activeEngineKind(chose('ai'))).toBe('ai');
  });

  it('in a browser: a provider set up before the choice existed keeps reading, and shows as chosen', () => {
    stubWindow({ tauri: false, speech: true });
    const earlier = { ...unchosen, aiProvider: 'openai' as const, apiKeys: { openai: 'k' } };
    expect(activeEngineKind(earlier)).toBe('ai');
    expect(selectedEngineKind(earlier)).toBe('ai');
  });

  it('in a browser without speech: AI voices only', () => {
    stubWindow({ tauri: false, speech: false });
    expect(availableEngineKinds()).toEqual(['ai']);
    expect(activeEngineKind(chose('system'))).toBe('ai');
    expect(selectedEngineKind(chose('system'))).toBe('ai');
  });
});
