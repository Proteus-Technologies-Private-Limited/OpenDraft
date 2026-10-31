import { afterEach, describe, expect, it, vi } from 'vitest';
import { startBrowserRecognition, type BrowserRecognition } from './recognition';
const start = vi.fn(), stop = vi.fn(), abort = vi.fn();
class Recognition {
  static instance: BrowserRecognition;
  lang = ''; continuous = true; interimResults = false;
  onresult: BrowserRecognition['onresult'] = null;
  onerror: BrowserRecognition['onerror'] = null;
  onend: BrowserRecognition['onend'] = null;
  start = start; stop = stop; abort = abort;
  constructor() { Recognition.instance = this; }
}
const callbacks = () => ({ result: vi.fn(), interim: vi.fn(), error: vi.fn(), end: vi.fn() });
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe('browser dictation lifecycle', () => {
  it('reports unsupported browsers without trying to record', () => {
    vi.stubGlobal('window', {});
    expect(() => startBrowserRecognition('en', callbacks())).toThrow(/Local Whisper/);
  });
  it('requests the selected language and separates interim from final text', () => {
    vi.stubGlobal('window', { SpeechRecognition: Recognition });
    const cb = callbacks(); startBrowserRecognition('pl', cb);
    expect(Recognition.instance.lang).toBe('pl');
    expect(Recognition.instance.continuous).toBe(false);
    Recognition.instance.onresult!({ resultIndex: 0, results: [{ isFinal: false, 0: { transcript: 'pending' } }] });
    expect(cb.result).not.toHaveBeenCalled();
    expect(cb.interim).toHaveBeenCalledWith('pending');
    Recognition.instance.onresult!({ resultIndex: 1, results: [{ isFinal: true, 0: { transcript: 'old' } }, { isFinal: true, 0: { transcript: 'final' } }] });
    expect(cb.result).toHaveBeenCalledExactlyOnceWith('final');
    expect(cb.interim).toHaveBeenCalledTimes(1);
  });
  it('ignores callbacks that arrive after cancellation', () => {
    vi.stubGlobal('window', { webkitSpeechRecognition: Recognition });
    const cb = callbacks(); const session = startBrowserRecognition('en', cb);
    const late = Recognition.instance.onresult!;
    session.cancel();
    late({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'late' } }] });
    expect(cb.result).not.toHaveBeenCalled();
    expect(abort).toHaveBeenCalledOnce();
  });
  it('ends and aborts on permission failure even without an end event', () => {
    vi.stubGlobal('window', { SpeechRecognition: Recognition });
    const cb = callbacks(); startBrowserRecognition('en', cb);
    Recognition.instance.onerror!({ error: 'not-allowed' });
    Recognition.instance.onend!();
    Recognition.instance.onresult!({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'late' } }] });
    expect(cb.error).toHaveBeenCalledWith('Speech recognition: not-allowed.');
    expect(cb.end).toHaveBeenCalledOnce();
    expect(abort).toHaveBeenCalledOnce();
    expect(cb.result).not.toHaveBeenCalled();
  });
  it('allows final results after Stop, until the recognizer ends', () => {
    vi.stubGlobal('window', { SpeechRecognition: Recognition });
    const cb = callbacks(); const session = startBrowserRecognition('en', cb);
    session.stop();
    Recognition.instance.onresult!({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'last phrase' } }] });
    Recognition.instance.onend!();
    expect(cb.result).toHaveBeenCalledWith('last phrase');
    expect(cb.end).toHaveBeenCalledOnce();
  });
});
