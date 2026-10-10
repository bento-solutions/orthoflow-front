import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from '../api/url';
import type { Req, Wire } from '../api/wire';

export type PhotoSeries = Wire<'ClinicalPhotoSeries'>;
export type ClinicalPhoto = Wire<'ClinicalPhoto'>;
export type PhotoSeriesRequest = Req<'ClinicalPhotoSeriesRequest'>;
export type PhotoStage = PhotoSeries['stage'];
export type PhotoView = ClinicalPhoto['view'];

export const PHOTO_STAGES: readonly PhotoStage[] = ['INITIAL', 'PROGRESS', 'FINAL', 'RETENTION'];

/**
 * A patient's orthodontic photo series: one per sitting, one picture per standard view.
 * The pictures are files behind the bearer token, so they are fetched as blobs and shown
 * through object URLs rather than linked.
 */
@Injectable({ providedIn: 'root' })
export class ClinicalPhotoApi {
  private readonly http = inject(HttpClient);

  list(patientId: string): Promise<PhotoSeries[]> {
    return firstValueFrom(this.http.get<PhotoSeries[]>(api(`/patients/${patientId}/photo-series`)));
  }

  create(patientId: string, body: PhotoSeriesRequest): Promise<PhotoSeries> {
    return firstValueFrom(this.http.post<PhotoSeries>(api(`/patients/${patientId}/photo-series`), body));
  }

  update(seriesId: string, body: PhotoSeriesRequest): Promise<PhotoSeries> {
    return firstValueFrom(this.http.put<PhotoSeries>(api(`/photo-series/${seriesId}`), body));
  }

  delete(seriesId: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(api(`/photo-series/${seriesId}`)));
  }

  /** Puts a picture in one view of the series, replacing what was there. */
  upload(seriesId: string, view: PhotoView, file: File): Promise<PhotoSeries> {
    const form = new FormData();
    form.append('file', file);
    return firstValueFrom(this.http.put<PhotoSeries>(api(`/photo-series/${seriesId}/photos/${view}`), form));
  }

  removePhoto(seriesId: string, view: PhotoView): Promise<PhotoSeries> {
    return firstValueFrom(this.http.delete<PhotoSeries>(api(`/photo-series/${seriesId}/photos/${view}`)));
  }

  /** The picture's bytes, for an object URL. */
  image(fileId: string): Promise<Blob> {
    return firstValueFrom(this.http.get(api(`/files/${fileId}`), { responseType: 'blob' }));
  }
}
