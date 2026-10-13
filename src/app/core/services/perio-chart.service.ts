import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  CreatePerioChartRequest, PerioChartDto, PerioChartListItem, SavePerioChartRequest,
} from '../clinical/perio/perio.model';

/**
 * A patient's periodontal charts: the six-point probing record of each examination. Plain HTTP; the
 * chart screen owns the state (it autosaves, and has to decide what a conflict means for the screen).
 */
@Injectable({ providedIn: 'root' })
export class PerioChartService {
  private http = inject(HttpClient);
  private baseUrl = `${environment.apiUrl}/api/v1/patients`;

  private url(patientId: string, tail = ''): string {
    return `${this.baseUrl}/${patientId}/clinical-record/perio-charts${tail}`;
  }

  list(patientId: string): Observable<PerioChartListItem[]> {
    return this.http.get<PerioChartListItem[]>(this.url(patientId));
  }

  listDeleted(patientId: string): Observable<PerioChartListItem[]> {
    return this.http.get<PerioChartListItem[]>(this.url(patientId), { params: new HttpParams().set('deleted', true) });
  }

  get(patientId: string, chartId: string): Observable<PerioChartDto> {
    return this.http.get<PerioChartDto>(this.url(patientId, `/${chartId}`));
  }

  create(patientId: string, request: CreatePerioChartRequest = {}): Observable<PerioChartDto> {
    return this.http.post<PerioChartDto>(this.url(patientId), request);
  }

  save(patientId: string, chartId: string, request: SavePerioChartRequest): Observable<PerioChartDto> {
    return this.http.put<PerioChartDto>(this.url(patientId, `/${chartId}`), request);
  }

  delete(patientId: string, chartId: string): Observable<void> {
    return this.http.delete<void>(this.url(patientId, `/${chartId}`));
  }

  restore(patientId: string, chartId: string): Observable<PerioChartDto> {
    return this.http.post<PerioChartDto>(this.url(patientId, `/${chartId}/restore`), {});
  }
}
