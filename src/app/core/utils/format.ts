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

/** `1 234,50 MAD` (non-breaking spaces) in French, `MAD 1,234.50` in English. A missing amount shows a dash. */
export function formatMoney(amount: number | null | undefined, currency: string, lang: string): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) {
    return '—';
  }
  return tidy(
    numberFormat(lang, { style: 'currency', currency, currencyDisplay: 'code', minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'negative' as Intl.NumberFormatOptions['signDisplay'] }).format(amount),
  );
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
