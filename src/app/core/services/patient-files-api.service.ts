import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from '../api/url';

/** What a patient document is, chosen at upload. Older files have none. */
export type DocumentCategory = 'XRAY' | 'INTRAORAL_3D' | 'IMAGE';
export const DOCUMENT_CATEGORIES: readonly DocumentCategory[] = ['XRAY', 'INTRAORAL_3D', 'IMAGE'];

/** Images only: the patient file shows them beside the 3D chart. */
export const PATIENT_FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export interface PatientFile {
  id: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  category: DocumentCategory | null;
}

/**
 * A patient's uploaded documents (X-rays, 3D intraoral scans, other images): files owned
 * by the patient as PATIENT_DOCUMENT. The bytes sit behind the bearer token, so pictures
 * are fetched as blobs and shown through object URLs.
 *
 * `version` moves on every upload and delete, so the imaging pane beside the 3D chart
 * picks up a picture uploaded from the Documents tab without a reload.
 */
@Injectable({ providedIn: 'root' })
export class PatientFilesApi {
  private readonly http = inject(HttpClient);
  readonly version = signal(0);

  async list(patientId: string): Promise<PatientFile[]> {
    const params = new HttpParams().set('ownerType', 'PATIENT_DOCUMENT').set('ownerId', patientId);
    const files = await firstValueFrom(this.http.get<PatientFile[]>(api('/files'), { params }));
    return [...files].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async upload(patientId: string, category: DocumentCategory, file: File): Promise<PatientFile> {
    const params = new HttpParams().set('ownerType', 'PATIENT_DOCUMENT').set('ownerId', patientId).set('category', category);
    const form = new FormData();
    form.append('file', file);
    const saved = await firstValueFrom(this.http.post<PatientFile>(api('/files'), form, { params }));
    this.version.update((v) => v + 1);
    return saved;
  }

  async delete(fileId: string): Promise<void> {
    await firstValueFrom(this.http.delete<void>(api(`/files/${fileId}`)));
    this.version.update((v) => v + 1);
  }

  /** The file's bytes, for an object URL. */
  blob(fileId: string): Promise<Blob> {
    return firstValueFrom(this.http.get(api(`/files/${fileId}`), { responseType: 'blob' }));
  }
}
