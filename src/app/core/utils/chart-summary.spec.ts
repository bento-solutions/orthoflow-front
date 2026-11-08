import { describe, expect, it } from 'vitest';
import { describeChart } from './chart-summary';

describe('describeChart', () => {
  it('reads each series against its axis', () => {
    expect(describeChart('Patients', ['Jan', 'Feb'], [{ name: 'New', data: [3, 5] }, { name: 'Done', data: [1, 2] }]))
      .toBe('Patients. New — Jan : 3, Feb : 5. Done — Jan : 1, Feb : 2');
  });

  it('gets by without categories or a series name', () => {
    expect(describeChart('Trend', undefined, [{ data: [1, 2] }])).toBe('Trend. 1, 2');
  });

  it('says at least the title when there is nothing to plot', () => {
    expect(describeChart('Empty', [], undefined)).toBe('Empty');
  });
});
