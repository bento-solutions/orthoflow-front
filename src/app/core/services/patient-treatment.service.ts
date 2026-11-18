import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { ChartSyncService } from './chart-sync.service';
import { PatientTreatment, PatientTreatmentStatus } from '../models/patient-treatment.model';
import { environment } from '../../../environments/environment';

export interface PatientTreatmentConsumableRequestPayload {
  stockItemId: string;
  quantityUsed: number;
  notes?: string;
}

/**
 * Payload for POST/PUT /patients/{id}/treatments. Uses `treatmentId` and
 * `stockItemId` references rather than nested entities, and deliberately
 * excludes `id`, `patient`, `stockMovementsGenerated` — matches
 * PatientTreatmentRequest on the backend, which intentionally excludes
 * `stockMovementsGenerated` from the write path (see audit V.6).
 */
export interface PatientTreatmentRequestPayload {
  treatmentId: string;
  teeth: string;
  status: PatientTreatmentStatus;
  progress: number;
  notes?: string;
  doctorName?: string;
  startDate?: string;
  endDate?: string;
  consumables?: PatientTreatmentConsumableRequestPayload[];
}

@Injectable({
  providedIn: 'root'
})
export class PatientTreatmentService {
  private http = inject(HttpClient);
  private sync = inject(ChartSyncService);
  private baseUrl = `${environment.apiUrl}/api/v1/patients`;

  getPatientTreatments(patientId: string): Observable<PatientTreatment[]> {
    return this.http.get<PatientTreatment[]>(`${this.baseUrl}/${patientId}/treatments`);
  }

  getAllPatientTreatments(): Observable<PatientTreatment[]> {
    return this.http.get<PatientTreatment[]>(`${this.baseUrl}/treatments`);
  }

  getTreatmentById(patientId: string, id: string): Observable<PatientTreatment> {
    return this.http.get<PatientTreatment>(`${this.baseUrl}/${patientId}/treatments/${id}`);
  }

  createPatientTreatment(patientId: string, pt: PatientTreatmentRequestPayload): Observable<PatientTreatment> {
    return this.http.post<PatientTreatment>(`${this.baseUrl}/${patientId}/treatments`, pt)
      .pipe(tap(() => this.sync.announce(patientId, 'treatments')));
  }

  updatePatientTreatment(patientId: string, id: string, pt: PatientTreatmentRequestPayload): Observable<PatientTreatment> {
    return this.http.put<PatientTreatment>(`${this.baseUrl}/${patientId}/treatments/${id}`, pt)
      .pipe(tap(() => this.sync.announce(patientId, 'treatments')));
  }

  deletePatientTreatment(patientId: string, id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${patientId}/treatments/${id}`)
      .pipe(tap(() => this.sync.announce(patientId, 'treatments')));
  }
}
