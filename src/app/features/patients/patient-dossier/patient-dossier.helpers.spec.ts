import { describe, expect, it } from 'vitest';
import { PatientTreatment } from '../../../core/models/patient-treatment.model';
import { patientState, tabFromQuery } from './patient-dossier.component';
import { visitTimeline, VisitItem } from './visits-tab.component';

const tabs = ['summary', 'chart', 'visits', 'imaging', 'billing', 'documents'];
const t = (status: string) => ({ status } as PatientTreatment);

describe('patient file tabs in the address', () => {
  it('opens the tab the address names', () => {
    expect(tabFromQuery('chart', tabs)).toBe('chart');
    expect(tabFromQuery(null, tabs)).toBe('summary');
  });

  it('keeps old addresses working', () => {
    expect(tabFromQuery('overview', tabs)).toBe('summary');
    expect(tabFromQuery('clinical', tabs)).toBe('chart');
    expect(tabFromQuery('financial', tabs)).toBe('billing');
  });

  it('falls back to Summary for a tab this person may not open, or one that does not exist', () => {
    expect(tabFromQuery('billing', tabs.filter(x => x !== 'billing'))).toBe('summary');
    expect(tabFromQuery('nonsense', tabs)).toBe('summary');
  });
});

describe('the badge beside the name', () => {
  it('reads the same treatments as the summary', () => {
    expect(patientState('ACTIVE', [t('ACTIVE')]).key).toBe('PATIENTS.DOSSIER.STATE.IN_TREATMENT');
    expect(patientState('ACTIVE', [t('PLANNED')]).key).toBe('PATIENTS.DOSSIER.STATE.PLANNED');
    // "Active Treatment" over "No active treatments" can no longer happen.
    expect(patientState('ACTIVE', []).key).toBe('PATIENTS.DOSSIER.STATE.NONE');
    expect(patientState('ACTIVE', [t('COMPLETED')]).pill).toBe('pill-idle');
  });

  it('keeps a status the practice set on purpose', () => {
    expect(patientState('ON_HOLD', [t('ACTIVE')])).toEqual({ key: 'PATIENTS.DOSSIER.STATUS_ON_HOLD', pill: 'pill-attention' });
    expect(patientState('COMPLETED', []).pill).toBe('pill-done');
  });
});

describe('the visits timeline', () => {
  const item = (key: string, kind: VisitItem['kind'], date: string, status: string | null = null): VisitItem =>
    ({ key, kind, date, title: key, body: null, extra: null, status, sessionId: null, noteId: null });
  const now = new Date('2026-11-16T12:00:00Z').getTime();

  it('puts upcoming appointments first, soonest first, then the rest newest first, undated last', () => {
    const { upcoming, past } = visitTimeline([
      item('later', 'appointment', '2026-12-01T09:00:00Z'),
      item('soon', 'appointment', '2026-11-20T09:00:00Z'),
      item('cancelled', 'appointment', '2026-11-25T09:00:00Z', 'CANCELLED'),
      item('old-note', 'note', '2026-10-01T09:00:00Z'),
      item('undated', 'work', ''),
      item('consult', 'consultation', '2026-11-10T09:00:00Z'),
    ], now);
    expect(upcoming.map(i => i.key)).toEqual(['soon', 'later']);
    expect(past.map(i => i.key)).toEqual(['cancelled', 'consult', 'old-note', 'undated']);
  });
});
