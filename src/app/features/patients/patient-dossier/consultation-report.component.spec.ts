import { describe, it, expect } from 'vitest';
import { ClinicalNote } from '../../../core/models/clinical-record.model';
import { reportVisits } from './consultation-report.component';

function note(id: string, category: ClinicalNote['category'], sessionId: string | undefined, createdAt: string, content = id): ClinicalNote {
  return { id, category, sessionId, createdAt, content } as ClinicalNote;
}

describe('reportVisits', () => {
  it('groups what a consultation save filed by its session, newest first', () => {
    const visits = reportVisits([
      note('r1', 'CONSULTATION_REPORT', 's1', '2026-10-01T10:00:00Z'),
      note('c1', 'CHIEF_COMPLAINT', 's1', '2026-10-01T10:00:00Z'),
      note('r2', 'CONSULTATION_REPORT', 's2', '2026-11-02T09:00:00Z'),
      note('p2', 'TREATMENT_PLAN', 's2', '2026-11-02T09:00:00Z'),
      note('t2', 'CONSULTATION_TRANSCRIPT', 's2', '2026-11-02T09:00:00Z'),
    ]);
    expect(visits.map((v) => v.sessionId)).toEqual(['s2', 's1']);
    expect(visits[0].plan?.id).toBe('p2');
    expect(visits[0].transcript?.id).toBe('t2');
    expect(visits[0].complaint).toBeNull();
    expect(visits[1].complaint?.id).toBe('c1');
  });

  it('leaves out a session with no report, and notes typed by hand', () => {
    const visits = reportVisits([
      note('p1', 'TREATMENT_PLAN', 's1', '2026-10-01T10:00:00Z'),
      note('g1', 'GENERAL', undefined, '2026-10-03T10:00:00Z'),
      note('r3', 'CONSULTATION_REPORT', 's3', '2026-10-04T10:00:00Z', '   '),
    ]);
    expect(visits).toEqual([]);
  });
});
