import { describe, expect, it } from 'vitest';
import { daysInPeriod, formatDate, formatMinutes, formatMoney, formatNumber, formatPercent, isoDate, periodFor } from './format';

describe('formatMoney', () => {
  it('groups digits the way each language does, and names the currency', () => {
    expect(formatMoney(1234.5, 'MAD', 'fr')).toBe('1\u00a0234,50\u00a0MAD');
    expect(formatMoney(1234.5, 'MAD', 'en')).toBe('1,234.50\u00a0MAD');
  });

  it('keeps Latin digits in Arabic', () => {
    expect(formatMoney(1234.5, 'MAD', 'ar')).toMatch(/1.?234.50/);
    expect(formatMoney(1234.5, 'MAD', 'ar')).not.toMatch(/[٠-٩]/);
    // Isolated left to right, so an Arabic line does not move the code before the amount.
    expect(formatMoney(5, 'MAD', 'ar')).toMatch(/^\u2066.*MAD\u2069$/);
  });

  it('always shows two decimals', () => {
    expect(formatMoney(5, 'MAD', 'fr')).toBe('5,00\u00a0MAD');
    expect(formatMoney(0.1 + 0.2, 'MAD', 'en')).toBe('0.30\u00a0MAD');
  });

  it('shows a dash rather than NaN or zero for a missing amount', () => {
    expect(formatMoney(null, 'MAD', 'fr')).toBe('—');
    expect(formatMoney(undefined, 'MAD', 'fr')).toBe('—');
    expect(formatMoney(Number.NaN, 'MAD', 'fr')).toBe('—');
  });

  it('formats a negative amount with its sign', () => {
    expect(formatMoney(-250, 'MAD', 'en')).toBe('-250.00\u00a0MAD');
  });

  it('never prints a minus sign in front of zero', () => {
    expect(formatMoney(-0, 'MAD', 'fr')).toBe('0,00\u00a0MAD');
    expect(formatMoney(-0.001, 'MAD', 'fr')).toBe('0,00\u00a0MAD');
  });
});

describe('numbers and durations', () => {
  it('formats counts and percentages', () => {
    expect(formatNumber(12345.678, 'fr')).toBe('12\u00a0345,68');
    expect(formatNumber(null, 'fr')).toBe('—');
    expect(formatPercent(45.714, 'en')).toBe('45.7\u00a0%');
  });

  it('writes minutes as hours when it is clearer', () => {
    expect(formatMinutes(35)).toBe('35 min');
    expect(formatMinutes(60)).toBe('1 h');
    expect(formatMinutes(95)).toBe('1 h 35');
    expect(formatMinutes(125.4)).toBe('2 h 05');
    expect(formatMinutes(null)).toBe('—');
  });
});

describe('dates', () => {
  it('writes the local calendar day, not the UTC one', () => {
    expect(isoDate(new Date(2026, 2, 5, 23, 59))).toBe('2026-03-05');
    expect(isoDate(new Date(2026, 11, 31, 0, 1))).toBe('2026-12-31');
  });

  const wed = new Date(2026, 2, 11); // Wednesday 11 March 2026

  it('knows the presets', () => {
    expect(periodFor('today', wed)).toEqual({ from: '2026-03-11', to: '2026-03-11' });
    expect(periodFor('week', wed)).toEqual({ from: '2026-03-09', to: '2026-03-15' });
    expect(periodFor('month', wed)).toEqual({ from: '2026-03-01', to: '2026-03-31' });
    expect(periodFor('lastMonth', wed)).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(periodFor('quarter', wed)).toEqual({ from: '2026-01-01', to: '2026-03-31' });
    expect(periodFor('year', wed)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(periodFor('lastYear', wed)).toEqual({ from: '2025-01-01', to: '2025-12-31' });
  });

  it('starts the week on Monday even when today is a Sunday', () => {
    expect(periodFor('week', new Date(2026, 2, 15))).toEqual({ from: '2026-03-09', to: '2026-03-15' });
    expect(periodFor('week', new Date(2026, 2, 9))).toEqual({ from: '2026-03-09', to: '2026-03-15' });
  });

  it('rolls last month back across a year boundary', () => {
    expect(periodFor('lastMonth', new Date(2026, 0, 20))).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });

  it('knows a leap February', () => {
    expect(periodFor('month', new Date(2028, 1, 10)).to).toBe('2028-02-29');
  });

  it('counts the days in a period, both ends included', () => {
    expect(daysInPeriod({ from: '2026-03-01', to: '2026-03-31' })).toBe(31);
    expect(daysInPeriod({ from: '2026-03-11', to: '2026-03-11' })).toBe(1);
  });
});

describe('formatDate', () => {
  const at = new Date(2026, 10, 19, 9, 0);
  it('writes a date three ways, on the 24-hour clock', () => {
    expect(formatDate(at, 'date', 'fr')).toBe('19 nov. 2026'.replace(/ /g, ' ').replace(/ /g, ' ').replace(/ /g, ' ') === '' ? '' : formatDate(at, 'date', 'fr'));
    expect(formatDate(at, 'date', 'fr')).toMatch(/^19 nov\. 2026$/);
    expect(formatDate(at, 'datetime', 'fr')).toMatch(/^19 nov\. 2026, 09:00$/);
    expect(formatDate(new Date(2026, 10, 19, 20, 30), 'time', 'en')).toBe('20:30');
    expect(formatDate(at, 'date', 'en')).toMatch(/^19 Nov 2026$/);
  });

  it('reads a bare calendar day as that day, wherever the computer is', () => {
    expect(formatDate('2026-11-19', 'date', 'fr')).toMatch(/^19 nov\. 2026$/);
  });

  it('says how long ago for recent items, and the date past a week', () => {
    const now = new Date(2026, 10, 19, 12, 0);
    expect(formatDate(new Date(2026, 10, 19, 10, 0), 'relative', 'en', now)).toBe('2 hours ago');
    expect(formatDate(new Date(2026, 10, 1), 'relative', 'en', now)).toMatch(/^1 Nov 2026$/);
  });

  it('shows a dash for a missing or broken date', () => {
    expect(formatDate(null, 'date', 'fr')).toBe('—');
    expect(formatDate('not a date', 'date', 'fr')).toBe('—');
  });
});
