import { describe, expect, it } from 'vitest';
import {
  emptyPerioData, fromApi, hasMeasurements, isEmptyChart, statusOf, summarize, toApi, valueAt, withToothCleared,
  withToothStatus, withValue,
} from './perio-data';
import { ApiTeeth } from './perio.model';

/** The very chart the server's PerioSummaryTest works out by hand: both must agree. */
const SAMPLE: ApiTeeth = {
  '16': {
    pocketDepth: { mesiobuccal: 3, buccal: 4, distobuccal: 6 },
    recession: { mesiobuccal: 1, buccal: 0 },
    bleeding: ['buccal', 'distobuccal'],
    plaque: ['mesiobuccal'],
  },
  '26': { pocketDepth: { mesiobuccal: 2, buccal: 10 }, suppuration: ['buccal'] },
  '11': { bleeding: ['buccal'] },
};

describe('perio data', () => {
  it('a new chart has 32 teeth, nothing charted', () => {
    const data = emptyPerioData();
    expect(Object.keys(data)).toHaveLength(32);
    expect(isEmptyChart(data)).toBe(true);
    expect(data['16'].pocketDepth.buccal).toBeNull();
    expect(data['16'].bleeding.buccal).toBe(false);
  });

  it('round-trips through the sparse wire format', () => {
    expect(toApi(fromApi(SAMPLE))).toEqual({
      '16': {
        pocketDepth: { mesiobuccal: 3, buccal: 4, distobuccal: 6 },
        recession: { mesiobuccal: 1, buccal: 0 },
        bleeding: ['buccal', 'distobuccal'],
        plaque: ['mesiobuccal'],
      },
      '26': { pocketDepth: { mesiobuccal: 2, buccal: 10 }, suppuration: ['buccal'] },
      '11': { bleeding: ['buccal'] },
    });
  });

  it('sends nothing for an empty chart, and never a tooth with nothing on it', () => {
    expect(toApi(emptyPerioData())).toEqual({});
  });

  it('keeps a recession of zero: it was measured', () => {
    const data = withValue(emptyPerioData(), '11', 'recession', 'buccal', 0);
    expect(toApi(data)['11']).toEqual({ recession: { buccal: 0 } });
  });

  it('writes one value at a time without touching the previous chart', () => {
    const before = emptyPerioData();
    const after = withValue(before, '16', 'pocketDepth', 'buccal', 5);

    expect(valueAt(after, '16', 'pocketDepth', 'buccal')).toBe(5);
    expect(valueAt(before, '16', 'pocketDepth', 'buccal')).toBeNull();
    expect(after['17']).toBe(before['17']);
  });

  it('writes every kind of value', () => {
    let data = emptyPerioData();
    data = withValue(data, '16', 'recession', 'lingual', -2);
    data = withValue(data, '16', 'bleeding', 'buccal', true);
    data = withValue(data, '16', 'plaque', 'buccal', true);
    data = withValue(data, '16', 'suppuration', 'buccal', true);
    data = withValue(data, '16', 'mobility', 'buccal', 2);
    data = withValue(data, '16', 'furcation', 'palatal_mesial', 'II');

    expect(valueAt(data, '16', 'recession', 'lingual')).toBe(-2);
    expect(valueAt(data, '16', 'bleeding', 'buccal')).toBe(true);
    expect(valueAt(data, '16', 'plaque', 'buccal')).toBe(true);
    expect(valueAt(data, '16', 'suppuration', 'buccal')).toBe(true);
    expect(valueAt(data, '16', 'mobility', 'buccal')).toBe(2);
    expect(valueAt(data, '16', 'furcation', 'palatal_mesial')).toBe('II');
  });

  it('removes a furcation, a depth, a flag when it is cleared', () => {
    let data = withValue(emptyPerioData(), '16', 'furcation', 'buccal', 'I');
    data = withValue(data, '16', 'furcation', 'buccal', null);
    data = withValue(data, '16', 'bleeding', 'buccal', true);
    data = withValue(data, '16', 'bleeding', 'buccal', false);

    expect(isEmptyChart(data)).toBe(true);
  });

  it('a tooth that goes missing loses its measurements', () => {
    const data = fromApi(SAMPLE);
    expect(hasMeasurements(data['16'])).toBe(true);

    const cleared = withToothCleared(data, '16');

    expect(hasMeasurements(cleared['16'])).toBe(false);
    expect(hasMeasurements(cleared['26'])).toBe(true);
  });

  it('tracks which teeth are not simply present', () => {
    let status = withToothStatus({}, '18', 'missing');
    status = withToothStatus(status, '46', 'implant');
    expect(statusOf(status, '18')).toBe('missing');
    expect(statusOf(status, '11')).toBe('present');

    status = withToothStatus(status, '18', 'present');
    expect(status).toEqual({ '46': 'implant' });
  });
});

describe('perio summary', () => {
  const summary = summarize(fromApi(SAMPLE));

  it('has nothing to report on an empty chart', () => {
    const empty = summarize(emptyPerioData());
    expect(empty.sitesRecorded).toBe(0);
    expect(empty.bleedingPercent).toBe(0);
    expect(empty.meanPocketDepth).toBeNull();
    expect(empty.deepestPocketDepth).toBeNull();
  });

  it('counts percentages over the sites that were examined', () => {
    expect(summary.sitesRecorded).toBe(6);
    expect(summary.bleedingPercent).toBe(50);
    expect(summary.plaquePercent).toBe(16.7);
    expect(summary.suppurationPercent).toBe(16.7);
  });

  it('works out the pocket figures from the recorded depths only', () => {
    expect(summary.meanPocketDepth).toBe(5);
    expect(summary.pocketsAboveFourPercent).toBe(60);
    expect(summary.deepestPocketDepth).toBe(10);
  });

  it('works out attachment loss where depth and recession meet', () => {
    expect(summary.meanRecession).toBe(0.5);
    expect(summary.meanCal).toBe(4);
    expect(summary.sitesAboveFiveCalPercent).toBe(0);
  });

  it('treats a depth of zero as measured', () => {
    const zero = summarize(withValue(emptyPerioData(), '11', 'pocketDepth', 'buccal', 0));
    expect(zero.sitesRecorded).toBe(1);
    expect(zero.meanPocketDepth).toBe(0);
    expect(zero.pocketsAboveFourPercent).toBe(0);
  });

  it('lets a negative recession lower the means', () => {
    let data = withValue(emptyPerioData(), '11', 'pocketDepth', 'buccal', 5);
    data = withValue(data, '11', 'recession', 'buccal', -2);
    const s = summarize(data);
    expect(s.meanRecession).toBe(-2);
    expect(s.meanCal).toBe(3);
  });

  it('does not count mobility or furcation as sites', () => {
    let data = withValue(emptyPerioData(), '16', 'mobility', 'buccal', 2);
    data = withValue(data, '16', 'furcation', 'buccal', 'II');
    expect(summarize(data).sitesRecorded).toBe(0);
  });
});
