import { describe, expect, it } from 'vitest';
import {
  emptyReview, fromStoredReview, invoiceableLines, mergeDraft, paymentKey, pendingCount, ReviewItem, ReviewState, PlanData,
  toCommitRequest, toStoredReview, validateAll,
} from './consultation-draft';
import { ConsultationDraftDto } from './consultation.model';

const TODAY = new Date('2026-11-13T10:00:00');

function draft(overrides: Partial<ConsultationDraftDto> = {}): ConsultationDraftDto {
  return {
    patient: {
      firstName: null, lastName: null, age: null, dateOfBirth: null, gender: null,
      phone: null, cin: null, insuranceProvider: null, insuranceNumber: null,
    },
    chiefComplaint: null, activeTreatments: [], allergies: [], medicalHistory: [], treatmentPlan: [],
    nextAppointment: null, source: 'groq:test', ...overrides,
  };
}

const SCALING = {
  key: 'plan:detartrage:', label: 'Détartrage', treatmentId: 't-1', treatmentCode: 'DETART', teeth: null,
  price: 300, priceSource: 'SPOKEN' as const, notes: null, quote: 'je vous fais le détartrage maintenant', performed: true,
};
const CROWN = { ...SCALING, key: 'plan:couronne:16', label: 'Couronne', teeth: '16', price: 3500, performed: false, quote: 'il faudra une couronne' };
const CASH = { key: 'payment:300:CASH', amount: 300, method: 'CASH' as const, quote: 'je vous règle 300 dirhams en espèces' };
const UNKNOWN_METHOD = { key: 'payment:200:', amount: 200, method: null, quote: 'voilà 200' };

const commit = (state: ReviewState) => toCommitRequest(state, {}, TODAY, { report: null, appointment: null });

describe('the patient\'s account at review', () => {
  it('reads a payment said in the conversation as a proposal, keyed as the server keys it', () => {
    const state = mergeDraft(emptyReview(), draft({ payments: [CASH] }));
    expect(state.payments).toHaveLength(1);
    expect(state.payments[0]).toMatchObject({ key: 'payment:300:CASH', status: 'proposed', data: { amount: 300, method: 'CASH' } });
    expect(paymentKey(300, 'CASH')).toBe(CASH.key);
    expect(paymentKey(250.5, null)).toBe('payment:250.5:');
  });

  it('counts a proposed payment as undecided, and sends only a validated one, with its method', () => {
    let state = mergeDraft(emptyReview(), draft({ payments: [CASH] }));
    expect(pendingCount(state, {}, TODAY)).toBe(1);
    expect(commit(state).payments).toEqual([]);

    state = { ...state, payments: state.payments.map(p => ({ ...p, status: 'validated' as const })) };
    expect(pendingCount(state, {}, TODAY)).toBe(0);
    expect(commit(state).payments).toEqual([{ amount: 300, method: 'CASH', reference: null }]);
  });

  it('does not validate a payment whose method was not said: a receipt needs one', () => {
    const state = validateAll(mergeDraft(emptyReview(), draft({ payments: [CASH, UNKNOWN_METHOD] })));
    expect(state.payments.map(p => p.status)).toEqual(['validated', 'proposed']);
    expect(pendingCount(state, {}, TODAY)).toBe(1);
  });

  it('marks an act done today as performed when the reading says so', () => {
    const state = mergeDraft(emptyReview(), draft({ treatmentPlan: [SCALING, CROWN] }));
    expect(state.plan.map(p => [p.data.label, p.data.performed])).toEqual([['Détartrage', true], ['Couronne', false]]);
  });

  it('asks whether to invoice the acts done today with a price, and never invoices without being told', () => {
    let state = mergeDraft(emptyReview(), draft({ treatmentPlan: [SCALING, CROWN] }));
    expect(invoiceableLines(state).map(p => p.data.label)).toEqual(['Détartrage']);
    state = { ...state, plan: state.plan.map(p => ({ ...p, status: 'validated' as const })) };
    // Both plan lines are decided; the invoice is not.
    expect(pendingCount(state, {}, TODAY)).toBe(1);
    expect(commit(state).createInvoice).toBe(false);

    expect(commit({ ...state, invoiceDecision: 'create' }).createInvoice).toBe(true);
    expect(pendingCount({ ...state, invoiceDecision: 'skip' }, {}, TODAY)).toBe(0);
    expect(commit({ ...state, invoiceDecision: 'skip' }).createInvoice).toBe(false);
  });

  it('"validate all" decides to invoice when there is something to invoice, and only then', () => {
    expect(validateAll(mergeDraft(emptyReview(), draft({ treatmentPlan: [SCALING] }))).invoiceDecision).toBe('create');
    expect(validateAll(mergeDraft(emptyReview(), draft({ treatmentPlan: [CROWN] }))).invoiceDecision).toBeNull();
  });

  it('a removed act is not invoiced, nor an unpriced one', () => {
    const state = mergeDraft(emptyReview(), draft({ treatmentPlan: [SCALING, { ...SCALING, key: 'plan:conseils:', label: 'Conseils', price: null }] }));
    const removed = { ...state, plan: state.plan.map(p => p.data.label === 'Détartrage' ? { ...p, status: 'removed' as const } : p) };
    expect(invoiceableLines(removed)).toEqual([]);
  });

  it('a review kept before payments existed comes back without them', () => {
    const old = { v: 1, review: { ...emptyReview(), payments: undefined, invoiceDecision: undefined }, report: '', excluded: [] };
    const restored = fromStoredReview(JSON.parse(JSON.stringify(old)));
    expect(restored?.review.payments).toEqual([]);
    expect(restored?.review.invoiceDecision).toBeNull();
    const roundTrip = fromStoredReview(JSON.parse(JSON.stringify(toStoredReview({ ...emptyReview(), invoiceDecision: 'skip' }, '', new Set()))));
    expect(roundTrip?.review.invoiceDecision).toBe('skip');
  });
});

describe('what the doctor dictated, waiting to be validated', () => {
  const dictated = <T>(item: Omit<ReviewItem<T>, 'status' | 'manual' | 'edited' | 'dictated'>): ReviewItem<T> =>
    ({ ...item, status: 'proposed', manual: false, edited: false, dictated: true });

  it('is not taken away by a reading that does not mention it', () => {
    const state: ReviewState = {
      ...emptyReview(),
      allergies: [dictated({ key: 'allergy:penicilline', data: { substance: 'pénicilline', reaction: null, severity: null }, quote: 'Calypso, allergie à la pénicilline' })],
    };
    expect(mergeDraft(state, draft()).allergies).toHaveLength(1);
  });

  it('is not rewritten by the reading of the same thing', () => {
    const plan: ReviewItem<PlanData> = dictated({
      key: 'plan:detartrage:', quote: 'Calypso, plan : détartrage, 300 dirhams',
      data: { label: 'Détartrage', treatmentId: null, teeth: null, price: 300, quantity: 1, notes: null, priceSource: 'SPOKEN' },
    });
    const merged = mergeDraft({ ...emptyReview(), plan: [plan] }, draft({ treatmentPlan: [{ ...SCALING, price: 250, priceSource: 'CATALOG' }] }));
    expect(merged.plan).toHaveLength(1);
    expect(merged.plan[0].data.price).toBe(300);
    expect(merged.plan[0].status).toBe('proposed');
  });

  it('a dictated patient detail is kept over the reading', () => {
    const state: ReviewState = {
      ...emptyReview(),
      patient: { phone: { value: '0612345678', quote: 'Calypso, téléphone 06 12 34 56 78', status: 'proposed', manual: false, edited: false, dictated: true } },
    };
    const merged = mergeDraft(state, draft({ patient: { ...draft().patient, phone: { value: '0699999999', quote: 'x' } } }));
    expect(merged.patient.phone?.value).toBe('0612345678');
  });
});
