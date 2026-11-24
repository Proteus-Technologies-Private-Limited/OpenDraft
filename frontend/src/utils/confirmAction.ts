/**
 * Ask the writer to confirm an action before it happens.
 *
 * In the app this goes through the native dialog. The iPad and phone WebViews
 * do not show `window.confirm`: it returns at once without asking, so a delete
 * or a "replace the cloud version" would go ahead unasked. The browser keeps
 * `window.confirm`, which works there.
 */
import { t } from '../i18n';
import { isTauri } from '../services/platform';

export async function confirmAction(message: string): Promise<boolean> {
  if (!isTauri()) return window.confirm(message);
  try {
    const { confirm } = await import('@tauri-apps/plugin-dialog');
    return await confirm(message, {
      title: 'OpenDraft', // i18n-ignore: product name.
      kind: 'warning',
      okLabel: t('common:ok'),
      cancelLabel: t('common:cancel'),
    });
  } catch (error) {
    // Do not go ahead with something the writer could not be asked about.
    console.error('[dialog] could not show the confirmation:', error);
    return false;
  }
}
