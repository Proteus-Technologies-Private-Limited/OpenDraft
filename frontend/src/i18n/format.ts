/**
 * Dates, numbers and lists in the interface language.
 *
 * Only for text the APP writes (a version's time, a count in a dialog). The
 * script's own content — page numbers, scene numbers, revision dates inside an
 * export — is formatted by the format code and must not follow the interface.
 */
import i18next from 'i18next';
import { DEFAULT_LANGUAGE, languageInfo } from './languages';

/** BCP-47 tag for `Intl`, following the language currently shown. */
export function currentLocale(): string {
  return languageInfo(i18next.language || DEFAULT_LANGUAGE).intlLocale;
}

function safe<T>(fn: (locale: string) => T, fallback: () => T): T {
  try {
    return fn(currentLocale());
  } catch (err) {
    // An engine without data for the locale: show something rather than throw.
    console.warn('[i18n] Intl formatting failed, using the default', err);
    return fallback();
  }
}

// Building an Intl.NumberFormat costs far more than using one, and the
// navigator formats a length for every scene on each render (#229).
const numberFormats = new Map<string, Intl.NumberFormat>();

function numberFormat(locale: string, options?: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = options ? `${locale}|${JSON.stringify(options)}` : locale;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(locale, options);
    numberFormats.set(key, format);
  }
  return format;
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return safe(
    (loc) => numberFormat(loc, options).format(value),
    () => String(value),
  );
}

type DateInput = Date | number | string;

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value);
}

export function formatDate(value: DateInput, options?: Intl.DateTimeFormatOptions): string {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return '';
  return safe(
    (loc) => new Intl.DateTimeFormat(loc, options ?? { dateStyle: 'medium' }).format(d),
    () => d.toDateString(),
  );
}

export function formatDateTime(value: DateInput, options?: Intl.DateTimeFormatOptions): string {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return '';
  return safe(
    (loc) => new Intl.DateTimeFormat(loc, options ?? { dateStyle: 'medium', timeStyle: 'short' }).format(d),
    () => d.toString(),
  );
}

export function formatTime(value: DateInput, options?: Intl.DateTimeFormatOptions): string {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return '';
  return safe(
    (loc) => new Intl.DateTimeFormat(loc, options ?? { timeStyle: 'short' }).format(d),
    () => d.toTimeString(),
  );
}

/** "a, b and c" in the language's own way. */
export function formatList(items: readonly string[], type: 'conjunction' | 'disjunction' = 'conjunction'): string {
  return safe(
    (loc) => new Intl.ListFormat(loc, { style: 'long', type }).format(items),
    () => items.join(', '),
  );
}

/** Locale-aware comparison for sorting names the writer will read. */
export function compareText(a: string, b: string): number {
  return safe(
    (loc) => a.localeCompare(b, loc, { sensitivity: 'base', numeric: true }),
    () => (a < b ? -1 : a > b ? 1 : 0),
  );
}
