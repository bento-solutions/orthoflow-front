import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { DentalChartType, ToothStatus } from '../models/patient.model';

export interface ToothStateResponse {
  fdi: string;
  status: ToothStatus;
  notes?: string;
}

export interface DentalChartResponse {
  id: string;
  patientId: string;
  chartType: DentalChartType;
  teeth: ToothStateResponse[];
  updatedAt: string;
}

export type ToothUpdateSource = '2d' | '3d';

@Injectable({
  providedIn: 'root'
})
export class DentalChartApiService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/api/v1/patients`;

  getChart(patientId: string, chartType: DentalChartType): Observable<DentalChartResponse> {
    return this.http.get<DentalChartResponse>(`${this.apiUrl}/${patientId}/dental-chart`, {
      params: { chartType }
    });
  }

  updateTooth(
    patientId: string,
    fdi: string,
    status: ToothStatus,
    notes: string | undefined,
    source: ToothUpdateSource
  ): Observable<DentalChartResponse> {
    return this.http.put<DentalChartResponse>(
      `${this.apiUrl}/${patientId}/dental-chart/teeth/${fdi}`,
      { status, notes, source }
    );
  }
}
