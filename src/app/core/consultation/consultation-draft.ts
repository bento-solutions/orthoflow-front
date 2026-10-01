import {
  CommitConsultationDto,
  CommitPatientChangesDto,
  ConsultationDraftDto,
  DraftActiveTreatment,
  DraftAllergy,
  DraftHistoryEntry,
  DraftNextAppointment,
  DraftPlanItem,
  PatientFieldName,
} from './consultation.model';

/**
 * What the doctor sees and decides on at review — and the rules that keep their
 * decisions safe from the model that proposed the items.
 *
 * ── Why the merge exists ────────────────────────────────────────────────
 *
 * The server re-reads the whole conversation every few seconds and answers with
 * a complete draft each time. That is simple and self-correcting ("non, plutôt
 * le 06…" replaces the earlier number), but it means every answer is a *new*
 * proposal, and the doctor may already have acted on the last one. A draft that
 * could resurrect an allergy they removed, or overwrite a phone number they
 * typed, would make validating pointless. {@link mergeDraft} is what prevents
 * that, and it is the one piece of this feature where a bug is invisible: the
 * screen looks right while quietly undoing a decision.
 *
 * The rule: **a decision is never undone by a later proposal.** Validated,
 * edited and hand-added items stay as they are. A removed item stays removed
 * unless the model now proposes something *different* in its place. Only items
 * nobody has touched follow the model.
 *
 * A *partial* draft — one read from only the end of a long conversation — is
 * not evidence that anything it leaves out was not said: the name and the
 * allergies are usually at the start it could not see. So a partial draft
 * corrects and adds, and never takes away.
 *
 * Everything here is pure, so the rule can be tested without a browser.
 */

export type ReviewStatus = 'proposed' | 'validated' | 'removed';

/** One value the doctor can validate, correct or remove. */
export interface ReviewField<T = string | number> {
  value: T;
  /** The words it was taken from; null for something typed by hand. */
  quote: string | null;
  status: ReviewStatus;
  /** Typed by the doctor, not proposed. */
  manual: boolean;
  /** Changed by the doctor after it was proposed. */
  edited: boolean;
}

export interface ReviewItem<T> {
  key: string;
  data: T;
  quote: string | null;
  status: ReviewStatus;
  manual: boolean;
  edited: boolean;
}

export interface AllergyData { substance: string; reaction: string | null; severity: DraftAllergy['severity'] }
export interface HistoryData { category: DraftHistoryEntry['category']; label: string; detail: string | null }
export interface ActiveTreatmentData { label: string; detail: string | null; type: DraftActiveTreatment['type'] }
export interface PlanData {
  label: string;
  treatmentId: string | null;
  teeth: string | null;
  price: number | null;
  quantity: number;
  notes: string | null;
  /** Where the price came from, for the "catalogue" badge. */
  priceSource: DraftPlanItem['priceSource'];
}

export interface AppointmentChoice {
  /** `YYYY-MM-DD` */
  date: string;
  /** `HH:mm` */
  time: string;
  durationMinutes: number;
  type: string;
  notes: string;
}

export interface ReviewState {
  patient: Partial<Record<PatientFieldName, ReviewField>>;
  chiefComplaint: ReviewField<string> | null;
  allergies: ReviewItem<AllergyData>[];
  medicalHistory: ReviewItem<HistoryData>[];
  activeTreatments: ReviewItem<ActiveTreatmentData>[];
  plan: ReviewItem<PlanData>[];
  /** What the conversation suggested; shown beside the picker, never saved by itself. */
  appointmentSuggestion: DraftNextAppointment | null;
  /** What the doctor set. Null means no appointment is booked. */
  appointment: AppointmentChoice | null;
}

export const PATIENT_FIELDS: readonly PatientFieldName[] = [
  'firstName', 'lastName', 'age', 'dateOfBirth', 'gender', 'phone', 'cin', 'insuranceProvider', 'insuranceNumber',
];

export function emptyReview(): ReviewState {
  return {
    patient: {},
    chiefComplaint: null,
    allergies: [],
    medicalHistory: [],
    activeTreatments: [],
    plan: [],
    appointmentSuggestion: null,
    appointment: null,
  };
}

// ── Merge ───────────────────────────────────────────────────────────────

/** A field nobody has touched follows the model; anything else is the doctor's. */
function isSettled(status: ReviewStatus, manual: boolean, edited: boolean): boolean {
  return manual || edited || status === 'validated';
}

function mergeField<T extends string | number>(
  previous: ReviewField<T> | null | undefined,
  incoming: { value: T; quote: string } | null,
  partial = false,
): ReviewField<T> | null {
  if (previous && isSettled(previous.status, previous.manual, previous.edited)) return previous;

  if (!incoming && partial) return previous ?? null;
  if (!incoming) {
    // The model no longer says it, and nobody had acted on it: it goes.
    // A removal is kept — "removed" is a decision, and forgetting it would let
    // the next draft that says it again bring it back as new.
    return previous?.status === 'removed' ? previous : null;
  }
  if (previous?.status === 'removed') {
    // Said again, the same way: still removed. Said differently: the patient
    // corrected themselves, which is a new proposal.
    if (previous.value === incoming.value) return previous;
  }
  return { value: incoming.value, quote: incoming.quote, status: 'proposed', manual: false, edited: false };
}

function mergeList<TDraft extends { key: string; quote: string }, TData>(
  previous: ReviewItem<TData>[],
  incoming: TDraft[],
  toData: (draft: TDraft) => TData,
  partial = false,
): ReviewItem<TData>[] {
  const next: ReviewItem<TData>[] = [];
  const seen = new Set<string>();

  for (const draft of incoming) {
    seen.add(draft.key);
    const existing = previous.find(item => item.key === draft.key);
    if (!existing) {
      next.push({ key: draft.key, data: toData(draft), quote: draft.quote, status: 'proposed', manual: false, edited: false });
    } else if (isSettled(existing.status, existing.manual, existing.edited) || existing.status === 'removed') {
      next.push(existing);
    } else {
      // Untouched: follow the model, so a correction in the conversation lands.
      next.push({ ...existing, data: toData(draft), quote: draft.quote });
    }
  }

  for (const item of previous) {
    if (seen.has(item.key)) continue;
    // Not in this draft. Anything the doctor acted on, or typed, stays; a
    // proposal nobody touched and the model has dropped goes with it — unless
    // the model only saw part of the conversation.
    if (partial || item.manual || item.edited || item.status === 'validated' || item.status === 'removed') next.push(item);
  }
  return next;
}

/**
 * Folds a new draft into what the doctor has already decided.
 *
 * @param options.partial the draft was read from only the end of the
 *        conversation: it corrects and adds, and drops nothing
 */
export function mergeDraft(
  previous: ReviewState,
  draft: ConsultationDraftDto,
  options: { partial?: boolean } = {},
): ReviewState {
  const partial = options.partial === true;
  const patient: ReviewState['patient'] = {};
  for (const name of PATIENT_FIELDS) {
    const incoming = draft.patient?.[name] ?? null;
    const merged = mergeField<string | number>(previous.patient[name], incoming, partial);
    if (merged) patient[name] = merged;
  }

  return {
    patient,
    chiefComplaint: mergeField<string>(previous.chiefComplaint, draft.chiefComplaint, partial),
    allergies: mergeList(previous.allergies, draft.allergies ?? [], d => ({
      substance: d.substance, reaction: d.reaction, severity: d.severity,
    }), partial),
    medicalHistory: mergeList(previous.medicalHistory, draft.medicalHistory ?? [], d => ({
      category: d.category, label: d.label, detail: d.detail,
    }), partial),
    activeTreatments: mergeList(previous.activeTreatments, draft.activeTreatments ?? [], d => ({
      label: d.label, detail: d.detail, type: d.type,
    }), partial),
    plan: mergeList(previous.plan, draft.treatmentPlan ?? [], d => ({
      label: d.label, treatmentId: d.treatmentId, teeth: d.teeth, price: d.price, quantity: 1,
      notes: d.notes, priceSource: d.priceSource,
    }), partial),
    appointmentSuggestion: draft.nextAppointment ?? (partial ? previous.appointmentSuggestion : null),
    appointment: previous.appointment,
  };
}

// ── Keeping the review across a reload ──────────────────────────────────

/** What is kept on the server so a reload does not undo the doctor's review. */
export interface StoredReview {
  v: 1;
  review: ReviewState;
  report: string;
  /** Chart findings the doctor left out. */
  excluded: string[];
}

export function toStoredReview(review: ReviewState, report: string, excluded: Set<string>): StoredReview {
  return { v: 1, review, report, excluded: [...excluded] };
}

/**
 * The stored review, or null when there is none or it is not one this code
 * wrote — a shape it does not know is ignored rather than trusted, and the
 * panel is rebuilt from the server's draft as before.
 */
export function fromStoredReview(value: unknown): StoredReview | null {
  if (!value || typeof value !== 'object') return null;
  const stored = value as Partial<StoredReview>;
  const review = stored.review as Partial<ReviewState> | undefined;
  if (stored.v !== 1 || !review || typeof review !== 'object') return null;
  const lists = [review.allergies, review.medicalHistory, review.activeTreatments, review.plan];
  if (!lists.every(Array.isArray) || typeof review.patient !== 'object' || review.patient === null) return null;
  return {
    v: 1,
    review: {
      ...emptyReview(),
      ...review,
    } as ReviewState,
    report: typeof stored.report === 'string' ? stored.report : '',
    excluded: Array.isArray(stored.excluded) ? stored.excluded.filter((id): id is string => typeof id === 'string') : [],
  };
}

// ── The doctor's decisions ──────────────────────────────────────────────

export type ListName = 'allergies' | 'medicalHistory' | 'activeTreatments' | 'plan';

export function setPatientField(
  state: ReviewState, name: PatientFieldName, patch: Partial<ReviewField>,
): ReviewState {
  const current = state.patient[name];
  if (!current) return state;
  return { ...state, patient: { ...state.patient, [name]: { ...current, ...patch } } };
}

/** Types a value for a field the model did not propose (or replaces one it did). */
export function enterPatientField(state: ReviewState, name: PatientFieldName, value: string | number): ReviewState {
  return {
    ...state,
    patient: {
      ...state.patient,
      [name]: { value, quote: state.patient[name]?.quote ?? null, status: 'validated', manual: !state.patient[name], edited: !!state.patient[name] },
    },
  };
}

export function setComplaint(state: ReviewState, patch: Partial<ReviewField<string>>): ReviewState {
  if (!state.chiefComplaint) return state;
  return { ...state, chiefComplaint: { ...state.chiefComplaint, ...patch } };
}

export function setItem<K extends ListName>(
  state: ReviewState, list: K, key: string,
  patch: Partial<ReviewItem<ReviewState[K][number]['data']>>,
): ReviewState {
  const items = state[list] as ReviewItem<unknown>[];
  return {
    ...state,
    [list]: items.map(item => (item.key === key ? { ...item, ...patch } : item)),
  };
}

/** The doctor typed a new item. It is theirs, so it needs no validation. */
export function addManualItem<K extends ListName>(
  state: ReviewState, list: K, data: ReviewState[K][number]['data'],
): ReviewState {
  const key = `manual:${list}:${Date.now().toString(36)}:${(state[list] as unknown[]).length}`;
  const item = { key, data, quote: null, status: 'validated' as const, manual: true, edited: false };
  return { ...state, [list]: [...(state[list] as unknown[]), item] };
}

/** Validates everything still waiting. An explicit act: Save is blocked until each item is decided. */
export function validateAll(state: ReviewState): ReviewState {
  const settle = <T>(item: ReviewItem<T>): ReviewItem<T> =>
    item.status === 'proposed' ? { ...item, status: 'validated' } : item;
  const patient: ReviewState['patient'] = {};
  for (const name of PATIENT_FIELDS) {
    const field = state.patient[name];
    if (field) patient[name] = field.status === 'proposed' ? { ...field, status: 'validated' } : field;
  }
  return {
    ...state,
    patient,
    chiefComplaint: state.chiefComplaint?.status === 'proposed'
      ? { ...state.chiefComplaint, status: 'validated' } : state.chiefComplaint,
    allergies: state.allergies.map(settle),
    medicalHistory: state.medicalHistory.map(settle),
    activeTreatments: state.activeTreatments.map(settle),
    plan: state.plan.map(settle),
  };
}

// ── What is waiting for a decision ──────────────────────────────────────

/** What the record already holds, so a proposal that changes nothing needs no review. */
export interface PatientRecord {
  firstName?: string | null;
  lastName?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  phone?: string | null;
  cin?: string | null;
  insuranceProvider?: string | null;
  insuranceNumber?: string | null;
}

function sameText(a: string | null | undefined, b: string | number | null | undefined): boolean {
  return (a ?? '').toString().trim().toLowerCase() === (b ?? '').toString().trim().toLowerCase();
}

/** The age a date of birth makes someone on `today`. */
export function ageOn(dateOfBirth: string, today: Date): number | null {
  const born = new Date(dateOfBirth);
  if (Number.isNaN(born.getTime())) return null;
  let years = today.getFullYear() - born.getFullYear();
  const birthdayPassed = today.getMonth() > born.getMonth()
    || (today.getMonth() === born.getMonth() && today.getDate() >= born.getDate());
  if (!birthdayPassed) years--;
  return years;
}

/**
 * A date of birth for someone only known by age: 1 January of the year that
 * makes them that age. It is an approximation, and the review says so — the
 * record has a date of birth column and no age column, and the dossier header
 * derives the age from it.
 */
export function approximateBirthDate(age: number, today: Date): string {
  return `${today.getFullYear() - age}-01-01`;
}

/** Whether a proposed patient field says something the record does not already say. */
export function changesRecord(name: PatientFieldName, field: ReviewField, record: PatientRecord, today: Date): boolean {
  switch (name) {
    case 'age': {
      if (!record.dateOfBirth) return true;
      const known = ageOn(record.dateOfBirth, today);
      // An age within a year of the one the date of birth gives is the same person, said casually.
      return known === null || Math.abs(known - Number(field.value)) > 1;
    }
    case 'dateOfBirth': return !sameText(record.dateOfBirth, field.value);
    default: return !sameText(record[name as keyof PatientRecord], field.value);
  }
}

/** How many items are still waiting for the doctor to validate, correct or remove them. */
export function pendingCount(state: ReviewState, record: PatientRecord, today: Date): number {
  let pending = 0;
  for (const name of PATIENT_FIELDS) {
    const field = state.patient[name];
    if (field && field.status === 'proposed' && changesRecord(name, field, record, today)) pending++;
  }
  if (state.chiefComplaint?.status === 'proposed') pending++;
  for (const list of [state.allergies, state.medicalHistory, state.activeTreatments, state.plan] as ReviewItem<unknown>[][]) {
    pending += list.filter(item => item.status === 'proposed').length;
  }
  return pending;
}

// ── Saving ──────────────────────────────────────────────────────────────

function text(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed ? trimmed : null;
}

/**
 * The patient fields the doctor validated that differ from the record. Only
 * these are sent: an unchanged field is not a write, and a removed one is not
 * a field at all.
 */
export function patientChanges(state: ReviewState, record: PatientRecord, today: Date): CommitPatientChangesDto | null {
  const changes: CommitPatientChangesDto = {};
  const accepted = (name: PatientFieldName): ReviewField | null => {
    const field = state.patient[name];
    return field && field.status === 'validated' && changesRecord(name, field, record, today) ? field : null;
  };

  for (const name of ['firstName', 'lastName', 'phone', 'cin', 'insuranceProvider', 'insuranceNumber'] as const) {
    const field = accepted(name);
    if (field) changes[name] = String(field.value).trim();
  }
  const gender = accepted('gender');
  if (gender) changes.gender = String(gender.value).toUpperCase();

  // An exact date of birth beats an age; an age alone becomes an approximate one.
  const dob = accepted('dateOfBirth');
  const age = accepted('age');
  if (dob) changes.dateOfBirth = String(dob.value);
  else if (age) changes.dateOfBirth = approximateBirthDate(Number(age.value), today);

  return Object.keys(changes).length ? changes : null;
}

/** What is saved, built only from what the doctor validated. Chart ids are added by the caller. */
export function toCommitRequest(
  state: ReviewState,
  record: PatientRecord,
  today: Date,
  options: { report: string | null; appointment: { dateTime: string; chairId?: string | null } | null },
): CommitConsultationDto {
  const kept = <T>(items: ReviewItem<T>[]): T[] => items.filter(item => item.status === 'validated').map(item => item.data);

  return {
    patient: patientChanges(state, record, today),
    allergies: kept(state.allergies).map(a => ({
      substance: a.substance.trim(), reaction: text(a.reaction), severity: a.severity,
    })),
    medicalHistory: kept(state.medicalHistory).map(h => ({
      category: h.category, label: h.label.trim(), detail: text(h.detail),
    })),
    activeTreatments: kept(state.activeTreatments).map(t => ({
      label: t.label.trim(), detail: text(t.detail), type: t.type,
    })),
    chiefComplaint: state.chiefComplaint?.status === 'validated' ? text(state.chiefComplaint.value) : null,
    treatmentPlan: kept(state.plan).map(p => ({
      label: p.label.trim(),
      treatmentId: p.treatmentId,
      teeth: text(p.teeth),
      price: p.price,
      quantity: Math.max(1, Math.floor(p.quantity || 1)),
      notes: text(p.notes),
    })),
    nextAppointment: state.appointment && options.appointment
      ? {
        dateTime: options.appointment.dateTime,
        durationMinutes: state.appointment.durationMinutes,
        type: text(state.appointment.type),
        chairId: options.appointment.chairId ?? null,
        notes: text(state.appointment.notes),
      }
      : null,
    report: text(options.report),
    approvedAuditIds: [],
    rejectedAuditIds: [],
    amendments: [],
  };
}

/** Total of a plan: price × quantity for every priced line, and whether any line had no price. */
export function planTotal(lines: Array<{ price?: number | null; quantity?: number | null }>): { total: number; complete: boolean } {
  let total = 0;
  let complete = true;
  for (const line of lines) {
    if (line.price === null || line.price === undefined) {
      complete = false;
      continue;
    }
    total += line.price * Math.max(1, line.quantity ?? 1);
  }
  return { total, complete };
}
