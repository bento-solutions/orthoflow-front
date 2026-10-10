import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, finalize } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  PatientClinicalRecord, ToothFinding, ClinicalNote, PatientAllergy, MedicalHistoryEntry,
  AddToothFindingRequest, CreateClinicalNoteRequest, AddAllergyRequest, AddMedicalHistoryRequest,
  FindingStatus, FindingCatalogResponse, PeriodontalStatus, RecordPeriodontalRequest, PeriodontalAssessment
} from '../models/clinical-record.model';

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

  refresh(patientId: string): void {
    this.loadingSignal.set(true);
    this.http.get<PatientClinicalRecord>(`${this.baseUrl}/${patientId}/clinical-record`)
      .pipe(finalize(() => this.loadingSignal.set(false)))
      .subscribe({
        next: (record) => this.recordSignal.set(record),
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
    ).pipe(tap(() => this.loadPeriodontal(patientId)));
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
      .pipe(tap(() => { this.refresh(patientId); this.refreshHistoryIfLoaded(patientId); }));
  }

  changeFindingStatus(patientId: string, findingId: string, status: FindingStatus): Observable<ToothFinding> {
    return this.http.patch<ToothFinding>(
      `${this.baseUrl}/${patientId}/clinical-record/findings/${findingId}?status=${status}`, {}
    ).pipe(tap(() => { this.refresh(patientId); this.refreshHistoryIfLoaded(patientId); }));
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
