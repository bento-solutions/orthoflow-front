/**
 * Clinical record types.
 *
 * Response and request shapes are re-exported from `core/api/contract`, which
 * derives them from the OpenAPI document — see that file for why these are no
 * longer hand-written. The field names checked out exactly against the server
 * when they were migrated; the risk this removes is the *next* rename, not a
 * drift that already existed.
 *
 * The unions below are a different matter. `kind`, `status`, `severity` and
 * `category` are plain `String` on the server's DTOs, so the generator emits
 * `string` and cannot narrow them. They are declared here as client-side
 * refinements layered onto the contract types with `Omit`, which keeps the
 * assumption anchored to a real field: the response types themselves still come
 * from the generated schema, so a rename elsewhere in them breaks the build.
 *
 * Making the Java DTOs carry the enums (they already exist as
 * `com.orthoflow.clinical.domain.model.FindingStatus` and friends) would let
 * springdoc emit the values and make these declarations deletable.
 */
import type {
  ToothFinding as ApiToothFinding,
  ClinicalNote as ApiClinicalNote,
  PatientAllergy as ApiPatientAllergy,
  MedicalHistoryEntry as ApiMedicalHistoryEntry,
  PatientClinicalRecord as ApiPatientClinicalRecord,
} from '../api/contract';

export type FindingKind = 'EXISTING' | 'CONDITION' | 'TREATMENT_REQUIRED' | 'OBSERVATION';
export type FindingStatus = 'ACTIVE' | 'RESOLVED' | 'RETRACTED';
export type Severity = 'MILD' | 'MODERATE' | 'SEVERE';
export type NoteCategory =
  | 'GENERAL' | 'CHIEF_COMPLAINT' | 'OBSERVATION' | 'DENTAL_HISTORY'
  | 'MEDICAL_HISTORY' | 'DIAGNOSIS' | 'FOLLOW_UP' | 'TREATMENT_PLAN'
  // Written by saving a dictated examination or a recorded consultation,
  // never entered by hand.
  | 'CONSULTATION_REPORT' | 'CONSULTATION_TRANSCRIPT';
export type MedicalHistoryCategory =
  | 'CONDITION' | 'MEDICATION' | 'SURGERY' | 'DENTAL_HISTORY' | 'FAMILY' | 'LIFESTYLE' | 'OTHER';

export type ToothFinding =
  Omit<ApiToothFinding, 'kind' | 'status' | 'severity'>
  & { kind: FindingKind; status: FindingStatus; severity?: Severity };

export type ClinicalNote =
  Omit<ApiClinicalNote, 'category'> & { category: NoteCategory };

export type PatientAllergy =
  Omit<ApiPatientAllergy, 'severity'> & { severity?: Severity };

export type MedicalHistoryEntry =
  Omit<ApiMedicalHistoryEntry, 'category'> & { category: MedicalHistoryCategory };

export interface PatientClinicalRecord extends ApiPatientClinicalRecord {
  findings: ToothFinding[];
  notes: ClinicalNote[];
  allergies: PatientAllergy[];
  medicalHistory: MedicalHistoryEntry[];
}

// ── Request payloads ────────────────────────────────────────────────────
//
// Narrowed the same way: the server accepts these as strings, but the UI only
// ever produces values from the unions above.

export interface AddToothFindingRequest {
  findingCode: string;
  surface?: string;
  severity?: Severity;
  note?: string;
  source: string;
  sessionId?: string;
}

export interface CreateClinicalNoteRequest {
  category: NoteCategory;
  content: string;
  fdi?: string;
  source: string;
  sessionId?: string;
}

export interface AddAllergyRequest {
  substance: string;
  reaction?: string;
  severity?: Severity;
  source: string;
  sessionId?: string;
}

export interface AddMedicalHistoryRequest {
  category: MedicalHistoryCategory;
  label: string;
  detail?: string;
  source: string;
  sessionId?: string;
}

// ── Finding catalog ─────────────────────────────────────────────────────
//
// `FindingCatalogController` returns an inline shape that springdoc does not
// emit as a named schema, so there is nothing in the contract to derive from.
// Kept hand-written, and flagged as such.

export interface FindingDefinition {
  code: string;
  kind: FindingKind;
  impliedStatus: string;
  statusPriority: number;
}

export interface FindingCatalogResponse {
  codes: string[];
  definitions: FindingDefinition[];
}
