import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { emptyReview, mergeDraft, normalizeKeyText, normalizeTeeth, pendingCount, reviewKey } from './consultation-draft';

const here = join(process.cwd(), 'src', 'app', 'core', 'consultation', 'review-key-vectors.json');
const vectors = JSON.parse(readFileSync(here, 'utf-8')) as {
  text: { text: string; normalized: string }[];
  teeth: { teeth: string; normalized: string }[];
};

/**
 * A dictated item and the reader's reading of the same thing must get the same
 * key, or the review shows it twice. The vectors are shared with the backend's
 * ReviewKeyVectorsTest.
 */
describe('review keys', () => {
  it('normalise text exactly as the server does', () => {
    for (const vector of vectors.text) expect(normalizeKeyText(vector.text), vector.text).toBe(vector.normalized);
  });

  it('list teeth exactly as the server does', () => {
    for (const vector of vectors.teeth) expect(normalizeTeeth(vector.teeth), vector.teeth).toBe(vector.normalized);
  });

  it('use the same vectors as the server, when the backend is beside this checkout', () => {
    const backend = join(process.cwd(), '..', 'backend', 'src', 'test', 'resources', 'consultation', 'review-key-vectors.json');
    if (!existsSync(backend)) return;
    expect(JSON.parse(readFileSync(backend, 'utf-8'))).toEqual(vectors);
  });

  it('build the keys the reader builds', () => {
    expect(reviewKey('allergies', { substance: 'Pénicilline' })).toBe('allergy:penicilline');
    expect(reviewKey('medicalHistory', { category: 'CONDITION', label: 'Diabète de type 1' })).toBe('history:CONDITION:diabete de type 1');
    expect(reviewKey('activeTreatments', { label: 'Paracétamol' })).toBe('treatment:paracetamol');
    expect(reviewKey('plan', { label: 'Composite', teeth: '16 17' })).toBe('plan:composite:16,17');
  });

  it('let a reading of a dictated allergy merge into it, not beside it', () => {
    const dictated = {
      ...emptyReview(),
      allergies: [{ key: reviewKey('allergies', { substance: 'pénicilline' }), data: { substance: 'pénicilline', reaction: null, severity: null },
        quote: 'Calypso, allergie à la pénicilline', status: 'validated' as const, manual: false, edited: false, dictated: true }],
    };
    const merged = mergeDraft(dictated, {
      patient: {}, chiefComplaint: null, medicalHistory: [], activeTreatments: [], treatmentPlan: [], nextAppointment: null,
      allergies: [{ key: 'allergy:penicilline', substance: 'Pénicilline', reaction: null, severity: null, quote: 'allergie à la pénicilline' }],
    } as never);
    expect(merged.allergies).toHaveLength(1);
    expect(merged.allergies[0]).toMatchObject({ status: 'validated', dictated: true });
  });
});

describe('a proposed appointment is a decision to make', () => {
  const suggested = { ...emptyReview(), appointmentSuggestion: { date: '2026-11-11', time: '10:00', inDays: null, reason: null, quote: 'demain à 10 heures' } };
  const today = new Date(2026, 10, 10);

  it('counts as pending until used or ignored', () => {
    expect(pendingCount(suggested, {}, today)).toBe(1);
    expect(pendingCount({ ...suggested, appointmentDecision: 'dismissed' }, {}, today)).toBe(0);
    expect(pendingCount({ ...suggested, appointmentDecision: 'used', appointment: { date: '2026-11-11', time: '10:00', durationMinutes: 30, type: '', notes: '' } }, {}, today)).toBe(0);
  });

  it('is not pending without a date', () => {
    expect(pendingCount({ ...suggested, appointmentSuggestion: { ...suggested.appointmentSuggestion, date: null } }, {}, today)).toBe(0);
  });

  it('comes back to decide when the conversation changes it after it was ignored', () => {
    const dismissed = { ...suggested, appointmentDecision: 'dismissed' as const };
    const later = mergeDraft(dismissed, {
      patient: {}, chiefComplaint: null, allergies: [], medicalHistory: [], activeTreatments: [], treatmentPlan: [],
      nextAppointment: { date: '2026-11-12', time: '10:00', inDays: null, reason: null, quote: 'jeudi à 10 heures' },
    } as never);
    expect(later.appointmentDecision).toBeNull();
  });
});
