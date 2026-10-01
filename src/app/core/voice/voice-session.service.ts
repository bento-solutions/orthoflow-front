import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { CommitAmendmentDto, VoiceApiService, VoiceSessionDto } from './voice-api.service';
import { SessionBufferService } from './session-buffer.service';
import { VoiceOrchestratorService } from './voice-orchestrator.service';
import { VoiceContextService } from './voice-context.service';
import { PatientClinicalRecord } from '../models/clinical-record.model';
import { findingLabel } from './clinical-lexicon';
import { describeFdi } from './tooth-lexicon';

/**
 * A dictated examination, from start to review.
 *
 * Findings accumulate under a session id and the whole consultation is
 * reviewed and confirmed once at the end, while each individual write is
 * still separately audited underneath.
 *
 * Dictation is buffered. Each command is audited server-side as it is spoken
 * — so a closed tab never loses what was said — but nothing reaches the
 * clinical tables until the dentist has reviewed the consultation and
 * committed it. {@link end} moves the session to PENDING_REVIEW; {@link
 * commit} is what actually writes.
 *
 * Everything happens inside the patient's dossier. Ending a session used to
 * navigate to a separate review route, which took the dentist away from the
 * chart they had just dictated onto; the dossier now switches its own voice
 * panel into review instead, and the route remains only for direct links.
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

/** What a dossier found waiting for its patient when it opened. */
export type ResumableState = 'active' | 'review' | null;

/** An examination with nothing dictated for this long is closed automatically. */
export const SESSION_TIMEOUT_MS = 45 * 60 * 1000;

/**
 * The dentist is told this long before it happens. A long procedure is
 * mostly silence — a root canal is an hour with two sentences in it — and
 * closing the microphone under someone who cannot look at the screen, without
 * a word, loses whatever they say next.
 */
export const SESSION_WARNING_LEAD_MS = 5 * 60 * 1000;

@Injectable({ providedIn: 'root' })
export class VoiceSessionService {
  private api = inject(VoiceApiService);
  private context = inject(VoiceContextService);
  private buffer = inject(SessionBufferService);
  private orchestrator = inject(VoiceOrchestratorService);

  private sessionSignal = signal<VoiceSessionDto | null>(null);
  private summarySignal = signal<SessionSummary | null>(null);
  private summaryOpenSignal = signal(false);
  private busySignal = signal(false);
  private narrativeSignal = signal<string | null>(null);
  private narrativeErrorSignal = signal<string | null>(null);
  private narrativeGeneratedSignal = signal(true);
  private startedAtSignal = signal<number | null>(null);

  session = this.sessionSignal.asReadonly();
  summary = this.summarySignal.asReadonly();
  summaryOpen = this.summaryOpenSignal.asReadonly();
  busy = this.busySignal.asReadonly();
  /** The generated consultation narrative, for review to edit. */
  narrative = this.narrativeSignal.asReadonly();
  /** Why no narrative is available, when there isn't one. */
  narrativeError = this.narrativeErrorSignal.asReadonly();
  /** False when the narrative is the structured report written from the records, not by a model. */
  narrativeGenerated = this.narrativeGeneratedSignal.asReadonly();
  /** Epoch ms the session started, for the elapsed-time display. */
  startedAt = this.startedAtSignal.asReadonly();

  isActive = computed(() => this.sessionSignal()?.status === 'ACTIVE');
  /** Dictation has ended and the consultation is waiting to be saved. */
  reviewing = computed(() => this.sessionSignal()?.status === 'PENDING_REVIEW');

  /** Timer handles — reset on each command, fire on prolonged inactivity. */
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private warningHandle: ReturnType<typeof setTimeout> | null = null;

  /**
   * Resets the inactivity clock. The orchestrator calls this for every command
   * it accepts, and for a bare wake word — which is the answer to "say Calypso
   * to carry on".
   */
  touchSession(): void {
    if (!this.isActive()) return;
    this.armSessionTimeout();
  }

  private armSessionTimeout(): void {
    this.clearSessionTimeout();
    this.warningHandle = setTimeout(() => {
      if (this.isActive()) this.orchestrator.notify('idleWarning');
    }, SESSION_TIMEOUT_MS - SESSION_WARNING_LEAD_MS);
    this.timeoutHandle = setTimeout(() => void this.closeForInactivity(), SESSION_TIMEOUT_MS);
  }

  private async closeForInactivity(): Promise<void> {
    if (!this.isActive()) return;
    // Into review rather than abandoned: whatever was dictated is still worth
    // saving, and discarding it is the dentist's call.
    console.warn('[VoiceSession] Nothing dictated for 45 minutes — ending dictation.');
    try {
      await this.end();
    } catch {
      // The connection is down; the examination stays open on the server and
      // is offered back when the dossier is opened again.
      return;
    }
    this.orchestrator.notify('idleEnded');
  }

  private clearSessionTimeout(): void {
    if (this.timeoutHandle !== null) clearTimeout(this.timeoutHandle);
    if (this.warningHandle !== null) clearTimeout(this.warningHandle);
    this.timeoutHandle = null;
    this.warningHandle = null;
  }

  async start(): Promise<VoiceSessionDto> {
    // Saying "begin the examination" twice must not open a second session under
    // the first — its findings would be staged against an id nothing reviews.
    const running = this.sessionSignal();
    if (running && running.status === 'ACTIVE') return running;

    const snapshot = this.context.snapshot();
    const session = await firstValueFrom(this.api.startSession(snapshot.patientId, snapshot.locale));
    await this.adopt(session);
    return session;
  }

  /**
   * Takes over a session the server already created — a recorded consultation
   * starts its own, so that its examination phase can stage chart findings —
   * and sets this service up exactly as {@link start} does.
   */
  async adopt(session: VoiceSessionDto): Promise<void> {
    const snapshot = this.context.snapshot();
    this.sessionSignal.set(session);
    this.startedAtSignal.set(Date.now());
    this.summarySignal.set(null);
    this.narrativeSignal.set(null);
    this.narrativeErrorSignal.set(null);
    this.orchestrator.resetBuffer();
    this.context.clearConversation();
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
  }

  // ── Routing the way out ─────────────────────────────────────────────
  //
  // A recorded consultation owns the session it adopted, and ending it is the
  // consultation's business: the review that follows is the consultation's, not
  // the dictated examination's. Rather than teach every path that ends a
  // session (the dock, the header, the spoken "fin de la consultation", the
  // inactivity timeout) about consultations, the consultation takes over `end`
  // and `abandon` while it is open and calls back with `direct: true`.

  private endOverride: ((options: { waitForClips?: boolean }) => Promise<void>) | null = null;
  private abandonOverride: (() => Promise<void>) | null = null;

  setRouting(routing: {
    end: (options: { waitForClips?: boolean }) => Promise<void>;
    abandon: () => Promise<void>;
  } | null): void {
    this.endOverride = routing?.end ?? null;
    this.abandonOverride = routing?.abandon ?? null;
  }

  /**
   * Ends dictation and moves the consultation into review, in place.
   *
   * Nothing is written here. Failing to generate a narrative does not block
   * review — the structured findings are what the record is made of.
   *
   * By default the last sentences are waited for: what was said just before
   * "end" is still being transcribed, and used to be dropped. A spoken "end
   * examination" passes {@code waitForClips: false} — it is being handled by
   * the very queue that would be waited on, and what comes after it in that
   * queue was said after the dentist had finished.
   */
  async end(options: { waitForClips?: boolean; direct?: boolean } = {}): Promise<void> {
    if (this.endOverride && !options.direct) {
      await this.endOverride({ waitForClips: options.waitForClips });
      return;
    }
    const session = this.sessionSignal();
    if (!session || session.status !== 'ACTIVE') return;

    this.clearSessionTimeout();
    this.busySignal.set(true);
    try {
      if (options.waitForClips === false) this.orchestrator.stopListening();
      else await this.orchestrator.finishListening();
      const pending = await firstValueFrom(this.api.completeSession(session.id, {
        status: 'PENDING_REVIEW',
        confirmed: false,
      }));
      this.sessionSignal.set(pending);
      await this.generateNarrative(session.id);
    } finally {
      this.busySignal.set(false);
    }
  }

  /**
   * Requests the narrative. Safe to call repeatedly — the server persists
   * nothing, so the dentist can regenerate after changing what is included.
   *
   * @param includedAuditIds the entries still included at review; omitted,
   *   the narrative covers everything the session staged
   * @param correctedTeeth teeth the dentist changed at review, by audit id, so
   *   the narrative describes the tooth that will be saved
   */
  async generateNarrative(
    sessionId: string,
    includedAuditIds?: string[],
    correctedTeeth?: Record<string, string>,
  ): Promise<void> {
    try {
      const response = await firstValueFrom(this.api.summarizeSession(sessionId, includedAuditIds, correctedTeeth));
      if (response.error) {
        this.narrativeSignal.set(null);
        this.narrativeErrorSignal.set(response.error);
        return;
      }
      this.narrativeSignal.set(response.summary);
      this.narrativeGeneratedSignal.set(response.generated !== false);
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
   * reported rather than swallowed.
   */
  async commit(
    sessionId: string,
    approvedAuditIds: string[],
    rejectedAuditIds: string[],
    summary: string,
    amendments: CommitAmendmentDto[] = [],
  ): Promise<{
    ok: boolean;
    executed: number;
    notReviewed: number;
    failed: { auditId: string; errorMessage: string }[];
  }> {
    this.busySignal.set(true);
    try {
      const result = await firstValueFrom(this.api.commitSession(sessionId, {
        approvedAuditIds,
        rejectedAuditIds,
        amendments,
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
        this.startedAtSignal.set(null);
      }

      return {
        ok: result.failed.length === 0,
        executed: result.executed,
        notReviewed: result.notReviewed ?? 0,
        failed: result.failed.map(f => ({ auditId: f.auditId, errorMessage: f.errorMessage })),
      };
    } finally {
      this.busySignal.set(false);
    }
  }

  /**
   * The session was saved by something other than {@link commit} — a recorded
   * consultation commits the chart findings together with the rest of the
   * record. Clears what this service holds for it, as a normal save does.
   */
  async finishExternally(): Promise<void> {
    const session = this.sessionSignal();
    if (!session) return;
    this.clearSessionTimeout();
    await this.buffer.clear(session.id);
    this.orchestrator.resetBuffer();
    this.context.setSessionId(null);
    this.context.clearConversation();
    this.startedAtSignal.set(null);
    this.sessionSignal.set({ ...session, status: 'COMPLETED' });
  }

  /**
   * Restores an examination interrupted by a crash, a closed tab or leaving
   * the dossier — still dictating, or waiting in review.
   *
   * Offered only for the patient whose dossier is open: resuming Ahmed's
   * half-finished examination while Fatima's chart is on screen is how
   * findings end up on the wrong record.
   */
  async resumeIfAvailable(patientId: string): Promise<ResumableState> {
    const current = this.sessionSignal();
    if (current && current.patientId === patientId && (current.status === 'ACTIVE' || current.status === 'PENDING_REVIEW')) {
      return current.status === 'ACTIVE' ? 'active' : 'review';
    }

    const buffered = await this.buffer.findResumable(patientId);
    if (!buffered) return null;

    try {
      const session = await firstValueFrom(this.api.getSession(buffered.sessionId));
      if (session.status !== 'ACTIVE' && session.status !== 'PENDING_REVIEW') {
        await this.buffer.clear(buffered.sessionId);
        return null;
      }
      this.sessionSignal.set(session);
      this.startedAtSignal.set(buffered.startedAt);
      this.context.setSessionId(session.id);
      this.orchestrator.restoreBuffer(buffered.commands.map(command => ({ ...command })));
      if (session.status === 'ACTIVE') {
        this.armSessionTimeout();
        return 'active';
      }
      if (!this.narrativeSignal()) void this.generateNarrative(session.id);
      return 'review';
    } catch {
      // The session no longer exists server-side; the buffer is orphaned.
      await this.buffer.clear(buffered.sessionId);
      return null;
    }
  }

  /**
   * Lets go of the session in this tab without ending it — the dentist left
   * the dossier. The microphone closes; the buffer and the server session
   * stay, and the dossier offers them back on return.
   */
  detach(): void {
    if (!this.sessionSignal()) return;
    this.clearSessionTimeout();
    this.orchestrator.stopListening();
    this.sessionSignal.set(null);
    this.startedAtSignal.set(null);
    this.orchestrator.resetBuffer();
    this.context.setSessionId(null);
    this.context.clearConversation();
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

  /**
   * Throws the consultation away: nothing staged is written. ABANDONED marks
   * the dictation as not reviewed; the staged audit rows stay PENDING and
   * are never executed.
   */
  async abandon(options: { direct?: boolean } = {}): Promise<void> {
    if (this.abandonOverride && !options.direct) {
      await this.abandonOverride();
      return;
    }
    const session = this.sessionSignal();
    if (!session) return;
    this.clearSessionTimeout();
    this.orchestrator.stopListening();
    try {
      await firstValueFrom(this.api.completeSession(session.id, { status: 'ABANDONED', confirmed: false }));
    } catch {
      // Locally discarded either way; a server session that stays in review
      // is harmless — nothing in it was ever executed.
    }
    await this.buffer.clear(session.id);
    this.orchestrator.resetBuffer();
    this.sessionSignal.set(null);
    this.startedAtSignal.set(null);
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

  /**
   * A short read-back for "show me today's findings". During a buffered
   * session nothing is on the record yet, so this counts what is staged.
   */
  spokenSummary(summary: SessionSummary, language: 'fr' | 'en' = 'en'): string {
    const fr = language === 'fr';
    const staged = this.orchestrator.buffered();
    if (staged.length > 0) {
      const teeth = new Set(staged.map(entry => String(entry.entities['fdi'] ?? '')).filter(Boolean));
      if (fr) {
        return `${staged.length} ${staged.length === 1 ? 'élément dicté' : 'éléments dictés'}, sur ${teeth.size} `
          + `${teeth.size === 1 ? 'dent' : 'dents'}. Tout est affiché à l'écran.`;
      }
      return `${staged.length} ${staged.length === 1 ? 'entry' : 'entries'} dictated, on ${teeth.size} `
        + `${teeth.size === 1 ? 'tooth' : 'teeth'}. Everything is listed on screen.`;
    }
    if (summary.totalFindings === 0 && summary.notes.length === 0) {
      return fr ? 'Rien d\'enregistré pour cet examen.' : 'Nothing recorded in this examination yet.';
    }
    if (fr) {
      const parts: string[] = [];
      if (summary.teeth.length) parts.push(`${summary.teeth.length} ${summary.teeth.length === 1 ? 'dent' : 'dents'} avec constatations`);
      if (summary.treatments.length) parts.push(`${summary.treatments.length} traitements à prévoir`);
      if (summary.allergies.length) parts.push(`${summary.allergies.length} allergies`);
      if (summary.notes.length) parts.push(`${summary.notes.length} notes`);
      return `Pour l'instant : ${parts.join(', ')}. Le détail est à l'écran.`;
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
