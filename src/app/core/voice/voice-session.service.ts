import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Router } from '@angular/router';
import { VoiceApiService, VoiceSessionDto } from './voice-api.service';
import { SessionBufferService } from './session-buffer.service';
import { VoiceOrchestratorService } from './voice-orchestrator.service';
import { VoiceContextService } from './voice-context.service';
import { PatientClinicalRecord } from '../models/clinical-record.model';
import { findingLabel } from './clinical-lexicon';
import { describeFdi } from './tooth-lexicon';

/**
 * A dictated examination, from "start examination" to "end examination".
 *
 * Sessions are what make hands-free documentation practical. Confirming forty
 * individual writes is not something a doctor with gloves on will do, so
 * findings accumulate under a session id and the whole consultation is
 * reviewed and confirmed once at the end — while each individual write is
 * still separately audited underneath, so the session summary is a review
 * step rather than the only record.
 *
 * Dictation is buffered. Each command is audited server-side as it is spoken
 * — so a closed tab never loses what was said — but nothing reaches the
 * clinical tables until the dentist has reviewed the consultation on the
 * review page and committed it. {@link end} therefore moves the session to
 * PENDING_REVIEW and navigates there; {@link commit} is what actually writes.
 *
 * The structured summary is still read back from the server rather than
 * assembled from what the browser thinks it sent. The generated narrative is
 * separate and comes from {@link VoiceApiService.summarizeSession}.
 */

export interface ToothSummaryRow {
  fdi: string;
  description: string;
  findings: Array<{ code: string; label: string; kind: string; note?: string | null }>;
}

export interface SessionSummary {
  teeth: ToothSummaryRow[];
  diagnoses: string[];
  treatments: string[];
  notes: Array<{ category: string; content: string; fdi?: string | null }>;
  allergies: string[];
  medicalHistory: Array<{ category: string; label: string }>;
  followUps: string[];
  totalFindings: number;
}

/** Sessions abandoned automatically after this period of voice inactivity. */
const SESSION_TIMEOUT_MS = 45 * 60 * 1000; // 45 minutes

@Injectable({ providedIn: 'root' })
export class VoiceSessionService {
  private api = inject(VoiceApiService);
  private context = inject(VoiceContextService);
  private buffer = inject(SessionBufferService);
  private orchestrator = inject(VoiceOrchestratorService);
  private router = inject(Router);

  private sessionSignal = signal<VoiceSessionDto | null>(null);
  private summarySignal = signal<SessionSummary | null>(null);
  private summaryOpenSignal = signal(false);
  private busySignal = signal(false);
  private narrativeSignal = signal<string | null>(null);
  private narrativeErrorSignal = signal<string | null>(null);

  session = this.sessionSignal.asReadonly();
  summary = this.summarySignal.asReadonly();
  summaryOpen = this.summaryOpenSignal.asReadonly();
  busy = this.busySignal.asReadonly();
  /** The generated consultation narrative, for the review page to edit. */
  narrative = this.narrativeSignal.asReadonly();
  /** Why no narrative is available, when there isn't one. */
  narrativeError = this.narrativeErrorSignal.asReadonly();

  isActive = computed(() => this.sessionSignal()?.status === 'ACTIVE');

  /** Timer handle — reset on each voice command, fires on prolonged inactivity. */
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  /**
   * Call this whenever voice activity happens inside an active session so the
   * timeout clock resets. The orchestrator should call this after every
   * command executes.
   */
  touchSession(): void {
    if (!this.isActive()) return;
    this.armSessionTimeout();
  }

  private armSessionTimeout(): void {
    this.clearSessionTimeout();
    this.timeoutHandle = setTimeout(() => {
      if (this.isActive()) {
        console.warn('[VoiceSession] Session timed out after inactivity — abandoning.');
        void this.abandon();
      }
    }, SESSION_TIMEOUT_MS);
  }

  private clearSessionTimeout(): void {
    if (this.timeoutHandle !== null) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
  }

  async start(): Promise<VoiceSessionDto> {
    const snapshot = this.context.snapshot();
    const session = await firstValueFrom(this.api.startSession(snapshot.patientId, snapshot.locale));
    this.sessionSignal.set(session);
    this.summarySignal.set(null);
    this.narrativeSignal.set(null);
    this.narrativeErrorSignal.set(null);
    this.orchestrator.resetBuffer();
    this.context.setSessionId(session.id);
    if (snapshot.patientId) {
      await this.buffer.begin({
        sessionId: session.id,
        patientId: snapshot.patientId,
        patientName: snapshot.patientName ?? '',
        locale: snapshot.locale,
        startedAt: Date.now(),
      });
    }
    this.armSessionTimeout();
    return session;
  }

  /**
   * Ends dictation and takes the dentist to review.
   *
   * Nothing is written here. The session moves to PENDING_REVIEW, the
   * narrative is generated from the audit trail, and the review page is where
   * the consultation is corrected and committed. Failing to generate a
   * narrative does not block any of that — the structured findings are what
   * the record is made of, and the prose is an aid to reading them.
   */
  async end(): Promise<void> {
    const session = this.sessionSignal();
    if (!session) return;

    this.clearSessionTimeout();
    this.busySignal.set(true);
    try {
      this.orchestrator.stopListening();

      const pending = await firstValueFrom(this.api.completeSession(session.id, {
        status: 'PENDING_REVIEW',
        confirmed: false,
      }));
      this.sessionSignal.set(pending);

      await this.generateNarrative(session.id);

      const patientId = session.patientId ?? this.context.snapshot().patientId;
      if (patientId) {
        await this.router.navigate(['/patients', patientId, 'session', session.id, 'review']);
      }
    } finally {
      this.busySignal.set(false);
    }
  }

  /**
   * Requests the narrative. Safe to call repeatedly — the server persists
   * nothing, so the dentist can regenerate after changing what is included.
   */
  async generateNarrative(sessionId: string): Promise<void> {
    try {
      const response = await firstValueFrom(this.api.summarizeSession(sessionId));
      if (response.error) {
        this.narrativeSignal.set(null);
        this.narrativeErrorSignal.set(response.error);
        return;
      }
      this.narrativeSignal.set(response.summary);
      this.narrativeErrorSignal.set(null);
    } catch {
      this.narrativeSignal.set(null);
      this.narrativeErrorSignal.set('summary-request-failed');
    }
  }

  /**
   * Writes the reviewed consultation to the clinical record.
   *
   * Commands are named by audit id rather than resent as values, so what the
   * server executes is what it recorded and showed. A partial failure is
   * reported rather than swallowed: the session stays in PENDING_REVIEW and
   * the page tells the dentist which findings did not save.
   */
  async commit(
    sessionId: string,
    approvedAuditIds: string[],
    rejectedAuditIds: string[],
    summary: string,
  ): Promise<{ ok: boolean; executed: number; failed: { auditId: string; errorMessage: string }[] }> {
    this.busySignal.set(true);
    try {
      const result = await firstValueFrom(this.api.commitSession(sessionId, {
        approvedAuditIds,
        rejectedAuditIds,
        amendments: [],
        summary,
      }));
      this.sessionSignal.set(result.session);

      if (result.failed.length === 0) {
        // Only once the server has it. Clearing earlier would discard the
        // dentist's only local copy of a consultation that failed to save.
        await this.buffer.clear(sessionId);
        this.orchestrator.resetBuffer();
        this.context.setSessionId(null);
        this.context.clearConversation();
      }

      return {
        ok: result.failed.length === 0,
        executed: result.executed,
        failed: result.failed.map(f => ({ auditId: f.auditId, errorMessage: f.errorMessage })),
      };
    } finally {
      this.busySignal.set(false);
    }
  }

  /**
   * Restores an examination interrupted by a crash or a closed tab.
   *
   * Offered only for the patient whose dossier is open — resuming Ahmed's
   * half-finished examination while Fatima's chart is on screen is how
   * findings end up on the wrong record.
   */
  async resumeIfAvailable(patientId: string): Promise<boolean> {
    const buffered = await this.buffer.findResumable(patientId);
    if (!buffered) return false;

    try {
      const session = await firstValueFrom(this.api.getSession(buffered.sessionId));
      if (session.status !== 'ACTIVE') {
        await this.buffer.clear(buffered.sessionId);
        return false;
      }
      this.sessionSignal.set(session);
      this.context.setSessionId(session.id);
      this.orchestrator.restoreBuffer(buffered.commands.map(command => ({
        auditId: command.auditId,
        intent: command.intent,
        entities: command.entities,
        preview: command.preview,
        transcript: command.transcript,
        corrections: command.corrections,
        at: command.at,
      })));
      return true;
    } catch {
      // The session no longer exists server-side; the buffer is orphaned.
      await this.buffer.clear(buffered.sessionId);
      return false;
    }
  }

  /** Sign-off. Freezes the summary as reviewed. Optionally appends clinician remarks. */
  async confirm(clinicianNotes: string | null = null): Promise<void> {
    const session = this.sessionSignal();
    const summary = this.summarySignal();
    if (!session) return;
    const summaryWithNotes = summary
      ? { ...summary, clinicianNotes: clinicianNotes ?? '' }
      : null;
    await firstValueFrom(this.api.completeSession(session.id, {
      status: 'COMPLETED',
      summary: summaryWithNotes ? JSON.stringify(summaryWithNotes) : undefined,
      confirmed: true,
    }));
    this.summaryOpenSignal.set(false);
  }

  async abandon(): Promise<void> {
    const session = this.sessionSignal();
    if (!session) return;
    this.clearSessionTimeout();
    // ABANDONED marks the dictation as not reviewed. It does not remove
    // anything already written — those are clinical records with their own
    // audit trail, and a session ending untidily is not grounds to delete them.
    await firstValueFrom(this.api.completeSession(session.id, { status: 'ABANDONED', confirmed: false }));
    this.sessionSignal.set(null);
    this.context.setSessionId(null);
    this.context.clearConversation();
    this.summaryOpenSignal.set(false);
  }

  /** Mid-examination "show me today's findings" — leaves the session running. */
  async refreshSummary(): Promise<SessionSummary | null> {
    const session = this.sessionSignal();
    if (!session) return null;
    const summary = await this.loadSummary(session.id);
    this.summaryOpenSignal.set(true);
    return summary;
  }

  openSummary(): void {
    if (this.summarySignal()) this.summaryOpenSignal.set(true);
  }

  closeSummary(): void {
    this.summaryOpenSignal.set(false);
  }

  private async loadSummary(sessionId: string): Promise<SessionSummary> {
    const record = await firstValueFrom(this.api.sessionSummary(sessionId));
    const summary = this.buildSummary(record);
    this.summarySignal.set(summary);
    return summary;
  }

  private buildSummary(record: PatientClinicalRecord): SessionSummary {
    const byTooth = new Map<string, ToothSummaryRow>();
    for (const finding of record.findings) {
      const row = byTooth.get(finding.fdi) ?? {
        fdi: finding.fdi,
        description: describeFdi(finding.fdi),
        findings: [],
      };
      row.findings.push({
        code: finding.findingCode,
        label: findingLabel(finding.findingCode),
        kind: finding.kind,
        note: finding.note,
      });
      byTooth.set(finding.fdi, row);
    }

    const teeth = [...byTooth.values()].sort((a, b) => a.fdi.localeCompare(b.fdi));

    // Diagnoses and treatments are the same findings sliced by kind — the
    // doctor reviews "what is wrong" separately from "what needs doing",
    // which is how a consultation summary is actually read.
    const diagnoses: string[] = [];
    const treatments: string[] = [];
    for (const row of teeth) {
      for (const finding of row.findings) {
        const line = `${row.fdi} (${row.description}) — ${finding.label}`;
        if (finding.kind === 'TREATMENT_REQUIRED') treatments.push(line);
        else if (finding.kind === 'CONDITION') diagnoses.push(line);
      }
    }

    const followUps = record.notes
      .filter(note => note.category === 'FOLLOW_UP')
      .map(note => note.content);

    return {
      teeth,
      diagnoses,
      treatments,
      notes: record.notes
        .filter(note => note.category !== 'FOLLOW_UP')
        .map(note => ({ category: note.category, content: note.content, fdi: note.fdi })),
      allergies: record.allergies.map(a => a.substance),
      medicalHistory: record.medicalHistory.map(entry => ({ category: entry.category, label: entry.label })),
      followUps,
      totalFindings: record.findings.length,
    };
  }

  /** A short read-back for "show me today's findings" while hands are busy. */
  spokenSummary(summary: SessionSummary): string {
    if (summary.totalFindings === 0 && summary.notes.length === 0) {
      return 'Nothing recorded in this examination yet.';
    }
    const parts: string[] = [];
    if (summary.teeth.length) {
      parts.push(`${summary.teeth.length} ${summary.teeth.length === 1 ? 'tooth' : 'teeth'} with findings`);
    }
    if (summary.treatments.length) parts.push(`${summary.treatments.length} treatments recommended`);
    if (summary.allergies.length) parts.push(`${summary.allergies.length} allergies`);
    if (summary.notes.length) parts.push(`${summary.notes.length} notes`);
    return `So far: ${parts.join(', ')}. The full summary is on screen.`;
  }
}
