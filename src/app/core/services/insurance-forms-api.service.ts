import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from '../api/url';
import type { Req, Wire } from '../api/wire';
import { DownloadService, QueryValue, toParams } from './download.service';

export type InsuranceForm = Wire<'InsuranceFormView'>;
export type InsuranceFormLine = Wire<'InsuranceFormLine'>;
export type InsuranceFormInput = Req<'InsuranceFormRequest'>;
export type InsuranceFormLineInput = Req<'InsuranceFormLineRequest'>;
export type InsuranceFormPreview = Wire<'InsuranceFormPreview'>;
export type InsuranceFormLayout = Wire<'InsuranceFormLayoutView'>;
export type InsuranceFormStatus = InsuranceForm['status'];
export type InsuranceFormPurpose = InsuranceForm['purpose'];

export const INSURANCE_FORM_STATUSES: readonly InsuranceFormStatus[] = ['TO_PRINT', 'PRINTED', 'HANDED_OVER', 'VOID'];

/** The field codes `missing` can hold; each has a translation under INSURANCE.MISSING. */
export const MISSING_FIELDS = ['INSURER', 'INSURANCE_NUMBER', 'AFFILIATION_NUMBER', 'INSURED_NAME', 'INSURED_CIN',
  'DATE_OF_BIRTH', 'GENDER', 'PRACTITIONER_INPE', 'ACT_CODES'] as const;

/**
 * The patient's insurer's care form: which form a patient needs, making one, opening the
 * filled PDF (or the overlay for a numbered paper form), and the front desk's steps.
 */
@Injectable({ providedIn: 'root' })
export class InsuranceFormsApi {
  private readonly http = inject(HttpClient);
  private readonly download = inject(DownloadService);

  private get<T>(path: string, query?: Record<string, QueryValue>): Promise<T> {
    return firstValueFrom(this.http.get<T>(api(path), { params: toParams(query) }));
  }

  private post<T>(path: string, body: unknown = {}): Promise<T> {
    return firstValueFrom(this.http.post<T>(api(path), body));
  }

  layouts(): Promise<InsuranceFormLayout[]> {
    return this.get('/insurance-forms/layouts');
  }
  preview(patientId: string): Promise<InsuranceFormPreview> {
    return this.get('/insurance-forms/preview', { patientId });
  }
  list(query: { patientId?: string; status?: InsuranceFormStatus }): Promise<InsuranceForm[]> {
    return this.get('/insurance-forms', query);
  }
  create(body: InsuranceFormInput): Promise<InsuranceForm> {
    return this.post('/insurance-forms', body);
  }
  send(id: string, assigneeId?: string | null, message?: string | null): Promise<InsuranceForm> {
    return this.post(`/insurance-forms/${id}/send`, { assigneeId: assigneeId || null, message: message || null });
  }
  action(id: string, action: 'printed' | 'handed-over' | 'refresh' | 'void'): Promise<InsuranceForm> {
    return this.post(`/insurance-forms/${id}/${action}`);
  }
  /** Opens the filled form; `overlay` gives only OrthoFlow's text, to print onto the patient's own paper form. */
  open(id: string, overlay = false): Promise<void> {
    return this.download.open(`/insurance-forms/${id}/file`, { overlay });
  }
}
