import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { PatientClinicalRecord } from '../models/clinical-record.model';
import { CommandOutcome, ConfirmationStatus, ResolverKind, RiskTier } from './voice-intent.model';

export interface IntentDescriptorDto {
  id: string;
  description: string;
  args: Record<string, string>;
  examples: string[];
}

export interface InterpretRequestDto {
  transcript: string;
  locale: string;
  module: string;
  selectedFdi: string | null;
  patientContext: boolean;
  chartType: string;
  recentUtterances: string[];
  availableIntents: IntentDescriptorDto[];
  findingCodes: string[];
  sessionId: string | null;
}

export interface InterpretResponseDto {
  intent: string | null;
  entities: Record<string, unknown>;
  confidence: number;
  clarification: string | null;
  resolver: string;
  provider: string;
  error: string | null;
}

export interface RecordVoiceCommandDto {
  patientId: string | null;
  sessionId: string | null;
  transcript: string;
  locale: string;
  intent: string;
  entities: string;
  resolver: ResolverKind;
  confidence: number | null;
  module: string;
  riskTier: RiskTier;
  confirmationStatus: ConfirmationStatus;
  outcome: CommandOutcome;
  targetType?: string | null;
  targetId?: string | null;
  previousValue?: string | null;
  newValue?: string | null;
  errorMessage?: string | null;
}

export interface VoiceCommandAuditDto extends RecordVoiceCommandDto {
  id: string;
  actorId: string;
  occurredAt: string;
  undoneAt: string | null;
}

/** Server intents the audit row can be executed as on confirmation. */
export type ServerIntent =
  | 'clinical.addFindings'
  | 'clinical.retractFindings'
  | 'clinical.addNote'
  | 'clinical.addAllergy'
  | 'clinical.addMedicalHistory';

export interface TranscriptionDto {
  text: string;
  /**
   * The transcript respelled into the command vocabulary — tooth numbers as
   * digits, near-miss terms as the grammar spells them. Parsed first; absent
   * from older servers and from providers that do not produce one.
   */
  normalized?: string | null;
  provider: string;
  model: string;
  language: string | null;
  durationSeconds: number | null;
  /** Non-null when no transcript was produced — fall back, do not fail. */
  error: string | null;
}

export interface SessionSummaryDto {
  summary: string;
  provider: string;
  model: string;
  commandCount: number;
  truncated: boolean;
  error: string | null;
}

export interface CommitAmendmentDto {
  originalAuditId: string;
  intent: string;
  /** JSON object, same shape the audit row holds. */
  entities: string;
}

export interface CommitVoiceSessionDto {
  approvedAuditIds: string[];
  rejectedAuditIds: string[];
  amendments: CommitAmendmentDto[];
  summary: string;
}

export interface CommitResultDto {
  session: VoiceSessionDto;
  executed: number;
  rejected: number;
  amended: number;
  failed: { auditId: string; intent: string; errorMessage: string }[];
}

export interface VoiceSessionDto {
  id: string;
  patientId: string | null;
  actorId: string;
  status: 'ACTIVE' | 'PENDING_REVIEW' | 'COMPLETED' | 'ABANDONED';
  locale: string | null;
  summary: string | null;
  startedAt: string;
  endedAt: string | null;
  confirmedAt: string | null;
}

/** MediaRecorder reports `audio/webm;codecs=opus`; the container is the part that matters. */
function extensionFor(mimeType: string): string {
  const bare = (mimeType || '').split(';')[0].trim().toLowerCase();
  if (bare === 'audio/ogg') return 'ogg';
  if (bare === 'audio/mp4') return 'mp4';
  if (bare === 'audio/wav' || bare === 'audio/wave') return 'wav';
  if (bare === 'audio/mpeg') return 'mp3';
  return 'webm';
}

@Injectable({ providedIn: 'root' })
export class VoiceApiService {
  private http = inject(HttpClient);
  private base = `${environment.apiUrl}/api/v1/voice`;

  /**
   * Fallback interpretation for an utterance the on-device grammar declined.
   * Returns a *proposed* intent or a question — never a performed action.
   */
  interpret(request: InterpretRequestDto): Observable<InterpretResponseDto> {
    return this.http.post<InterpretResponseDto>(`${this.base}/interpret`, request);
  }

  /**
   * Logs one interpreted command.
   *
   * For a SAFE command (navigation, reads) the client has already acted by
   * the time this is called. For a CONFIRM command this must carry
   * `confirmationStatus: 'PENDING'` and **nothing has been written yet** —
   * the server refuses any other status on that tier. The write happens in
   * {@link confirmCommand}, re-derived from this row.
   */
  recordCommand(entry: RecordVoiceCommandDto): Observable<VoiceCommandAuditDto> {
    return this.http.post<VoiceCommandAuditDto>(`${this.base}/commands`, entry);
  }

  /**
   * Executes a pending command from its own audit row.
   *
   * The client deliberately sends no payload: the server replays exactly what
   * it recorded and showed the doctor, so what executes cannot drift from
   * what was previewed and confirmed.
   */
  confirmCommand(auditId: string): Observable<VoiceCommandAuditDto> {
    return this.http.post<VoiceCommandAuditDto>(`${this.base}/commands/${auditId}/confirm`, {});
  }

  rejectCommand(auditId: string): Observable<VoiceCommandAuditDto> {
    return this.http.post<VoiceCommandAuditDto>(`${this.base}/commands/${auditId}/reject`, {});
  }

  auditForPatient(patientId: string): Observable<VoiceCommandAuditDto[]> {
    return this.http.get<VoiceCommandAuditDto[]>(`${this.base}/commands`, { params: { patientId } });
  }

  startSession(patientId: string | null, locale: string): Observable<VoiceSessionDto> {
    return this.http.post<VoiceSessionDto>(`${this.base}/sessions`, { patientId, locale });
  }

  /** One session's current state — used to check a recovered buffer is still live. */
  getSession(sessionId: string): Observable<VoiceSessionDto> {
    return this.http.get<VoiceSessionDto>(`${this.base}/sessions/${sessionId}`);
  }

  completeSession(
    sessionId: string,
    body: { status: 'PENDING_REVIEW' | 'COMPLETED' | 'ABANDONED'; summary?: string; confirmed: boolean },
  ): Observable<VoiceSessionDto> {
    return this.http.post<VoiceSessionDto>(`${this.base}/sessions/${sessionId}/end`, body);
  }

  /** Read back from the clinical tables — what the session actually persisted. */
  sessionSummary(sessionId: string): Observable<PatientClinicalRecord> {
    return this.http.get<PatientClinicalRecord>(`${this.base}/sessions/${sessionId}/summary`);
  }

  /**
   * Transcribes one recorded clip.
   *
   * The primary capture path. A response carrying `error` means no transcript
   * was produced — switched off, unconfigured, or the provider was
   * unreachable — and the caller falls back to the browser's own recogniser
   * rather than losing the utterance.
   *
   * @param prompt bias text (the patient's name, terms the open tab makes
   *   likely) used for spelling only; it never becomes part of the transcript.
   */
  transcribe(clip: Blob, language: string, prompt?: string): Observable<TranscriptionDto> {
    const form = new FormData();
    // The extension matters: some providers infer the container from it.
    form.append('file', clip, `utterance.${extensionFor(clip.type)}`);
    if (language) form.append('language', language);
    if (prompt) form.append('prompt', prompt);
    return this.http.post<TranscriptionDto>(`${this.base}/transcribe`, form);
  }

  /**
   * The generated consultation narrative, built server-side from the session's
   * own audit trail. Persists nothing, so the review page may call it again
   * every time the dentist changes what is included.
   */
  summarizeSession(sessionId: string): Observable<SessionSummaryDto> {
    return this.http.post<SessionSummaryDto>(`${this.base}/sessions/${sessionId}/summarize`, {});
  }

  /**
   * Writes a reviewed examination to the clinical record — the only path by
   * which a buffered session reaches the clinical tables.
   *
   * Commands are named by audit id rather than resent as values, so what
   * executes is re-derived from what the server itself recorded and showed.
   */
  commitSession(sessionId: string, body: CommitVoiceSessionDto): Observable<CommitResultDto> {
    return this.http.post<CommitResultDto>(`${this.base}/sessions/${sessionId}/commit`, body);
  }

  lexicon(): Observable<{ codes: string[]; definitions: unknown[] }> {
    return this.http.get<{ codes: string[]; definitions: unknown[] }>(`${this.base}/lexicon`);
  }
}
