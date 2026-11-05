import { getOS, isTauri } from '../../../services/platform';
import { t } from '../../../i18n';

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
      return t('addons:dictation.permission.macos');
    }
    if (os === 'windows') {
      return t('addons:dictation.permission.windows');
    }
  }
  return t('addons:dictation.permission.browser');
}
