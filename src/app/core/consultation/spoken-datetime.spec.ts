import { describe, expect, it } from 'vitest';
import { parseSpokenDateTime } from './spoken-datetime';

/** A Tuesday: 10 Nov 2026, the day of the session the cockpit was built from. */
const TUESDAY = new Date(2026, 10, 10);
const read = (said: string, today = TUESDAY) => parseSpokenDateTime(said, today);

describe('parseSpokenDateTime', () => {
  it('reads tomorrow, the day after, and today', () => {
    expect(read('demain à 10 heures')).toEqual({ date: '2026-11-11', time: '10:00' });
    expect(read('après-demain à dix heures et quart')).toEqual({ date: '2026-11-12', time: '10:15' });
    expect(read("aujourd'hui à 18h")).toEqual({ date: '2026-11-10', time: '18:00' });
  });

  it('reads a delay in days, weeks and months', () => {
    expect(read('dans 15 jours')).toEqual({ date: '2026-11-25', time: null });
    expect(read('dans deux semaines à 14h')).toEqual({ date: '2026-11-24', time: '14:00' });
    expect(read('dans un mois')).toEqual({ date: '2026-12-10', time: null });
  });

  it('keeps a month\'s end a month\'s end', () => {
    expect(read('dans un mois', new Date(2026, 0, 31))).toEqual({ date: '2026-02-28', time: null });
    expect(read('dans 3 jours', new Date(2026, 1, 27))).toEqual({ date: '2026-03-02', time: null });
  });

  it('reads a weekday as the next one, and the same weekday as next week', () => {
    expect(read('lundi prochain 9 h 30')).toEqual({ date: '2026-11-16', time: '09:30' });
    expect(read('jeudi')).toEqual({ date: '2026-11-12', time: null });
    expect(read('mardi')).toEqual({ date: '2026-11-17', time: null });
    expect(read('lundi', new Date(2026, 10, 16))).toEqual({ date: '2026-11-23', time: null });
  });

  it('reads a named date, next year once it has passed', () => {
    expect(read('le 20 novembre à midi et demie')).toEqual({ date: '2026-11-20', time: '12:30' });
    expect(read('le 5 janvier')).toEqual({ date: '2027-01-05', time: null });
    expect(read('le 1er décembre à midi')).toEqual({ date: '2026-12-01', time: '12:00' });
  });

  it('reads the ways a time is said', () => {
    expect(read('demain 10h30')?.time).toBe('10:30');
    expect(read('demain à 8 heures moins le quart')?.time).toBe('07:45');
    expect(read('tomorrow at 10')?.time).toBe('10:00');
  });

  it('is nothing without a date', () => {
    expect(read('à 10 heures')).toBeNull();
    expect(read('on se revoit bientôt')).toBeNull();
  });
});
