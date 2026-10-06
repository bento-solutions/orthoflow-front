import { describe, expect, it } from 'vitest';
import { zonedIso } from './zoned';

describe('zonedIso', () => {
  it('uses +01:00 in Casablanca in an ordinary month', () => {
    expect(zonedIso('2026-10-06', '10:00', 'Africa/Casablanca')).toBe('2026-10-06T10:00:00+01:00');
  });

  it('uses +00:00 in Casablanca during Ramadan, when the clocks go back an hour', () => {
    // Ramadan 2026 began around 18 February and ended around 19 March.
    expect(zonedIso('2026-03-01', '10:00', 'Africa/Casablanca')).toBe('2026-03-01T10:00:00+00:00');
  });

  it('follows a zone that changes with the seasons', () => {
    expect(zonedIso('2026-01-15', '09:30', 'Europe/Paris')).toBe('2026-01-15T09:30:00+01:00');
    expect(zonedIso('2026-07-15', '09:30', 'Europe/Paris')).toBe('2026-07-15T09:30:00+02:00');
  });

  it('writes a negative or half-hour offset correctly', () => {
    expect(zonedIso('2026-07-15', '12:00', 'America/New_York')).toBe('2026-07-15T12:00:00-04:00');
    expect(zonedIso('2026-07-15', '12:00', 'Asia/Kolkata')).toBe('2026-07-15T12:00:00+05:30');
  });

  it('names the same instant whatever the visitor\'s own zone is', () => {
    const iso = zonedIso('2026-10-06', '10:00', 'Africa/Casablanca');
    expect(new Date(iso).toISOString()).toBe('2026-10-06T09:00:00.000Z');
  });
});
