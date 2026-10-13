import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DigitBuffer, refuse } from './perio-input';
import { CellSite, PerioMode } from './perio.model';

describe('perio input rules', () => {
  it('accepts pocket depths from 0 to 16 millimetres and clearing', () => {
    expect(refuse(0, 'pocketDepth', '16', 'buccal')).toBeNull();
    expect(refuse(16, 'pocketDepth', '16', 'buccal')).toBeNull();
    expect(refuse(null, 'pocketDepth', '16', 'buccal')).toBeNull();
    expect(refuse(17, 'pocketDepth', '16', 'buccal')?.key).toBe('POCKET_DEPTH_TOO_LARGE');
    expect(refuse(-1, 'pocketDepth', '16', 'buccal')?.key).toBe('POCKET_DEPTH_NEGATIVE');
    expect(refuse(2.5, 'pocketDepth', '16', 'buccal')?.key).toBe('POCKET_DEPTH_INVALID');
  });

  it('accepts recessions from minus 10 to 16 millimetres', () => {
    expect(refuse(-10, 'recession', '16', 'buccal')).toBeNull();
    expect(refuse(-11, 'recession', '16', 'buccal')?.key).toBe('RECESSION_TOO_SMALL');
    expect(refuse(17, 'recession', '16', 'buccal')?.key).toBe('RECESSION_TOO_LARGE');
  });

  it('accepts mobility from 0 to 3', () => {
    expect(refuse(3, 'mobility', '16', 'buccal')).toBeNull();
    expect(refuse(4, 'mobility', '16', 'buccal')?.key).toBe('MOBILITY_INVALID');
    expect(refuse(1, 'mobility', '16', 'mesiobuccal')?.key).toBe('MOBILITY_ONLY_BUCCAL');
  });

  it('accepts furcation grades I to III, and only where there are furcations', () => {
    expect(refuse('II', 'furcation', '16', 'palatal_mesial')).toBeNull();
    expect(refuse('IV' as never, 'furcation', '16', 'buccal')?.key).toBe('FURCATION_INVALID');
    expect(refuse('I', 'furcation', '11', 'buccal')).toEqual({ key: 'FURCATION_NO_SITES', params: { toothCode: '11' } });
    expect(refuse('I', 'furcation', '16', 'lingual')?.key).toBe('SITE_INVALID');
  });

  it('wants a true or a false for bleeding, plaque and suppuration', () => {
    expect(refuse(true, 'bleeding', '16', 'buccal')).toBeNull();
    expect(refuse(false, 'plaque', '16', 'buccal')).toBeNull();
    expect(refuse(1, 'suppuration', '16', 'buccal')?.key).toBe('SUPPURATION_INVALID');
    expect(refuse(null, 'bleeding', '16', 'buccal')?.key).toBe('BLEEDING_INVALID');
  });
});

describe('typing digits', () => {
  type Commit = [number, string, CellSite, PerioMode];
  let commits: Commit[];
  let buffer: DigitBuffer;

  beforeEach(() => {
    vi.useFakeTimers();
    commits = [];
    buffer = new DigitBuffer((value, tooth, site, mode) => commits.push([value, tooth, site, mode]), 500);
  });
  afterEach(() => vi.useRealTimers());

  it('writes 0 and 2 to 9 at once', () => {
    buffer.type(3, '16', 'buccal', 'pocketDepth');
    buffer.type(0, '16', 'mesiobuccal', 'pocketDepth');
    expect(commits).toEqual([[3, '16', 'buccal', 'pocketDepth'], [0, '16', 'mesiobuccal', 'pocketDepth']]);
    expect(buffer.isPending).toBe(false);
  });

  it('waits for a second digit after a 1, to make 10 to 16', () => {
    buffer.type(1, '16', 'buccal', 'pocketDepth');
    expect(commits).toEqual([]);
    expect(buffer.isPending).toBe(true);

    buffer.type(2, '16', 'buccal', 'pocketDepth');
    expect(commits).toEqual([[12, '16', 'buccal', 'pocketDepth']]);
    expect(buffer.isPending).toBe(false);
  });

  it('means one millimetre when no second digit comes', () => {
    buffer.type(1, '16', 'buccal', 'pocketDepth');
    vi.advanceTimersByTime(499);
    expect(commits).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(commits).toEqual([[1, '16', 'buccal', 'pocketDepth']]);
  });

  it('writes a 1 for recession at once when the mode does not take two digits', () => {
    buffer.type(1, '16', 'buccal', 'mobility');
    expect(commits).toEqual([[1, '16', 'buccal', 'mobility']]);
  });

  it('writes a waiting digit where it was typed, even if the focus has moved on', () => {
    buffer.type(1, '16', 'buccal', 'pocketDepth');
    buffer.flush();
    expect(commits).toEqual([[1, '16', 'buccal', 'pocketDepth']]);
    buffer.type(4, '15', 'buccal', 'pocketDepth');
    expect(commits[1]).toEqual([4, '15', 'buccal', 'pocketDepth']);
  });

  it('can be dropped, for a value that was cleared', () => {
    buffer.type(1, '16', 'buccal', 'recession');
    buffer.cancel();
    vi.advanceTimersByTime(1000);
    expect(commits).toEqual([]);
    expect(buffer.isPending).toBe(false);
  });

  it('keeps the cell of the first digit for the second', () => {
    buffer.type(1, '16', 'buccal', 'pocketDepth');
    buffer.type(5, '17', 'lingual', 'pocketDepth');
    expect(commits).toEqual([[15, '16', 'buccal', 'pocketDepth']]);
  });
});
