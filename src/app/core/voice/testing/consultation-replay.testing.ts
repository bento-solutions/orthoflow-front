import { Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { InvoiceService } from '../../../features/billing/services/invoice.service';
import { AuthService } from '../../services/auth.service';
import { ClinicalRecordService } from '../../services/clinical-record.service';
import { DentalChartService } from '../../services/dental-chart.service';
import { PatientService } from '../../services/patient.service';
import { ScheduleService } from '../../services/schedule.service';
import { ToastService } from '../../services/toast.service';
import { AudioCaptureService } from '../audio-capture.service';
import { InputLanguageService } from '../input-language.service';
import { VoiceCommandsService } from '../register-voice-commands';
import { SessionBufferService } from '../session-buffer.service';
import { SpeechFeedbackService } from '../speech-feedback.service';
import { SpeechRecognitionService } from '../speech-recognition.service';
import { VoiceApiService } from '../voice-api.service';
import { VoiceContextService } from '../voice-context.service';
import { BufferedEntry, VoiceOrchestratorService } from '../voice-orchestrator.service';
import { VoiceSessionService } from '../voice-session.service';
import {
  FAKE_RECOGNITION, FakeAudioCapture, FakeAuth, FakeSpeechFeedback, FakeVoiceApi, FakeVoiceContext, FakeVoiceSession,
} from './voice-fakes.testing';

/**
 * Replays a consultation, sentence by sentence, through the real
 * {@link VoiceOrchestratorService} — the gate, the grammar, the repairs, the
 * corrections and the staging — with the server, the loudspeaker and the
 * microphone replaced by recorders, and the clock set to each sentence's time.
 *
 * It is what turns a bad session into a test: a session that lost findings is
 * replayed, the spec asserts what each sentence should have done, and the fix
 * is the one that makes the spec pass.
 */

export interface ReplayLine {
  /** "22:41:28" — the time the sentence was heard. */
  time: string;
  text: string;
}

/** One finding staged, as "tooth:code" or "tooth:code@surface". */
export type StagedFinding = string;

export interface ReplayRow {
  time: string;
  text: string;
  /**
   * What became of the sentence: acted on, kept as conversation ("heard"),
   * not understood, a question asked back, or a control (wake word, ending).
   */
  verdict: string | null;
  /** Findings this sentence staged. */
  staged: StagedFinding[];
  /** Audit rows this sentence took back. */
  rejected: string[];
  /** Commands that ran (SAFE, executed): "ui.show", "help.show"… */
  ran: string[];
  /** Server intents staged as PENDING by this sentence. */
  stagedIntents: string[];
  /** What would have been said aloud. */
  spoken: string[];
  /** What the stage shows after it, once there is a stage. */
  view: string | null;
  /** Calls to the language-model fallback this sentence caused. */
  nluCalls: number;
  /** The consultation was ended by it. */
  ended: boolean;
}

export interface ReplayResult {
  rows: ReplayRow[];
  /** The staged buffer at the end, as findings. */
  finalFindings: StagedFinding[];
  /** Every server intent staged and still in the buffer at the end. */
  finalIntents: string[];
  byTime(time: string): ReplayRow;
}

export interface ReplayOptions {
  /** The day the session took place, for the clock. */
  date?: string;
  /** Services a later work package adds to the pipeline, keyed by their token. */
  providers?: Provider[];
  /** Reads what the stage shows, once there is a stage. */
  view?: () => string | null;
  /** Reads a sentence's verdict when the pipeline reports one itself. */
  verdictOf?: (index: number) => string | null;
  /** Called once the pipeline is set up, before the first sentence. */
  setUp?: (orchestrator: VoiceOrchestratorService) => void;
}

function findingsOf(entry: BufferedEntry): StagedFinding[] {
  const fdi = String(entry.entities['fdi'] ?? '?');
  const findings = Array.isArray(entry.entities['findings'])
    ? entry.entities['findings'] as Array<{ code?: string; surface?: string | null }>
    : [];
  return findings.map(f => `${fdi}:${f.code}${f.surface ? `@${f.surface}` : ''}`);
}

/** The test bed the pipeline runs in, shared by the replay and the specs that want the same fakes. */
export function voicePipelineProviders(fakes: {
  api: FakeVoiceApi; feedback: FakeSpeechFeedback; capture: FakeAudioCapture; auth: FakeAuth; session: FakeVoiceSession;
  language?: { value: string };
}): Provider[] {
  const language = fakes.language ?? { value: 'fr' };
  return [
    { provide: VoiceApiService, useValue: fakes.api },
    { provide: SpeechFeedbackService, useValue: fakes.feedback },
    { provide: VoiceContextService, useClass: FakeVoiceContext },
    {
      provide: InputLanguageService,
      useValue: {
        language: () => language.value,
        locale: () => ({ fr: 'fr-MA', en: 'en-US', ar: 'ar-MA' } as Record<string, string>)[language.value],
        set: (value: string) => { language.value = value; },
      },
    },
    { provide: AudioCaptureService, useValue: fakes.capture },
    { provide: SpeechRecognitionService, useValue: FAKE_RECOGNITION },
    { provide: SessionBufferService, useValue: { append: async () => undefined, remove: async () => undefined } },
    { provide: ToastService, useValue: { success: () => undefined, info: () => undefined, error: () => undefined } },
    { provide: VoiceSessionService, useValue: fakes.session },
    { provide: AuthService, useValue: fakes.auth },
    { provide: ClinicalRecordService, useValue: {} },
    { provide: DentalChartService, useValue: {} },
    { provide: PatientService, useValue: { currentPatient: () => ({ id: 'p-1', firstName: 'Ahmed', lastName: 'El Amrani' }) } },
    { provide: ScheduleService, useValue: {} },
    { provide: InvoiceService, useValue: {} },
  ];
}

/**
 * Runs `lines` through the pipeline. Uses fake timers for its whole length and
 * leaves the real ones in place afterwards.
 */
export async function replayConsultation(lines: ReplayLine[], options: ReplayOptions = {}): Promise<ReplayResult> {
  const date = options.date ?? '2026-11-10';
  const api = new FakeVoiceApi();
  const feedback = new FakeSpeechFeedback();
  const capture = new FakeAudioCapture();
  const auth = new FakeAuth();
  const session = new FakeVoiceSession();

  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date(`${date}T${lines[0]?.time ?? '09:00:00'}`));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [...voicePipelineProviders({ api, feedback, capture, auth, session }), ...(options.providers ?? [])],
    });
    const orchestrator = TestBed.inject(VoiceOrchestratorService);
    TestBed.inject(VoiceCommandsService).registerAll();

    let ended = false;
    orchestrator.sessionHooks = {
      start: async () => undefined,
      end: async () => { ended = true; },
      summary: async () => undefined,
    };
    // As a consultation does: the conversation is told every sentence first.
    orchestrator.setTranscriptListener(() => undefined);
    options.setUp?.(orchestrator);

    const rows: ReplayRow[] = [];
    let previous = Date.now();
    for (const [index, line] of lines.entries()) {
      const at = new Date(`${date}T${line.time}`).getTime();
      if (at > previous) await vi.advanceTimersByTimeAsync(at - previous);
      previous = Math.max(previous, at);
      TestBed.tick();

      const before = new Set(orchestrator.buffered().map(entry => entry.auditId));
      const recordedBefore = api.recorded.length;
      const rejectedBefore = api.rejected.length;
      const spokenBefore = feedback.spoken.length;
      const nluBefore = api.interpreted;
      ended = false;

      await orchestrator.simulateHeard(line.text);
      await vi.advanceTimersByTimeAsync(0);
      TestBed.tick();

      const added = orchestrator.buffered().filter(entry => !before.has(entry.auditId));
      const newRows = api.recorded.slice(recordedBefore);
      const spoken = feedback.spoken.slice(spokenBefore).map(s => s.text);
      const rejected = api.rejected.slice(rejectedBefore);
      const ran = newRows.filter(row => row.outcome === 'EXECUTED').map(row => row.intent);
      const stagedIntents = newRows.filter(row => row.confirmationStatus === 'PENDING' && row.riskTier === 'CONFIRM').map(row => row.intent);
      const staged = added.flatMap(findingsOf);

      rows.push({
        time: line.time,
        text: line.text,
        verdict: options.verdictOf?.(index) ?? derivedVerdict(orchestrator, line.text, {
          acted: added.length > 0 || rejected.length > 0 || ran.length > 0,
          ended,
          spoken,
        }),
        staged,
        rejected,
        ran,
        stagedIntents,
        spoken,
        view: options.view?.() ?? null,
        nluCalls: api.interpreted - nluBefore,
        ended,
      });
    }

    const final = orchestrator.buffered();
    return {
      rows,
      finalFindings: final.flatMap(findingsOf),
      finalIntents: final.map(entry => entry.intent),
      byTime(time: string) {
        const row = rows.find(candidate => candidate.time === time);
        if (!row) throw new Error(`No line at ${time}`);
        return row;
      },
    };
  } finally {
    vi.useRealTimers();
  }
}

/**
 * The verdict, read off the pipeline's signals, for a pipeline that does not
 * report one itself yet.
 */
function derivedVerdict(
  orchestrator: VoiceOrchestratorService,
  text: string,
  seen: { acted: boolean; ended: boolean; spoken: string[] },
): string {
  if (seen.ended) return 'control';
  if (seen.acted) return 'acted';
  if (orchestrator.clarification() || orchestrator.confirmation()) return 'question';
  if (seen.spoken.some(line => /^Pas compris|^Not understood/u.test(line))) return 'unsure';
  if (orchestrator.ignoredUtterance() === text.trim()) return 'heard';
  return 'control';
}
