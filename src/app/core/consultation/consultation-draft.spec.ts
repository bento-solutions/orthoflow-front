import { describe, expect, it } from 'vitest';
import {
  addManualItem,
  ageOn,
  approximateBirthDate,
  emptyReview,
  enterPatientField,
  fromStoredReview,
  mergeDraft,
  patientChanges,
  pendingCount,
  planTotal,
  ReviewState,
  setItem,
  setPatientField,
  toCommitRequest,
  toStoredReview,
  validateAll,
} from './consultation-draft';
import { ConsultationDraftDto } from './consultation.model';

/**
 * The merge is the one place in this feature where a bug is invisible: the
 * screen looks right while quietly undoing a decision the doctor made. These
 * pin the rule — a decision is never undone by a later proposal.
 */

const TODAY = new Date('2026-10-01T10:00:00');

function draft(overrides: Partial<ConsultationDraftDto> = {}): ConsultationDraftDto {
  return {
    patient: {
      firstName: null, lastName: null, age: null, dateOfBirth: null, gender: null,
      phone: null, cin: null, insuranceProvider: null, insuranceNumber: null,
    },
    chiefComplaint: null,
    activeTreatments: [],
    allergies: [],
    medicalHistory: [],
    treatmentPlan: [],
    nextAppointment: null,
    source: 'groq:test',
    ...overrides,
  };
}

const PENICILLIN = { key: 'allergy:penicilline', substance: 'pénicilline', reaction: null, severity: null, quote: 'allergique à la pénicilline' };
const withPhone = (value: string) => draft({
  patient: { ...draft().patient, phone: { value, quote: `mon numéro ${value}` } },
});

describe('mergeDraft — fields', () => {
  it('proposes what the model reads', () => {
    const state = mergeDraft(emptyReview(), withPhone('0612345678'));

    expect(state.patient.phone).toMatchObject({ value: '0612345678', status: 'proposed', manual: false, edited: false });
    expect(state.patient.phone?.quote).toContain('0612345678');
  });

  it('follows the model while nobody has touched the field, so a spoken correction lands', () => {
    let state = mergeDraft(emptyReview(), withPhone('0611111111'));
    state = mergeDraft(state, withPhone('0622222222'));

    expect(state.patient.phone?.value).toBe('0622222222');
  });

  it('never overwrites a field the doctor validated', () => {
    let state = mergeDraft(emptyReview(), withPhone('0611111111'));
    state = setPatientField(state, 'phone', { status: 'validated' });
    state = mergeDraft(state, withPhone('0699999999'));

    expect(state.patient.phone).toMatchObject({ value: '0611111111', status: 'validated' });
  });

  it('never overwrites a field the doctor edited, even if it is still unvalidated', () => {
    let state = mergeDraft(emptyReview(), withPhone('0611111111'));
    state = setPatientField(state, 'phone', { value: '0600000000', edited: true });
    state = mergeDraft(state, withPhone('0622222222'));

    expect(state.patient.phone?.value).toBe('0600000000');
  });

  it('keeps a value the doctor typed when the model has nothing to say', () => {
    let state = enterPatientField(emptyReview(), 'cin', 'BK123456');
    state = mergeDraft(state, draft());

    expect(state.patient.cin).toMatchObject({ value: 'BK123456', manual: true, status: 'validated' });
  });

  it('does not bring back a field the doctor removed when the model says the same thing again', () => {
    let state = mergeDraft(emptyReview(), withPhone('0611111111'));
    state = setPatientField(state, 'phone', { status: 'removed' });
    state = mergeDraft(state, withPhone('0611111111'));

    expect(state.patient.phone?.status).toBe('removed');
  });

  it('does propose a removed field again when the patient said something different', () => {
    let state = mergeDraft(emptyReview(), withPhone('0611111111'));
    state = setPatientField(state, 'phone', { status: 'removed' });
    state = mergeDraft(state, withPhone('0622222222'));

    expect(state.patient.phone).toMatchObject({ value: '0622222222', status: 'proposed' });
  });

  it('drops an untouched proposal the model no longer makes', () => {
    let state = mergeDraft(emptyReview(), withPhone('0611111111'));
    state = mergeDraft(state, draft());

    expect(state.patient.phone).toBeUndefined();
  });
});

describe('mergeDraft — lists', () => {
  it('adds new items as proposals', () => {
    const state = mergeDraft(emptyReview(), draft({ allergies: [PENICILLIN] }));

    expect(state.allergies).toHaveLength(1);
    expect(state.allergies[0]).toMatchObject({ key: 'allergy:penicilline', status: 'proposed', data: { substance: 'pénicilline' } });
  });

  it('is idempotent: the same draft twice is the same state', () => {
    const once = mergeDraft(emptyReview(), draft({ allergies: [PENICILLIN] }));
    const twice = mergeDraft(once, draft({ allergies: [PENICILLIN] }));

    expect(twice.allergies).toEqual(once.allergies);
  });

  it('does not resurrect an item the doctor removed', () => {
    let state = mergeDraft(emptyReview(), draft({ allergies: [PENICILLIN] }));
    state = setItem(state, 'allergies', PENICILLIN.key, { status: 'removed' });
    state = mergeDraft(state, draft({ allergies: [PENICILLIN] }));

    expect(state.allergies).toHaveLength(1);
    expect(state.allergies[0].status).toBe('removed');
  });

  it('keeps the removal even after the model stops saying it, so a later mention cannot bring it back', () => {
    let state = mergeDraft(emptyReview(), draft({ allergies: [PENICILLIN] }));
    state = setItem(state, 'allergies', PENICILLIN.key, { status: 'removed' });
    state = mergeDraft(state, draft());
    state = mergeDraft(state, draft({ allergies: [PENICILLIN] }));

    expect(state.allergies[0].status).toBe('removed');
  });

  it('keeps what the doctor validated, with the doctor\'s own edits', () => {
    let state = mergeDraft(emptyReview(), draft({ allergies: [PENICILLIN] }));
    state = setItem(state, 'allergies', PENICILLIN.key, {
      status: 'validated', edited: true, data: { substance: 'amoxicilline', reaction: 'urticaire', severity: 'MODERATE' },
    });
    state = mergeDraft(state, draft({ allergies: [PENICILLIN] }));

    expect(state.allergies[0]).toMatchObject({ status: 'validated', data: { substance: 'amoxicilline', severity: 'MODERATE' } });
  });

  it('updates an untouched item from the new draft, so a correction in the conversation lands', () => {
    let state = mergeDraft(emptyReview(), draft({ allergies: [PENICILLIN] }));
    state = mergeDraft(state, draft({ allergies: [{ ...PENICILLIN, reaction: 'urticaire', severity: 'SEVERE' }] }));

    expect(state.allergies[0].data).toMatchObject({ reaction: 'urticaire', severity: 'SEVERE' });
    expect(state.allergies[0].status).toBe('proposed');
  });

  it('drops an untouched proposal the model has withdrawn', () => {
    let state = mergeDraft(emptyReview(), draft({ allergies: [PENICILLIN] }));
    state = mergeDraft(state, draft());

    expect(state.allergies).toHaveLength(0);
  });

  it('keeps items the doctor typed', () => {
    let state = addManualItem(emptyReview(), 'allergies', { substance: 'latex', reaction: null, severity: null });
    state = mergeDraft(state, draft());

    expect(state.allergies).toHaveLength(1);
    expect(state.allergies[0]).toMatchObject({ manual: true, status: 'validated', quote: null });
  });

  it('gives two typed items different keys', () => {
    let state = addManualItem(emptyReview(), 'allergies', { substance: 'latex', reaction: null, severity: null });
    state = addManualItem(state, 'allergies', { substance: 'iode', reaction: null, severity: null });

    expect(new Set(state.allergies.map(a => a.key)).size).toBe(2);
  });

  it('carries a catalogue price into the plan and leaves the quantity at one', () => {
    const state = mergeDraft(emptyReview(), draft({
      treatmentPlan: [{
        key: 'plan:detartrage:', label: 'Détartrage', treatmentId: 'T1', treatmentCode: 'DETART', teeth: null,
        price: 250, priceSource: 'CATALOG', notes: null, quote: 'un détartrage',
      }],
    }));

    expect(state.plan[0].data).toMatchObject({ price: 250, priceSource: 'CATALOG', quantity: 1, treatmentId: 'T1' });
  });

  it('refreshes the appointment suggestion but never the doctor\'s own choice', () => {
    const choice = { date: '2026-10-20', time: '09:30', durationMinutes: 30, type: 'Contrôle', notes: '' };
    let state: ReviewState = { ...emptyReview(), appointment: choice };
    state = mergeDraft(state, draft({ nextAppointment: { date: '2026-10-16', time: null, inDays: 15, reason: null, quote: 'dans 15 jours' } }));

    expect(state.appointmentSuggestion?.date).toBe('2026-10-16');
    expect(state.appointment).toEqual(choice);
  });
});

describe('mergeDraft — a reading of only the end of the conversation', () => {
  const full = draft({
    patient: { ...draft().patient, lastName: { value: 'Alami', quote: 'je suis Alami' } },
    chiefComplaint: { value: 'douleur', quote: 'j ai mal' },
    allergies: [{ key: 'allergy:penicilline', substance: 'pénicilline', reaction: null, severity: null, quote: 'q' }],
    nextAppointment: { date: '2026-10-15', time: null, inDays: 14, reason: null, quote: 'dans 15 jours' },
  });

  it('keeps what it could not see, instead of taking it for unsaid', () => {
    const tail = draft({
      treatmentPlan: [{ key: 'plan:couronne:36', label: 'Couronne', treatmentId: null, treatmentCode: null,
        teeth: '36', price: null, priceSource: null, notes: null, quote: 'une couronne' }],
    });
    const after = mergeDraft(mergeDraft(emptyReview(), full), tail, { partial: true });

    expect(after.patient.lastName?.value).toBe('Alami');
    expect(after.chiefComplaint?.value).toBe('douleur');
    expect(after.allergies.map(a => a.key)).toEqual(['allergy:penicilline']);
    expect(after.appointmentSuggestion?.inDays).toBe(14);
    expect(after.plan.map(p => p.key)).toEqual(['plan:couronne:36']);
  });

  it('still lands a correction it does see', () => {
    const corrected = draft({ patient: { ...draft().patient, lastName: { value: 'Alaoui', quote: 'non, Alaoui' } } });
    const after = mergeDraft(mergeDraft(emptyReview(), full), corrected, { partial: true });

    expect(after.patient.lastName?.value).toBe('Alaoui');
  });

  it('a complete reading still drops an untouched proposal it no longer makes', () => {
    const after = mergeDraft(mergeDraft(emptyReview(), full), draft());

    expect(after.patient.lastName).toBeUndefined();
    expect(after.allergies).toEqual([]);
  });
});

describe('keeping the review across a reload', () => {
  it('round-trips the decisions, the report and the chart findings left out', () => {
    let review = mergeDraft(emptyReview(), draft({
      allergies: [{ key: 'allergy:latex', substance: 'latex', reaction: null, severity: null, quote: 'q' }],
    }));
    review = setItem(review, 'allergies', 'allergy:latex', { status: 'removed' });

    const back = fromStoredReview(JSON.parse(JSON.stringify(toStoredReview(review, 'Mon rapport', new Set(['a-1'])))));

    expect(back?.review.allergies[0].status).toBe('removed');
    expect(back?.report).toBe('Mon rapport');
    expect(back?.excluded).toEqual(['a-1']);
  });

  it('ignores a shape it did not write, rather than trusting it', () => {
    expect(fromStoredReview(null)).toBeNull();
    expect(fromStoredReview({ v: 2, review: emptyReview() })).toBeNull();
    expect(fromStoredReview({ v: 1, review: { ...emptyReview(), allergies: 'x' } })).toBeNull();
  });
});

describe('what still needs a decision', () => {
  const record = { firstName: 'Karim', lastName: 'Alaoui', phone: '0600000000', cin: null, dateOfBirth: '1992-04-12' };

  it('counts every proposal nobody has decided', () => {
    const state = mergeDraft(emptyReview(), draft({
      patient: { ...draft().patient, phone: { value: '0612345678', quote: 'q' }, cin: { value: 'BK123456', quote: 'q' } },
      allergies: [PENICILLIN],
    }));

    expect(pendingCount(state, record, TODAY)).toBe(3);
  });

  it('does not ask about a value the record already holds', () => {
    const state = mergeDraft(emptyReview(), withPhone('0600000000'));

    expect(pendingCount(state, record, TODAY)).toBe(0);
  });

  it('does not ask about an age that matches the date of birth already on file', () => {
    // born 12 April 1992 -> 34 on 1 October 2026
    const state = mergeDraft(emptyReview(), draft({ patient: { ...draft().patient, age: { value: 34, quote: 'j\'ai 34 ans' } } }));
    expect(pendingCount(state, record, TODAY)).toBe(0);

    const stateOff = mergeDraft(emptyReview(), draft({ patient: { ...draft().patient, age: { value: 50, quote: 'j\'ai 50 ans' } } }));
    expect(pendingCount(stateOff, record, TODAY)).toBe(1);
  });

  it('stops counting an item once it is validated or removed', () => {
    let state = mergeDraft(emptyReview(), draft({ allergies: [PENICILLIN, { ...PENICILLIN, key: 'allergy:aspirine', substance: 'aspirine' }] }));
    state = setItem(state, 'allergies', PENICILLIN.key, { status: 'validated' });
    state = setItem(state, 'allergies', 'allergy:aspirine', { status: 'removed' });

    expect(pendingCount(state, record, TODAY)).toBe(0);
  });

  it('"validate all" settles every proposal and nothing the doctor removed', () => {
    let state = mergeDraft(emptyReview(), draft({
      allergies: [PENICILLIN, { ...PENICILLIN, key: 'allergy:aspirine', substance: 'aspirine' }],
      chiefComplaint: { value: 'douleur 16', quote: 'j\'ai mal' },
    }));
    state = setItem(state, 'allergies', 'allergy:aspirine', { status: 'removed' });

    const all = validateAll(state);

    expect(all.allergies.map(a => a.status)).toEqual(['validated', 'removed']);
    expect(all.chiefComplaint?.status).toBe('validated');
    expect(pendingCount(all, record, TODAY)).toBe(0);
  });
});

describe('ages and dates of birth', () => {
  it('computes an age on a given day, before and after the birthday', () => {
    expect(ageOn('1992-04-12', TODAY)).toBe(34);
    expect(ageOn('1992-12-25', TODAY)).toBe(33);
    expect(ageOn('not a date', TODAY)).toBeNull();
  });

  it('makes an approximate date of birth from an age alone', () => {
    expect(approximateBirthDate(34, TODAY)).toBe('1992-01-01');
  });
});

describe('what is saved', () => {
  const record = { firstName: 'Karim', lastName: 'Alaoui', phone: '0600000000', dateOfBirth: null };

  function reviewed(): ReviewState {
    let state = mergeDraft(emptyReview(), draft({
      patient: {
        ...draft().patient,
        firstName: { value: 'Karim', quote: 'q' }, // already on file
        phone: { value: '0612345678', quote: 'q' },
        cin: { value: 'BK123456', quote: 'q' },
        age: { value: 34, quote: 'q' },
        gender: { value: 'm', quote: 'q' },
        insuranceProvider: { value: 'CNOPS', quote: 'q' },
      },
      allergies: [PENICILLIN, { ...PENICILLIN, key: 'allergy:aspirine', substance: 'aspirine' }],
      medicalHistory: [{ key: 'h1', category: 'CONDITION', label: 'Diabète', detail: ' depuis 10 ans ', quote: 'q' }],
      treatmentPlan: [{
        key: 'p1', label: ' Détartrage ', treatmentId: 'T1', treatmentCode: 'D', teeth: '', price: 300,
        priceSource: 'SPOKEN', notes: null, quote: 'q',
      }],
      chiefComplaint: { value: 'Douleur sur la 16', quote: 'q' },
    }));
    return validateAll(state);
  }

  it('sends only validated values that change the record', () => {
    const changes = patientChanges(reviewed(), record, TODAY);

    expect(changes).toEqual({
      phone: '0612345678', cin: 'BK123456', gender: 'M', insuranceProvider: 'CNOPS',
      dateOfBirth: '1992-01-01',
    });
    expect(changes).not.toHaveProperty('firstName');
  });

  it('never sends a field the doctor removed', () => {
    const state = setPatientField(reviewed(), 'cin', { status: 'removed' });

    expect(patientChanges(state, record, TODAY)).not.toHaveProperty('cin');
  });

  it('prefers an exact date of birth to an age', () => {
    let state = mergeDraft(emptyReview(), draft({
      patient: { ...draft().patient, age: { value: 34, quote: 'q' }, dateOfBirth: { value: '1991-06-30', quote: 'q' } },
    }));
    state = validateAll(state);

    expect(patientChanges(state, record, TODAY)?.dateOfBirth).toBe('1991-06-30');
  });

  it('sends nothing for the patient when nothing changed', () => {
    expect(patientChanges(emptyReview(), record, TODAY)).toBeNull();
  });

  it('builds the request from validated items only, trimmed', () => {
    let state = reviewed();
    state = setItem(state, 'allergies', 'allergy:aspirine', { status: 'removed' });

    const request = toCommitRequest(state, record, TODAY, { report: '  Compte rendu  ', appointment: null });

    expect(request.allergies).toEqual([{ substance: 'pénicilline', reaction: null, severity: null }]);
    expect(request.medicalHistory).toEqual([{ category: 'CONDITION', label: 'Diabète', detail: 'depuis 10 ans' }]);
    expect(request.treatmentPlan).toEqual([{
      label: 'Détartrage', treatmentId: 'T1', teeth: null, price: 300, quantity: 1, notes: null, performed: false,
    }]);
    expect(request.chiefComplaint).toBe('Douleur sur la 16');
    expect(request.report).toBe('Compte rendu');
    expect(request.nextAppointment).toBeNull();
  });

  it('sends a plan line the doctor ticked as done today as performed, for the insurer form', () => {
    const state = reviewed();
    const key = state.plan[0].key;
    const done = setItem(state, 'plan', key, { data: { ...state.plan[0].data, performed: true } as never, edited: true });

    expect(toCommitRequest(done, record, TODAY, { report: null, appointment: null }).treatmentPlan[0].performed).toBe(true);
    // A re-reading of the conversation does not undo the doctor's tick.
    const merged = mergeDraft(done, draft());
    expect(merged.plan.find(p => p.key === key)?.data.performed).toBe(true);
  });

  it('leaves out an item that was never validated', () => {
    const state = mergeDraft(emptyReview(), draft({ allergies: [PENICILLIN] }));

    expect(toCommitRequest(state, record, TODAY, { report: null, appointment: null }).allergies).toEqual([]);
  });

  it('books the appointment only when the doctor chose one', () => {
    const state: ReviewState = {
      ...reviewed(),
      appointment: { date: '2026-10-16', time: '10:00', durationMinutes: 45, type: 'Contrôle', notes: '' },
    };

    const request = toCommitRequest(state, record, TODAY, {
      report: null, appointment: { dateTime: '2026-10-16T10:00:00+01:00' },
    });

    expect(request.nextAppointment).toEqual({
      dateTime: '2026-10-16T10:00:00+01:00', durationMinutes: 45, type: 'Contrôle', chairId: null, notes: null,
    });
  });

  it('never carries chart plumbing of its own — the caller adds the chart ids', () => {
    const request = toCommitRequest(emptyReview(), record, TODAY, { report: null, appointment: null });

    expect(request.approvedAuditIds).toEqual([]);
    expect(request.rejectedAuditIds).toEqual([]);
    expect(request.amendments).toEqual([]);
  });
});

describe('planTotal', () => {
  it('multiplies by quantity and says when a line has no price', () => {
    expect(planTotal([{ price: 300, quantity: 1 }, { price: 400, quantity: 2 }])).toEqual({ total: 1100, complete: true });
    expect(planTotal([{ price: 300 }, { price: null }])).toEqual({ total: 300, complete: false });
    expect(planTotal([])).toEqual({ total: 0, complete: true });
  });
});
