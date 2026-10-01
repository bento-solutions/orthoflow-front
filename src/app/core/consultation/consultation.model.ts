/**
 * Wire types for full-consultation recording.
 *
 * Hand-written, like `voice-api.service.ts`: these endpoints post-date the
 * generated `api-types.d.ts`, and the contract file's rule ("never hand-write a
 * field name") applies to types that already exist there. When the OpenAPI
 * document is next regenerated, these can be derived instead.
 */

export type ConsultationStatus = 'INTAKE' | 'EXAMINATION' | 'REVIEW' | 'COMPLETED' | 'ABANDONED';

/** A value and the words it was taken from. */
export interface Quoted<T> {
  value: T;
  quote: string;
}

export interface DraftPatientFields {
  firstName: Quoted<string> | null;
  lastName: Quoted<string> | null;
  age: Quoted<number> | null;
  dateOfBirth: Quoted<string> | null;
  gender: Quoted<string> | null;
  phone: Quoted<string> | null;
  cin: Quoted<string> | null;
  insuranceProvider: Quoted<string> | null;
  insuranceNumber: Quoted<string> | null;
}

export type PatientFieldName = keyof DraftPatientFields;

export type ActiveTreatmentType = 'MEDICATION' | 'DENTAL' | 'OTHER';
export type HistoryCategory =
  | 'CONDITION' | 'MEDICATION' | 'SURGERY' | 'DENTAL_HISTORY' | 'FAMILY' | 'LIFESTYLE' | 'OTHER';
export type AllergySeverity = 'MILD' | 'MODERATE' | 'SEVERE';

export interface DraftActiveTreatment {
  key: string;
  label: string;
  detail: string | null;
  type: ActiveTreatmentType;
  quote: string;
}

export interface DraftAllergy {
  key: string;
  substance: string;
  reaction: string | null;
  severity: AllergySeverity | null;
  quote: string;
}

export interface DraftHistoryEntry {
  key: string;
  category: HistoryCategory;
  label: string;
  detail: string | null;
  quote: string;
}

export interface DraftPlanItem {
  key: string;
  label: string;
  treatmentId: string | null;
  treatmentCode: string | null;
  teeth: string | null;
  price: number | null;
  priceSource: 'SPOKEN' | 'CATALOG' | null;
  notes: string | null;
  quote: string;
}

export interface DraftNextAppointment {
  date: string | null;
  time: string | null;
  inDays: number | null;
  reason: string | null;
  quote: string;
}

/** What the system believes the conversation established — a proposal, never the record. */
export interface ConsultationDraftDto {
  patient: DraftPatientFields;
  chiefComplaint: Quoted<string> | null;
  activeTreatments: DraftActiveTreatment[];
  allergies: DraftAllergy[];
  medicalHistory: DraftHistoryEntry[];
  treatmentPlan: DraftPlanItem[];
  nextAppointment: DraftNextAppointment | null;
  /** `rules`, or `vendor:model` when a model read the conversation. */
  source: string;
}

export interface ExtractionResponseDto {
  draft: ConsultationDraftDto;
  /** `extraction-disabled` / `extraction-failed` when only the rule-based reading is here. */
  error: string | null;
  truncated: boolean;
}

export interface ConsultationConfigDto {
  enabled: boolean;
  modelExtraction: boolean;
  /** The raw conversation is kept in the patient's file once saved (testing deployments only). */
  retainTranscript: boolean;
}

export interface ConsultationDto {
  id: string;
  patientId: string;
  actorId: string;
  voiceSessionId: string | null;
  status: ConsultationStatus;
  locale: string | null;
  patientInformedAt: string;
  /** Null in a list. */
  transcript: string | null;
  draft: ConsultationDraftDto | null;
  /** The doctor's decisions on the panel so far (see `StoredReview`); null in a list and once saved. */
  reviewState?: unknown | null;
  /** What the doctor signed off — present once saved. */
  reviewed: CommitConsultationDto | null;
  report: string | null;
  appointmentId: string | null;
  startedAt: string;
  examinationStartedAt: string | null;
  endedAt: string | null;
  completedAt: string | null;
}

// ── Saving ──────────────────────────────────────────────────────────────

export interface CommitPatientChangesDto {
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  gender?: string;
  phone?: string;
  cin?: string;
  insuranceProvider?: string;
  insuranceNumber?: string;
}

export interface CommitAllergyDto {
  substance: string;
  reaction?: string | null;
  severity?: AllergySeverity | null;
}

export interface CommitHistoryDto {
  category: HistoryCategory;
  label: string;
  detail?: string | null;
}

export interface CommitActiveTreatmentDto {
  label: string;
  detail?: string | null;
  type: ActiveTreatmentType;
}

export interface CommitPlanLineDto {
  label: string;
  treatmentId?: string | null;
  teeth?: string | null;
  price?: number | null;
  quantity: number;
  notes?: string | null;
}

export interface CommitAppointmentDto {
  dateTime: string;
  durationMinutes?: number | null;
  type?: string | null;
  chairId?: string | null;
  notes?: string | null;
}

export interface CommitAmendmentDto {
  originalAuditId: string;
  intent: string;
  entities: string;
}

export interface CommitConsultationDto {
  patient?: CommitPatientChangesDto | null;
  allergies: CommitAllergyDto[];
  medicalHistory: CommitHistoryDto[];
  activeTreatments: CommitActiveTreatmentDto[];
  chiefComplaint?: string | null;
  treatmentPlan: CommitPlanLineDto[];
  nextAppointment?: CommitAppointmentDto | null;
  report?: string | null;
  approvedAuditIds: string[];
  rejectedAuditIds: string[];
  amendments: CommitAmendmentDto[];
}

export interface CommitConsultationResultDto {
  consultation: ConsultationDto;
  /** False when a chart finding failed to write: nothing else was written either. */
  saved: boolean;
  executed: number;
  rejected: number;
  amended: number;
  notReviewed: number;
  failed: { auditId: string; intent: string; errorMessage: string }[];
  appointmentId: string | null;
}
