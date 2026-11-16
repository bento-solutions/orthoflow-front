/**
 * Formatting shared by every screen that shows money, dates or durations.
 *
 * Numbers use the Latin digits in every language, including Arabic: Moroccan
 * clinics print and read prices that way, and a patient's invoice must not change
 * its digits with the interface language.
 */

const formatters = new Map<string, Intl.NumberFormat>();

/**
 * Intl groups French digits with a narrow no-break space (U+202F) and others with a
 * no-break space (U+00A0). Both stay non-breaking, so an amount never wraps in the
 * middle of a number, but U+202F is missing from some fonts and renders as a box, so
 * every grouping space is unified to U+00A0.
 */
const tidy = (text: string): string => text.replace(/[\u202f\u00a0]/g, '\u00a0');

function numberFormat(lang: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${lang}|${JSON.stringify(options)}`;
  let format = formatters.get(key);
  if (!format) {
    format = new Intl.NumberFormat(`${lang}-u-nu-latn`, options);
    formatters.set(key, format);
  }
  return format;
}

/**
 * `1 234,50 MAD` in French, `1,234.50 MAD` in English: the amount, then the currency code, in every
 * language (UX audit P2-1), with the language's own separators. Non-breaking spaces throughout, so
 * an amount never wraps. A missing amount shows a dash.
 */
export function formatMoney(amount: number | null | undefined, currency: string, lang: string): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) {
    return '—';
  }
  const figure = numberFormat(lang, { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'negative' as Intl.NumberFormatOptions['signDisplay'] }).format(amount);
  return tidy(`${figure}\u00a0${currency}`);
}

/** A plain number with the language's grouping, for counts and quantities. */
export function formatNumber(value: number | null | undefined, lang: string, maximumFractionDigits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—';
  }
  return tidy(numberFormat(lang, { maximumFractionDigits }).format(value));
}

export function formatPercent(value: number | null | undefined, lang: string): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—';
  }
  return `${tidy(numberFormat(lang, { maximumFractionDigits: 1 }).format(value))}\u00a0%`;
}

/** `95` becomes `1 h 35`; under an hour, `35 min`. */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || Number.isNaN(minutes)) {
    return '—';
  }
  const total = Math.round(minutes);
  if (total < 60) {
    return `${total} min`;
  }
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, '0')}`;
}

/** A local calendar date as `yyyy-MM-dd`, which is what the API takes. Not `toISOString()`, which would shift the day near midnight. */
export function isoDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export type PeriodPreset = 'today' | 'week' | 'month' | 'lastMonth' | 'quarter' | 'year' | 'lastYear';

export interface Period {
  from: string;
  to: string;
}

/** The dates a preset stands for, relative to {@code today}. Weeks run Monday to Sunday. */
export function periodFor(preset: PeriodPreset, today: Date = new Date()): Period {
  const y = today.getFullYear();
  const m = today.getMonth();
  const at = (year: number, month: number, day: number) => new Date(year, month, day);
  switch (preset) {
    case 'today':
      return { from: isoDate(today), to: isoDate(today) };
    case 'week': {
      const monday = at(y, m, today.getDate() - ((today.getDay() + 6) % 7));
      return { from: isoDate(monday), to: isoDate(at(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6)) };
    }
    case 'month':
      return { from: isoDate(at(y, m, 1)), to: isoDate(at(y, m + 1, 0)) };
    case 'lastMonth':
      return { from: isoDate(at(y, m - 1, 1)), to: isoDate(at(y, m, 0)) };
    case 'quarter': {
      const first = Math.floor(m / 3) * 3;
      return { from: isoDate(at(y, first, 1)), to: isoDate(at(y, first + 3, 0)) };
    }
    case 'year':
      return { from: isoDate(at(y, 0, 1)), to: isoDate(at(y, 11, 31)) };
    case 'lastYear':
      return { from: isoDate(at(y - 1, 0, 1)), to: isoDate(at(y - 1, 11, 31)) };
  }
}

/** Whole days from {@code from} to {@code to}, inclusive. */
export function daysInPeriod(period: Period): number {
  const ms = new Date(`${period.to}T00:00:00`).getTime() - new Date(`${period.from}T00:00:00`).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

/** The three ways a date is written (UX audit P2-2). */
export type DateForm = 'date' | 'datetime' | 'time' | 'relative' | 'long';

const dateFormats = new Map<string, Intl.DateTimeFormat>();

/** French and Arabic as written in Morocco; English in the day-month-year order the clinics use. */
const DATE_LOCALE: Record<string, string> = { fr: 'fr-FR', en: 'en-GB', ar: 'ar-MA' };

function dateFormat(lang: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const locale = `${DATE_LOCALE[lang] ?? lang}-u-nu-latn`;
  const key = `${locale}|${JSON.stringify(options)}`;
  let format = dateFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(locale, options);
    dateFormats.set(key, format);
  }
  return format;
}

function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  // A bare yyyy-MM-dd is a calendar day, not midnight UTC: read it as local so it never shifts a day.
  const date = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * `19 nov. 2026` (date), `19 nov. 2026, 09:00` (datetime), `09:00` (time), `jeudi 19 novembre 2026`
 * (long), or how long ago for recent items (relative). Always the 24-hour clock and Latin digits.
 * A missing date shows a dash.
 */
export function formatDate(value: Date | string | number | null | undefined, form: DateForm, lang: string, now: Date = new Date()): string {
  const date = toDate(value);
  if (!date) return '—';
  const day: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
  const time: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' };
  switch (form) {
    case 'date':
      return tidy(dateFormat(lang, day).format(date));
    case 'time':
      return tidy(dateFormat(lang, time).format(date));
    case 'datetime':
      return tidy(`${dateFormat(lang, day).format(date)}, ${dateFormat(lang, time).format(date)}`);
    case 'long':
      return tidy(dateFormat(lang, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(date));
    case 'relative': {
      const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
      const abs = Math.abs(seconds);
      // Past a week, "il y a 23 jours" is harder to place than the date itself.
      if (abs >= 7 * 86_400) return formatDate(date, 'date', lang, now);
      const rtf = new Intl.RelativeTimeFormat(`${DATE_LOCALE[lang] ?? lang}-u-nu-latn`, { numeric: 'auto' });
      if (abs < 60) return rtf.format(0, 'second');
      if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
      if (abs < 86_400) return rtf.format(Math.round(seconds / 3600), 'hour');
      return rtf.format(Math.round(seconds / 86_400), 'day');
    }
  }
}
