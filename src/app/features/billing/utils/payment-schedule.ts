import type { PaymentFrequency } from '../models/billing.model';

/** How the patient pays, as the new-invoice form offers it. */
export type PaymentChoice = 'IMMEDIATE' | 'ONE_PAYMENT' | 'INSTALMENTS';

export interface SchedulePart {
  seq: number;
  dueDate: string; // yyyy-MM-dd
  amount: number;
}

/** yyyy-MM-dd in local time (not UTC, which can be yesterday or tomorrow). */
export function isoDay(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

function parseDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Months added the way the server adds them: the 31st of January plus one month is the 28th (or 29th) of February. */
function plusMonths(date: Date, months: number): Date {
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(date.getDate(), last));
  return target;
}

/** The date `periods` periods after `day`. */
export function after(day: string, frequency: PaymentFrequency, periods: number): string {
  const date = parseDay(day);
  switch (frequency) {
    case 'WEEKLY': date.setDate(date.getDate() + 7 * periods); return isoDay(date);
    case 'BIWEEKLY': date.setDate(date.getDate() + 14 * periods); return isoDay(date);
    case 'MONTHLY': return isoDay(plusMonths(date, periods));
    case 'QUARTERLY': return isoDay(plusMonths(date, 3 * periods));
  }
}

/**
 * The parts the server will create: equal amounts rounded down to the cent, the last one taking
 * what is left so they add up to the total; part 1 due on the first deadline, the next a period apart.
 * The server computes the same schedule from the same inputs; this is the preview.
 */
export function previewSchedule(total: number, count: number, frequency: PaymentFrequency, firstDueDate: string): SchedulePart[] {
  const n = Math.max(1, Math.floor(count || 1));
  const cents = Math.round(total * 100);
  const each = Math.floor(cents / n);
  return Array.from({ length: n }, (_, i) => ({
    seq: i + 1,
    dueDate: after(firstDueDate, frequency, i),
    amount: (i === n - 1 ? cents - each * (n - 1) : each) / 100,
  }));
}
