import { getOS, isTauri } from '../../../services/platform';

/** Turn denied microphone/speech permission into an action the writer can take. */
export function permissionErrorMessage(error: unknown): string | null {
  const code =
    typeof error === 'string'
      ? error
      : error && typeof error === 'object' && 'name' in error
        ? error.name
        : null;
  if (
    !['NotAllowedError', 'SecurityError', 'not-allowed', 'service-not-allowed'].includes(
      String(code),
    )
  ) {
    return null;
  }
  if (isTauri()) {
    const os = getOS();
    if (os === 'macos') {
      return 'Microphone access is blocked. Allow OpenDraft in System Settings → Privacy & Security → Microphone, then try again.';
    }
    if (os === 'windows') {
      return 'Microphone access is blocked. Allow microphone access for OpenDraft in Windows Settings → Privacy & security → Microphone, then try again.';
    }
  }
  return 'Microphone or speech recognition access is blocked. Allow microphone access for this site in your browser settings, then try again.';
}
