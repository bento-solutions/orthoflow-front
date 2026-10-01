import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  CommitConsultationDto,
  CommitConsultationResultDto,
  ConsultationConfigDto,
  ConsultationDto,
  ExtractionResponseDto,
} from './consultation.model';

/** The server side of full-consultation recording. See {@link ConsultationService}. */
@Injectable({ providedIn: 'root' })
export class ConsultationApiService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/api/v1/consultations`;

  /** Whether to offer the feature at all, and whether a model reads the conversation. */
  config(): Observable<ConsultationConfigDto> {
    return this.http.get<ConsultationConfigDto>(`${this.base}/config`);
  }

  /**
   * Starts recording. `patientInformed` is the doctor's attestation that the
   * patient was told the conversation is transcribed and kept; the server
   * refuses to start without it.
   */
  start(patientId: string, locale: string, patientInformed: boolean): Observable<ConsultationDto> {
    return this.http.post<ConsultationDto>(this.base, { patientId, locale, patientInformed });
  }

  /** The patient's unfinished consultation, or null (the server answers 204). */
  open(patientId: string): Observable<ConsultationDto | null> {
    return this.http.get<ConsultationDto | null>(`${this.base}/open`, { params: { patientId } });
  }

  get(id: string): Observable<ConsultationDto> {
    return this.http.get<ConsultationDto>(`${this.base}/${id}`);
  }

  /** A patient's consultations, newest first, without transcripts. */
  list(patientId: string): Observable<ConsultationDto[]> {
    return this.http.get<ConsultationDto[]>(this.base, { params: { patientId } });
  }

  /**
   * Reads the conversation so far and says what it established. Also saves the
   * transcript, so a crash loses at most the last few seconds.
   */
  extract(id: string, transcript: string): Observable<ExtractionResponseDto> {
    return this.http.post<ExtractionResponseDto>(`${this.base}/${id}/extract`, { transcript });
  }

  /** The doctor called the consultation: the chart commands start to work. */
  beginExamination(id: string): Observable<ConsultationDto> {
    return this.http.post<ConsultationDto>(`${this.base}/${id}/examination`, {});
  }

  /** Recording stops; the doctor reviews. */
  end(id: string, transcript: string): Observable<ConsultationDto> {
    return this.http.post<ConsultationDto>(`${this.base}/${id}/end`, { transcript });
  }

  /** Saves what the doctor validated. `saved: false` means a chart finding failed and nothing was written. */
  commit(id: string, body: CommitConsultationDto): Observable<CommitConsultationResultDto> {
    return this.http.post<CommitConsultationResultDto>(`${this.base}/${id}/commit`, body);
  }

  /** Throws it away, transcript included. */
  /** Keeps the doctor's decisions so a reload does not undo them. */
  saveReviewState(id: string, state: unknown): Observable<void> {
    return this.http.put<void>(`${this.base}/${id}/review-state`, state);
  }

  abandon(id: string): Observable<ConsultationDto> {
    return this.http.post<ConsultationDto>(`${this.base}/${id}/abandon`, {});
  }
}
