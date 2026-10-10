import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from '../api/url';
import type { Req, Wire } from '../api/wire';
import { DownloadService, QueryValue, toParams } from './download.service';

export type Prescription = Wire<'PrescriptionView'>;
export type PrescriptionLine = Wire<'PrescriptionLine'>;
export type PrescriptionInput = Req<'PrescriptionRequest'>;
export type PrescriptionTemplate = Wire<'PrescriptionTemplateView'>;
export type PrescriptionTemplateInput = Req<'PrescriptionTemplateRequest'>;
export type PrescriptionLibraryEntry = Wire<'PrescriptionLibraryEntry'>;
export type AllergyWarning = Wire<'PrescriptionAllergyWarning'>;
export type PrescriptionCategory = PrescriptionTemplate['category'];

export const PRESCRIPTION_CATEGORIES: readonly PrescriptionCategory[] = ['DENTAL', 'ORTHO', 'MUCOSA', 'PAIN', 'OTHER'];

/** Ordonnances, the clinic's templates, and the reference library they are adopted from. */
@Injectable({ providedIn: 'root' })
export class PrescriptionsApi {
  private readonly http = inject(HttpClient);
  private readonly download = inject(DownloadService);

  private get<T>(path: string, query?: Record<string, QueryValue>): Promise<T> {
    return firstValueFrom(this.http.get<T>(api(path), { params: toParams(query) }));
  }

  private post<T>(path: string, body: unknown = {}): Promise<T> {
    return firstValueFrom(this.http.post<T>(api(path), body));
  }

  library(): Promise<PrescriptionLibraryEntry[]> {
    return this.get('/prescriptions/library');
  }
  adopt(code: string): Promise<PrescriptionTemplate> {
    return this.post(`/prescriptions/library/${encodeURIComponent(code)}/adopt`);
  }
  templates(includeInactive = false): Promise<PrescriptionTemplate[]> {
    return this.get('/prescriptions/templates', { includeInactive });
  }
  createTemplate(body: PrescriptionTemplateInput): Promise<PrescriptionTemplate> {
    return this.post('/prescriptions/templates', body);
  }
  updateTemplate(id: string, body: PrescriptionTemplateInput): Promise<PrescriptionTemplate> {
    return firstValueFrom(this.http.put<PrescriptionTemplate>(api(`/prescriptions/templates/${id}`), body));
  }
  reviewTemplate(id: string): Promise<PrescriptionTemplate> {
    return this.post(`/prescriptions/templates/${id}/review`);
  }
  deleteTemplate(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(api(`/prescriptions/templates/${id}`)));
  }
  check(patientId: string, lines: PrescriptionLine[]): Promise<AllergyWarning[]> {
    return this.post('/prescriptions/check', { patientId, lines });
  }
  list(patientId: string): Promise<Prescription[]> {
    return this.get('/prescriptions', { patientId });
  }
  issue(body: PrescriptionInput): Promise<Prescription> {
    return this.post('/prescriptions', body);
  }
  void(id: string): Promise<Prescription> {
    return this.post(`/prescriptions/${id}/void`);
  }
  open(id: string): Promise<void> {
    return this.download.open(`/prescriptions/${id}/file`);
  }
}
