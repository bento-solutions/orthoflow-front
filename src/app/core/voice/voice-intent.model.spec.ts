import { describe, expect, it } from 'vitest';
import { entityString, stagedFindingDetails } from './voice-intent.model';

/**
 * The bug this guards against is invisible where it happens. A model returning
 * `"fdi": 16` instead of `"fdi": "16"` still produces a correct clinical
 * record — the write path stringifies it — but every consumer that tested for
 * a string skipped it, so the tooth disappeared from the review chart and the
 * finding could not be removed by voice.
 */
describe('entityString', () => {
  it('passes a string through', () => {
    expect(entityString({ fdi: '16' }, 'fdi')).toBe('16');
  });

  it('accepts the number a model is just as likely to return', () => {
    expect(entityString({ fdi: 16 }, 'fdi')).toBe('16');
  });

  it('returns null for anything that is not a usable identifier', () => {
    expect(entityString({ fdi: null }, 'fdi')).toBeNull();
    expect(entityString({ fdi: '   ' }, 'fdi')).toBeNull();
    expect(entityString({ fdi: NaN }, 'fdi')).toBeNull();
    expect(entityString({}, 'fdi')).toBeNull();
    expect(entityString(undefined, 'fdi')).toBeNull();
  });
});

describe('stagedFindingDetails', () => {
  it('says which finding was said with a doubt, and which came with a measure', () => {
    const details = stagedFindingDetails({
      fdi: '36',
      findings: [
        { code: 'caries', surface: 'mesial' },
        { code: 'gingival_recession', surface: 'buccal', note: '3 mm' },
        { code: 'crown_fracture', certainty: 'SUSPECTED' },
        { code: 'mobility', note: 'grade 2' },
        { code: 'furcation_involvement', note: 'grade II' },
      ],
    });
    expect(details.get('caries')).toEqual({ suspected: false, measure: '' });
    expect(details.get('gingival_recession')).toEqual({ suspected: false, measure: '3 mm' });
    expect(details.get('crown_fracture')).toEqual({ suspected: true, measure: '' });
    expect(details.get('mobility')?.measure).toBe('grade 2');
    expect(details.get('furcation_involvement')?.measure).toBe('grade II');
  });

  it('shows a note only when it is a measure', () => {
    const details = stagedFindingDetails({ findings: [{ code: 'caries', note: 'patient anxieux' }, { code: 'pocket', note: '5,5 mm' }] });
    expect(details.get('caries')?.measure).toBe('');
    expect(details.get('pocket')?.measure).toBe('5,5 mm');
  });

  it('is empty for a command that carries no findings, or findings that are not objects', () => {
    expect(stagedFindingDetails(undefined).size).toBe(0);
    expect(stagedFindingDetails({ findingCodes: ['caries'] }).size).toBe(0);
    expect(stagedFindingDetails({ findings: [null, 'caries', { code: 12 }] }).size).toBe(0);
  });
});
