import { Injectable, signal, computed, inject } from '@angular/core';
import { Patient } from '../models/patient.model';
import { PatientApiService } from './patient-api.service';
import { finalize, tap, of, Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class PatientService {
  private api = inject(PatientApiService);
  
  // Signals for state management
  private patientsSignal = signal<Patient[]>([]);
  private currentPatientSignal = signal<Patient | null>(null);
  private loadingSignal = signal<boolean>(false);
  private errorSignal = signal<string | null>(null);

  // Public selectors
  patients = computed(() => this.patientsSignal());
  currentPatient = computed(() => this.currentPatientSignal());
  loading = computed(() => this.loadingSignal());
  error = computed(() => this.errorSignal());

  /**
   * Display names by patient id.
   *
   * Several endpoints return a bare `patientId` and no name — `InvoiceResponse`
   * is the one that caused trouble, because the invoice list and the invoice
   * PDF both rendered a `patientName` field that the server has never sent.
   * Resolving the name here keeps that join in one place and makes it obvious
   * that it *is* a join, rather than a field somebody assumed was on the wire.
   *
   * The better long-term fix is server-side: `scheduling` and `stock` already
   * enrich their responses with `PatientSummary` through the `PatientLookup`
   * port, and `billing` should do the same. Until then this covers it without
   * an extra request, since the patient list is already loaded.
   */
  private patientNames = computed(() => {
    const byId = new Map<string, string>();
    for (const p of this.patientsSignal()) {
      byId.set(p.id, `${p.firstName} ${p.lastName}`.trim());
    }
    return byId;
  });

  /** Display name for `patientId`, or `undefined` if not loaded yet. */
  nameFor(patientId: string | undefined): string | undefined {
    return patientId ? this.patientNames().get(patientId) : undefined;
  }

  constructor() {
    this.refreshPatients();
  }

  refreshPatients(): void {
    this.loadingSignal.set(true);
    this.errorSignal.set(null);
    this.api.getPatients()
      .pipe(finalize(() => this.loadingSignal.set(false)))
      .subscribe({
        next: (patients) => this.patientsSignal.set(patients),
        error: (err) => {
          console.error('Failed to load patients', err);
          this.errorSignal.set('Failed to load patients.');
        }
      });
  }

  /**
   * Resolves the patient for `id` and sets it as current, returning an
   * Observable so callers can drive dependent loads (chart, billing,
   * treatments) off the *resolved* patient rather than reading the
   * `currentPatient` signal synchronously right after calling this — reading
   * it synchronously raced ahead of the HTTP fetch and could load one
   * patient's clinical data under another patient's identity.
   */
  setCurrentPatient(id: string): Observable<Patient> {
    const cached = this.patientsSignal().find(p => p.id === id);
    const source = cached ? of(cached) : this.api.getPatient(id);

    this.loadingSignal.set(true);
    this.errorSignal.set(null);
    return source.pipe(
      tap({
        next: (patient) => this.currentPatientSignal.set(patient),
        error: () => {
          this.currentPatientSignal.set(null);
          this.errorSignal.set('Failed to load patient.');
        }
      }),
      finalize(() => this.loadingSignal.set(false))
    );
  }

  /**
   * Re-reads one patient from the server and updates both the list and, if it is
   * the open one, the current patient. For after something other than the edit
   * form changed them — a consultation that learned a phone number — since
   * {@link setCurrentPatient} prefers the cached copy.
   */
  reload(id: string): Observable<Patient> {
    return this.api.getPatient(id).pipe(
      tap(fresh => {
        this.patientsSignal.update(patients => patients.map(p => (p.id === id ? fresh : p)));
        if (this.currentPatientSignal()?.id === id) this.currentPatientSignal.set(fresh);
      })
    );
  }

  addPatient(patient: Partial<Patient>): Observable<Patient> {
    this.loadingSignal.set(true);
    return this.api.createPatient(patient).pipe(
      tap(newPatient => {
        this.patientsSignal.update(patients => [...patients, newPatient]);
      }),
      finalize(() => this.loadingSignal.set(false))
    );
  }

  updatePatient(id: string, patient: Partial<Patient>): Observable<Patient> {
    this.loadingSignal.set(true);
    return this.api.updatePatient(id, patient).pipe(
      tap(updated => {
        this.patientsSignal.update(patients => 
          patients.map(p => p.id === id ? updated : p)
        );
        if (this.currentPatientSignal()?.id === id) {
          this.currentPatientSignal.set(updated);
        }
      }),
      finalize(() => this.loadingSignal.set(false))
    );
  }

  deletePatient(id: string): Observable<void> {
    this.loadingSignal.set(true);
    return this.api.deletePatient(id).pipe(
      tap(() => {
        this.patientsSignal.update(patients => patients.filter(p => p.id !== id));
        if (this.currentPatientSignal()?.id === id) {
          this.currentPatientSignal.set(null);
        }
      }),
      finalize(() => this.loadingSignal.set(false))
    );
  }
}
