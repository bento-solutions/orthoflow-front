import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from '../../core/api/url';
import { QueryValue, toParams } from '../../core/services/download.service';
import type { Req, Wire } from '../../core/api/wire';

export type DirectoryRow = Wire<'PatientDirectoryRow'>;
export type DirectoryPage = Omit<Wire<'PagePatientDirectoryRow'>, 'content'> & { content: DirectoryRow[] };
export type DirectoryKpis = Wire<'PatientKpis'>;
export type DuplicatePair = Wire<'DuplicatePair'>;
export type MergePreview = Wire<'PatientMergePreview'>;
export type MergeRequest = Req<'PatientMergeRequest'>;
export type MergeResult = Wire<'PatientMergeResult'>;
export type Insurer = Wire<'InsurerResponse'>;
export type RecallRow = Wire<'RecallRow'>;

export const RECALL_KINDS = [
  'NO_VISIT_1M', 'NO_VISIT_3M', 'NO_VISIT_6M', 'NOTHING_SCHEDULED_1M', 'NOTHING_SCHEDULED_12M', 'LOST_TO_FOLLOW_UP', 'RETENTION_DUE_6M', 'RETENTION_DUE_12M',
] as const;
export type RecallKind = (typeof RECALL_KINDS)[number];

export interface DirectoryQuery {
  search?: string;
  gender?: string;
  status?: string;
  practitionerId?: string;
  insurerId?: string;
  duplicatesOnly?: boolean;
  debtOnly?: boolean;
  /** Only patients who first came through the clinic's landing page. */
  landingPageOnly?: boolean;
  sort?: string;
  dir?: 'asc' | 'desc';
  page?: number;
  size?: number;
}

/** The patient directory, duplicate detection and merge, and the recall lists the front desk calls from. */
@Injectable({ providedIn: 'root' })
export class PatientDirectoryApi {
  private readonly http = inject(HttpClient);

  list(query: DirectoryQuery): Promise<DirectoryPage> {
    return firstValueFrom(this.http.get<DirectoryPage>(api('/patients/list'), { params: toParams(query as Record<string, QueryValue>) }));
  }

  kpis(): Promise<DirectoryKpis> {
    return firstValueFrom(this.http.get<DirectoryKpis>(api('/patients/kpis')));
  }

  duplicates(): Promise<DuplicatePair[]> {
    return firstValueFrom(this.http.get<DuplicatePair[]>(api('/patients/duplicates')));
  }

  mergePreview(targetId: string, sourceId: string): Promise<MergePreview> {
    return firstValueFrom(this.http.get<MergePreview>(api(`/patients/${targetId}/merge-preview`), { params: { sourceId } }));
  }

  merge(targetId: string, request: MergeRequest): Promise<MergeResult> {
    return firstValueFrom(this.http.post<MergeResult>(api(`/patients/${targetId}/merge`), request));
  }

  insurers(): Promise<Insurer[]> {
    return firstValueFrom(this.http.get<Insurer[]>(api('/reference/insurers')));
  }

  recalls(kind: RecallKind, query: Record<string, QueryValue>): Promise<RecallRow[]> {
    return firstValueFrom(this.http.get<RecallRow[]>(api(`/recalls/${kind}`), { params: toParams(query) }));
  }

  sendRecallReminders(patientIds: string[]): Promise<Record<string, number>> {
    return firstValueFrom(this.http.post<Record<string, number>>(api('/recalls/send-reminders'), { patientIds }));
  }
}
