import { afterEach, expect, it, vi } from 'vitest';
import { getOS, isTauri } from '../../../services/platform';
import { permissionErrorMessage } from './permissionError';
vi.mock('../../../services/platform', () => ({ getOS: vi.fn(), isTauri: vi.fn() }));
afterEach(() => {
  vi.resetAllMocks();
});
it.each(['NotAllowedError', 'SecurityError', 'not-allowed', 'service-not-allowed'])(
  'explains how to resolve denied browser permission (%s)',
  (code) => {
    vi.mocked(isTauri).mockReturnValue(false);
    const error = code.endsWith('Error') ? new DOMException('raw provider error', code) : code;
    expect(permissionErrorMessage(error)).toMatch(
      /Allow microphone access for this site in your browser settings/,
    );
  },
);
it.each(['macos', 'windows'] as const)('points to the %s microphone controls', (os) => {
  vi.mocked(isTauri).mockReturnValue(true);
  vi.mocked(getOS).mockReturnValue(os);
  expect(permissionErrorMessage(new DOMException('denied', 'NotAllowedError'))).toMatch(
    os === 'macos'
      ? /System Settings.*Privacy & Security.*Microphone/
      : /Windows Settings.*Microphone/,
  );
});
it('leaves unrelated failures to their normal error path', () => {
  expect(permissionErrorMessage(new Error('decode failed'))).toBeNull();
});
