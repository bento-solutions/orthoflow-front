import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, finalize } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  PatientClinicalRecord, ToothFinding, ClinicalNote, PatientAllergy, MedicalHistoryEntry,
  AddToothFindingRequest, CreateClinicalNoteRequest, AddAllergyRequest, AddMedicalHistoryRequest,
  FindingStatus, FindingCatalogResponse, PeriodontalStatus, RecordPeriodontalRequest, PeriodontalAssessment
} from '../models/clinical-record.model';
import { ChartSyncService } from './chart-sync.service';

/** One thing to know before treating: an allergy, a condition or a current medication. */
export interface MedicalAlert {
  id: string;
  kind: 'ALLERGY' | 'CONDITION' | 'MEDICATION';
  label: string;
  detail: string | null;
  /** Allergies are critical (red); conditions and medications call for attention (amber). */
  tone: 'critical' | 'attention';
  /** An allergy's own severity, when it was recorded. */
  severity: string | null;
}

/**
 * Whether the patient was asked: there are alerts; they were asked and have none
 * (a MEDICAL_HISTORY note says so); or nobody has asked yet.
 */
export type AlertsState = 'alerts' | 'none' | 'not-asked' | 'loading';

/** The note "nothing to report" is filed under, so an empty list can say it was asked. */
export const NOTHING_TO_REPORT_CATEGORY = 'MEDICAL_HISTORY' as const;

/**
 * The one list of medical alerts, everywhere the patient is shown: allergies first, then
 * conditions and current medications. The banner, the summary, the medical history panel and
 * the cockpit all read this, so the three facts can no longer live in three places (P0-2).
 */
export function medicalAlerts(record: PatientClinicalRecord | null): MedicalAlert[] {
  if (!record) return [];
  const allergies: MedicalAlert[] = (record.allergies ?? []).map(a => ({
    id: a.id ?? a.substance ?? '',
    kind: 'ALLERGY' as const,
    label: a.substance ?? '',
    detail: a.reaction?.trim() || null,
    tone: 'critical' as const,
    severity: a.severity ?? null,
  }));
  const rank = { CONDITION: 0, MEDICATION: 1 } as const;
  const history: MedicalAlert[] = (record.medicalHistory ?? [])
    .filter((h): h is typeof h & { category: 'CONDITION' | 'MEDICATION' } => h.category === 'CONDITION' || h.category === 'MEDICATION')
    .sort((a, b) => rank[a.category] - rank[b.category])
    .map(h => ({
      id: h.id ?? h.label ?? '',
      kind: h.category,
      label: h.label ?? '',
      detail: h.detail?.trim() || null,
      tone: 'attention' as const,
      severity: null,
    }));
  return [...allergies, ...history].filter(a => a.label.trim());
}

/** See AlertsState. Any allergy or history entry at all means the questions were asked. */
export function alertsState(record: PatientClinicalRecord | null): AlertsState {
  if (!record) return 'loading';
  if (medicalAlerts(record).length) return 'alerts';
  const asked = (record.allergies ?? []).length > 0 || (record.medicalHistory ?? []).length > 0
    || (record.notes ?? []).some(n => n.category === NOTHING_TO_REPORT_CATEGORY && !n.sessionId);
  return asked ? 'none' : 'not-asked';
}

/**
 * The structured clinical record — findings, notes, allergies, medical
 * history — behind `/patients/{id}/clinical-record`. Signal-based state
 * following this codebase's established service pattern (see
 * PatientTreatmentService/InvoiceService): one refresh() populates every
 * section in a single round trip via the backend's aggregate endpoint,
 * since the dossier's Clinical tab renders several of these at once.
 */
@Injectable({
  providedIn: 'root'
})
export class ClinicalRecordService {
  private http = inject(HttpClient);
  private sync = inject(ChartSyncService);
  private baseUrl = `${environment.apiUrl}/api/v1/patients`;

  private recordSignal = signal<PatientClinicalRecord | null>(null);
  private loadingSignal = signal(false);
  private catalogSignal = signal<FindingCatalogResponse | null>(null);
  private historySignal = signal<ToothFinding[]>([]);
  private periodontalSignal = signal<PeriodontalStatus | null>(null);

  record = this.recordSignal.asReadonly();
  loading = this.loadingSignal.asReadonly();
  catalog = this.catalogSignal.asReadonly();
  /** Active and resolved findings, newest first: the treatment log. Empty until loadHistory(). */
  history = this.historySignal.asReadonly();
  /** Gum state today and how it got there. Null until loadPeriodontal(). */
  periodontal = this.periodontalSignal.asReadonly();

  findings = () => this.recordSignal()?.findings ?? [];
  notes = () => this.recordSignal()?.notes ?? [];
  allergies = () => this.recordSignal()?.allergies ?? [];
  medicalHistory = () => this.recordSignal()?.medicalHistory ?? [];
  /** Allergies, conditions and current medications, in that order: the one alert source. */
  readonly medicalAlerts = computed(() => medicalAlerts(this.recordSignal()));
  readonly alertsState = computed(() => alertsState(this.recordSignal()));

  /** Whose record is held (or being fetched). */
  private recordFor: string | null = null;
  /** The patient whose record `record()` is, once it has arrived. */
  readonly recordPatientId = signal<string | null>(null);

  refresh(patientId: string): void {
    // Another patient's allergies must never show under this one's name while the request runs.
    if (this.recordFor !== patientId) {
      this.recordSignal.set(null);
      this.recordPatientId.set(null);
    }
    this.recordFor = patientId;
    this.loadingSignal.set(true);
    this.http.get<PatientClinicalRecord>(`${this.baseUrl}/${patientId}/clinical-record`)
      .pipe(finalize(() => this.loadingSignal.set(false)))
      .subscribe({
        next: (record) => {
          if (this.recordFor !== patientId) return;
          this.recordSignal.set(record);
          this.recordPatientId.set(patientId);
        },
        error: (err) => console.error('Failed to load clinical record', err),
      });
  }

  loadHistory(patientId: string): void {
    this.http.get<ToothFinding[]>(`${this.baseUrl}/${patientId}/clinical-record/findings/history`)
      .subscribe({
        next: (history) => this.historySignal.set(history),
        error: (err) => console.error('Failed to load treatment history', err),
      });
  }

  loadPeriodontal(patientId: string): void {
    this.http.get<PeriodontalStatus>(`${this.baseUrl}/${patientId}/clinical-record/periodontal`)
      .subscribe({
        next: (status) => this.periodontalSignal.set(status),
        error: (err) => console.error('Failed to load gum status', err),
      });
  }

  recordPeriodontal(patientId: string, request: RecordPeriodontalRequest): Observable<PeriodontalAssessment> {
    return this.http.post<PeriodontalAssessment>(
      `${this.baseUrl}/${patientId}/clinical-record/periodontal`, request
    ).pipe(tap(() => { this.loadPeriodontal(patientId); this.sync.announce(patientId, 'gums'); }));
  }

  loadCatalogOnce(): void {
    if (this.catalogSignal()) return;
    this.http.get<FindingCatalogResponse>(`${environment.apiUrl}/api/v1/clinical/finding-catalog`)
      .subscribe({
        next: (catalog) => this.catalogSignal.set(catalog),
        error: (err) => console.error('Failed to load finding catalog', err),
      });
  }

  /**
   * The findings currently on one tooth, read straight from the server.
   *
   * Distinct from filtering the `findings()` signal: the voice pipeline needs
   * the tooth's state *before* it writes, so that Undo withdraws only what
   * that command introduced and never something the tooth already carried —
   * and it cannot assume the aggregate record has been loaded yet.
   */
  listToothFindings(patientId: string, fdi: string): Observable<ToothFinding[]> {
    return this.http.get<ToothFinding[]>(
      `${this.baseUrl}/${patientId}/clinical-record/teeth/${fdi}/findings`);
  }

  addFinding(patientId: string, fdi: string, request: AddToothFindingRequest): Observable<ToothFinding> {
    return this.http.post<ToothFinding>(`${this.baseUrl}/${patientId}/clinical-record/teeth/${fdi}/findings`, request)
      .pipe(tap(() => { this.refresh(patientId); this.refreshHistoryIfLoaded(patientId); this.sync.announce(patientId, 'findings'); }));
  }

  changeFindingStatus(patientId: string, findingId: string, status: FindingStatus): Observable<ToothFinding> {
    return this.http.patch<ToothFinding>(
      `${this.baseUrl}/${patientId}/clinical-record/findings/${findingId}?status=${status}`, {}
    ).pipe(tap(() => { this.refresh(patientId); this.refreshHistoryIfLoaded(patientId); this.sync.announce(patientId, 'findings'); }));
  }

  /** The log is only kept in step once something has asked for it. */
  private refreshHistoryIfLoaded(patientId: string): void {
    if (this.historySignal().length) this.loadHistory(patientId);
  }

  addNote(patientId: string, request: CreateClinicalNoteRequest): Observable<ClinicalNote> {
    return this.http.post<ClinicalNote>(`${this.baseUrl}/${patientId}/clinical-record/notes`, request)
      .pipe(tap(() => this.refresh(patientId)));
  }

  deleteNote(patientId: string, noteId: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${patientId}/clinical-record/notes/${noteId}`)
      .pipe(tap(() => this.refresh(patientId)));
  }

  addAllergy(patientId: string, request: AddAllergyRequest): Observable<PatientAllergy> {
    return this.http.post<PatientAllergy>(`${this.baseUrl}/${patientId}/clinical-record/allergies`, request)
      .pipe(tap(() => this.refresh(patientId)));
  }

  deleteAllergy(patientId: string, allergyId: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${patientId}/clinical-record/allergies/${allergyId}`)
      .pipe(tap(() => this.refresh(patientId)));
  }

  addMedicalHistory(patientId: string, request: AddMedicalHistoryRequest): Observable<MedicalHistoryEntry> {
    return this.http.post<MedicalHistoryEntry>(`${this.baseUrl}/${patientId}/clinical-record/medical-history`, request)
      .pipe(tap(() => this.refresh(patientId)));
  }

  deleteMedicalHistory(patientId: string, entryId: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${patientId}/clinical-record/medical-history/${entryId}`)
      .pipe(tap(() => this.refresh(patientId)));
  }
}
