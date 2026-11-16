import { describe, expect, it } from 'vitest';
import { PatientClinicalRecord } from '../models/clinical-record.model';
import { alertsState, medicalAlerts } from './clinical-record.service';

const record = (over: Partial<PatientClinicalRecord>): PatientClinicalRecord =>
  ({ allergies: [], medicalHistory: [], notes: [], findings: [], ...over }) as PatientClinicalRecord;

describe('medical alerts', () => {
  it('merges allergies, conditions and medications, allergies first and in red', () => {
    const alerts = medicalAlerts(record({
      allergies: [{ id: 'a', substance: 'Pénicilline', severity: 'SEVERE' }],
      medicalHistory: [
        { id: 'm', category: 'MEDICATION', label: 'Aspirine' },
        { id: 'c', category: 'CONDITION', label: 'Diabète type 2' },
        { id: 's', category: 'SURGERY', label: 'Appendicectomie' },
      ],
    } as Partial<PatientClinicalRecord>));
    expect(alerts.map(a => [a.kind, a.label, a.tone])).toEqual([
      ['ALLERGY', 'Pénicilline', 'critical'],
      ['CONDITION', 'Diabète type 2', 'attention'],
      ['MEDICATION', 'Aspirine', 'attention'],
    ]);
  });

  it('tells "not asked yet" from "asked, nothing to report"', () => {
    expect(alertsState(null)).toBe('loading');
    expect(alertsState(record({}))).toBe('not-asked');
    expect(alertsState(record({ notes: [{ id: 'n', category: 'MEDICAL_HISTORY', content: 'RAS' }] } as Partial<PatientClinicalRecord>))).toBe('none');
    expect(alertsState(record({ medicalHistory: [{ id: 's', category: 'SURGERY', label: 'Appendicectomie' }] } as Partial<PatientClinicalRecord>))).toBe('none');
    expect(alertsState(record({ allergies: [{ id: 'a', substance: 'Latex' }] } as Partial<PatientClinicalRecord>))).toBe('alerts');
  });
});
