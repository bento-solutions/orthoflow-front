import { describe, expect, it } from 'vitest';
import { stagedToothFindings } from './voice-chart-marks';

describe('stagedToothFindings', () => {
  it('reads every shape a staged command takes', () => {
    expect(stagedToothFindings([
      { intent: 'clinical.addFindings', entities: { fdi: '16', findings: [{ code: 'caries', surface: 'mesial' }, { code: 'existing_amalgam' }] } },
      { intent: 'clinical.addFindings', entities: { fdi: 26, findingCodes: ['existing_crown'] } },
      { intent: 'clinical.addFindings', entities: { fdi: '36', findingCode: 'mobility' } },
    ])).toEqual([
      { fdi: '16', code: 'caries', surface: 'mesial' },
      { fdi: '16', code: 'existing_amalgam', surface: null },
      { fdi: '26', code: 'existing_crown', surface: null },
      { fdi: '36', code: 'mobility', surface: null },
    ]);
  });

  it('leaves out what is not a finding on a tooth', () => {
    expect(stagedToothFindings([
      { intent: 'clinical.addNote', entities: { fdi: '16', content: 'anxious' } },
      { intent: 'clinical.addFindings', entities: { findings: [{ code: 'caries' }] } },
    ])).toEqual([]);
  });
});
