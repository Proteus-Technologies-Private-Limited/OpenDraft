import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getOS, isTauri } from '../../services/platform';
import { availableEngines, localCaptureProblem } from './capabilities';
vi.mock('../../services/platform', () => ({ getOS: vi.fn(), isTauri: vi.fn() }));
beforeEach(() => {
  vi.mocked(isTauri).mockReturnValue(false);
  vi.mocked(getOS).mockReturnValue('macos');
  vi.stubGlobal('window', { SpeechRecognition: class {} });
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn() } });
  vi.stubGlobal('Worker', class {});
  vi.stubGlobal('MediaRecorder', class {});
  vi.stubGlobal('AudioContext', class {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it('offers local first where capture is supported', () => {
  expect(availableEngines()).toEqual(['local', 'browser']);
});
it('offers only device recognition on Android even if web APIs exist', () => {
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(getOS).mockReturnValue('android');
  expect(availableEngines()).toEqual(['device']);
});
it('omits Linux WebKit capture and explains the unsupported desktop build', () => {
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(getOS).mockReturnValue('linux');
  vi.stubGlobal('window', {});
  expect(availableEngines()).toEqual([]);
  expect(localCaptureProblem()).toMatch(/Linux desktop build/);
});
it('offers native iOS recognition and omits unavailable browser engines', () => {
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(getOS).mockReturnValue('ios');
  vi.stubGlobal('window', {});
  expect(availableEngines()).toEqual(['local', 'device']);
});

it.each(['macos', 'windows', 'linux'] as const)(
  'does not offer browser recognition inside the %s app even when the constructor exists',
  (os) => {
    vi.mocked(isTauri).mockReturnValue(true);
    vi.mocked(getOS).mockReturnValue(os);
    expect(availableEngines()).not.toContain('browser');
    expect(availableEngines()).toEqual(os === 'linux' ? [] : ['local']);
  },
);

it('uses the native iOS engine instead of a webview speech constructor', () => {
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(getOS).mockReturnValue('ios');
  expect(availableEngines()).toEqual(['local', 'device']);
});
