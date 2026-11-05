import { t } from '../i18n';
import { formatDate } from '../i18n/format';

/**
 * "3 minutes ago" style formatting, shared by Version History and the Recover
 * Backup dialog so the two read identically.
 */
export function relativeTime(input: string | number | Date): string {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return '';

  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) return t('messages:relativeTime.justNow');
  if (diffMin < 60) return t('messages:relativeTime.minutes', { count: diffMin });
  if (diffHr < 24) return t('messages:relativeTime.hours', { count: diffHr });
  if (diffDay < 30) return t('messages:relativeTime.days', { count: diffDay });
  return formatDate(date, { year: 'numeric', month: 'numeric', day: 'numeric' });
}
