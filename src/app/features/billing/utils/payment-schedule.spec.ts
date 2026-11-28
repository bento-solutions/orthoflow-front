import { describe, expect, it } from 'vitest';
import { after, previewSchedule } from './payment-schedule';

describe('payment schedule preview', () => {
  it('splits the total into equal parts, the last taking the cents left over', () => {
    const parts = previewSchedule(1000, 3, 'MONTHLY', '2027-01-15');
    expect(parts.map(p => p.amount)).toEqual([333.33, 333.33, 333.34]);
    expect(parts.reduce((s, p) => s + p.amount, 0)).toBeCloseTo(1000, 2);
  });

  it('gives one deadline per part, a period apart from the first', () => {
    const parts = previewSchedule(500, 5, 'MONTHLY', '2027-01-10');
    expect(parts.map(p => p.dueDate)).toEqual(['2027-01-10', '2027-02-10', '2027-03-10', '2027-04-10', '2027-05-10']);
  });

  it('has a single deadline for a single payment', () => {
    expect(previewSchedule(300, 1, 'MONTHLY', '2027-03-01')).toEqual([{ seq: 1, dueDate: '2027-03-01', amount: 300 }]);
  });

  it('adds months as the server does, keeping to the end of a short month', () => {
    expect(after('2027-01-31', 'MONTHLY', 1)).toBe('2027-02-28');
    expect(after('2027-01-31', 'QUARTERLY', 1)).toBe('2027-04-30');
    expect(after('2027-01-01', 'WEEKLY', 2)).toBe('2027-01-15');
    expect(after('2027-01-01', 'BIWEEKLY', 1)).toBe('2027-01-15');
  });
});
