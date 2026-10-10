import { InputLanguageService } from './input-language.service';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Observable, Subject, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InvoiceService } from '../../features/billing/services/invoice.service';
import { AuthService, SignOutReason } from '../services/auth.service';
import { ClinicalRecordService } from '../services/clinical-record.service';
import { DentalChartService } from '../services/dental-chart.service';
import { PatientService } from '../services/patient.service';
import { ScheduleService } from '../services/schedule.service';
import { ToastService } from '../services/toast.service';
import { AudioCaptureService } from './audio-capture.service';
import { SessionBufferService } from './session-buffer.service';
import { SpeechFeedbackService } from './speech-feedback.service';
import { SpeechRecognitionService } from './speech-recognition.service';
import { LastWriteRef, VoiceContextSnapshot } from './voice-intent.model';
import { VoiceApiService, RecordVoiceCommandDto, TranscriptionDto } from './voice-api.service';
import { VoiceCommandsService } from './register-voice-commands';
import { VoiceContextService } from './voice-context.service';
import { VoiceOrchestratorService } from './voice-orchestrator.service';
import { VoiceSessionService } from './voice-session.service';

/**
 * The pipeline from a transcript to a staged command, with the network and the
 * microphone replaced by recorders. What these pin down is what reaches the
 * server: which commands are recorded, in which shape, and which are taken
 * back — because staging is the last moment a wrong finding can be stopped
 * before the dentist reads it at review.
 */

class FakeApi {
  recorded: RecordVoiceCommandDto[] = [];
  rejected: string[] = [];
  interpreted = 0;

  recordCommand(entry: RecordVoiceCommandDto) {
    this.recorded.push(entry);
    return of({ ...entry, id: `audit-${this.recorded.length}`, actorId: 'u-1', occurredAt: '', undoneAt: null });
  }

  rejectCommand(id: string) {
    this.rejected.push(id);
    return of({} as never);
  }

  /** What the next clip's transcription does. Defaults to never answering. */
  transcription: () => Observable<TranscriptionDto> = () => new Subject<TranscriptionDto>();
  transcribed = 0;

  transcribe() {
    this.transcribed++;
    return this.transcription();
  }

  interpret() {
    this.interpreted++;
    return of({ intent: null, entities: {}, confidence: 0, clarification: null, resolver: 'llm', provider: 'disabled', error: null });
  }
}

class FakeFeedback {
  spoken: Array<{ text: string; locale: string }> = [];
  voice: 'ok' | 'missing' | 'unknown' = 'ok';
  speak(text: string, locale: string) {
    this.spoken.push({ text, locale });
  }
  enabled() { return true; }
  voiceStatus() { return this.voice; }
  isAudible() {
    return false;
  }
}

class FakeContext {
  lastWrite: LastWriteRef | null = null;
  selected: string | null = null;

  snapshot(): VoiceContextSnapshot {
    return {
      patientId: 'p-1',
      patientName: 'Ahmed El Amrani',
      dentition: 'adult',
      module: 'patient-dossier',
      route: '/patients/p-1',
      selectedFdi: this.selected,
      sessionId: 's-1',
      locale: 'fr-MA',
      recentIntents: [],
      recentUtterances: [],
      lastWrite: this.lastWrite,
    };
  }
  locale() { return 'fr-MA'; }
  dentition() { return 'adult' as const; }
  sessionId() { return 's-1'; }
  selectTooth(fdi: string | null) { this.selected = fdi; }
  rememberUtterance() { /* not needed */ }
  rememberIntent() { /* not needed */ }
  rememberWrite(write: LastWriteRef | null) {
    this.lastWrite = write;
    if (write?.fdi) this.selected = write.fdi;
  }
  clearConversation() { /* not needed */ }
}

/** A microphone whose state the test decides. */
class FakeCapture {
  level = signal(0);
  speaking = signal(false);
  paused = signal(false);
  status = signal<'idle' | 'starting' | 'capturing' | 'suspended' | 'error'>('idle');
  startCalls = 0;
  stopCalls = 0;
  /** Whether asking for the microphone works. */
  startSucceeds = true;
  handler: ((clip: Blob) => void) | null = null;

  isActive() { return ['capturing', 'suspended', 'starting'].includes(this.status()); }
  isSupported() { return true; }
  setUtteranceHandler(handler: (clip: Blob) => void) { this.handler = handler; }
  async start() {
    this.startCalls++;
    if (this.startSucceeds) this.status.set('capturing');
    return this.startSucceeds;
  }
  stop() { this.stopCalls++; this.status.set('idle'); }
  setPaused() { /* not needed */ }
  lastError() { return null; }
  /** The dentist says something; it is closed as a clip and posted. */
  say() { this.handler?.(new Blob(['x'], { type: 'audio/wav' })); }
}

class FakeAuth {
  expiryWarning = signal<number | null>(null);
  isAuthenticated = signal(true);
  private handlers = new Set<(reason: SignOutReason) => void>();
  onSignOut(handler: (reason: SignOutReason) => void) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
  signOut(reason: SignOutReason) { this.handlers.forEach(handler => handler(reason)); }
}

class FakeSession {
  active = true;
  touched = 0;
  isActive() { return this.active; }
  touchSession() { this.touched++; }
}

const recognition = {
  interimTranscript: signal(''),
  status: signal('idle'),
  consented: signal(true),
  isSupported: () => true,
  setResultHandler: () => undefined,
  stop: () => undefined,
  start: () => true,
};

describe('VoiceOrchestratorService — staging what was dictated', () => {
  let orchestrator: VoiceOrchestratorService;
  let api: FakeApi;
  let feedback: FakeFeedback;
  let capture: FakeCapture;
  let auth: FakeAuth;
  let session: FakeSession;
  let toasts: string[];
  let inputLanguage = 'fr';

  const say = (text: string) => orchestrator.handleTranscript(text, 1, null, false);
  /** Something heard in the room, so the wake gate applies. */
  const hear = (text: string) => orchestrator.handleTranscript(text, 1, null, true);
  const entitiesOf = (index: number) => JSON.parse(api.recorded[index].entities) as Record<string, unknown>;

  beforeEach(() => {
    api = new FakeApi();
    feedback = new FakeFeedback();
    capture = new FakeCapture();
    auth = new FakeAuth();
    session = new FakeSession();
    toasts = [];
    inputLanguage = 'fr';
    TestBed.configureTestingModule({
      providers: [
        { provide: VoiceApiService, useValue: api },
        { provide: SpeechFeedbackService, useValue: feedback },
        { provide: VoiceContextService, useClass: FakeContext },
        { provide: InputLanguageService, useValue: { language: () => inputLanguage } },
        { provide: AudioCaptureService, useValue: capture },
        { provide: SpeechRecognitionService, useValue: recognition },
        { provide: SessionBufferService, useValue: { append: async () => undefined, remove: async () => undefined } },
        { provide: ToastService, useValue: { success: () => undefined, info: (m: string) => toasts.push(m), error: () => undefined } },
        { provide: VoiceSessionService, useValue: session },
        { provide: AuthService, useValue: auth },
        // Only reached from inside command callbacks these tests never run.
        { provide: ClinicalRecordService, useValue: {} },
        { provide: DentalChartService, useValue: {} },
        { provide: PatientService, useValue: {} },
        { provide: ScheduleService, useValue: {} },
        { provide: InvoiceService, useValue: {} },
      ],
    });
    orchestrator = TestBed.inject(VoiceOrchestratorService);
    TestBed.inject(VoiceCommandsService).registerAll();
  });

  describe('a correction ("non, en fait…")', () => {
    it('replaces the staged entry instead of retracting anything on the record', async () => {
      await say('dent 16 carie');
      expect(orchestrator.buffered().map(entry => entry.auditId)).toEqual(['audit-1']);

      await say('non, en fait couronne à remplacer');

      // The replacement is staged as an ordinary addFindings row. The old
      // audit row's id is not a finding id, so it must not be sent as one —
      // that is what failed the correction at save.
      expect(api.recorded[1].intent).toBe('clinical.addFindings');
      expect(entitiesOf(1)['retractIds']).toBeUndefined();
      expect(entitiesOf(1)['fdi']).toBe('16');
      expect((entitiesOf(1)['findings'] as Array<{ code: string }>).map(f => f.code))
        .toEqual(['crown_replacement_required']);

      // The entry it corrected is taken out, both in the buffer and on the server.
      expect(api.rejected).toEqual(['audit-1']);
      expect(orchestrator.buffered().map(entry => entry.auditId)).toEqual(['audit-2']);
      expect(feedback.spoken.at(-1)?.text).toMatch(/^Corrigé\./);
    });

    it('changes nothing when the entry it would correct is already gone', async () => {
      await say('dent 16 carie');
      await orchestrator.discardBuffered('audit-1');
      api.rejected.length = 0;

      await say('non, en fait couronne à remplacer');

      expect(api.recorded).toHaveLength(1);
      expect(api.rejected).toEqual([]);
      expect(orchestrator.buffered()).toEqual([]);
      expect(feedback.spoken.at(-1)?.text).toBe('Rien à corriger.');
    });
  });

  describe('one utterance naming two teeth', () => {
    it('stages one command per tooth, each with its own findings', async () => {
      await say('dent 16 carie et dent 17 couronne');

      expect(api.recorded.map(entry => entry.intent)).toEqual(['clinical.addFindings', 'clinical.addFindings']);
      expect(entitiesOf(0)['fdi']).toBe('16');
      expect(entitiesOf(1)['fdi']).toBe('17');
      expect((entitiesOf(0)['findings'] as Array<{ code: string }>).map(f => f.code)).toEqual(['caries']);
      expect((entitiesOf(1)['findings'] as Array<{ code: string }>).map(f => f.code)).toEqual(['existing_crown']);
      expect(orchestrator.buffered()).toHaveLength(2);
    });

    it('reads both back in one answer, because each spoken line interrupts the last', async () => {
      await say('dent 16 carie et dent 17 couronne');

      expect(feedback.spoken).toHaveLength(1);
      expect(feedback.spoken[0].text).toContain('Dent 16');
      expect(feedback.spoken[0].text).toContain('Dent 17');
    });

    it('undoes both together', async () => {
      await say('dent 16 carie et dent 17 couronne');

      await orchestrator.undoLast();

      expect(api.rejected.sort()).toEqual(['audit-1', 'audit-2']);
      expect(orchestrator.buffered()).toEqual([]);
    });

    it('asks rather than guess when the findings cannot be split between the teeth', async () => {
      await say('dent 16 carie et 17');

      expect(api.recorded.filter(entry => entry.intent === 'clinical.addFindings')).toEqual([]);
      expect(orchestrator.clarification()?.question).toMatch(/more than one tooth/i);
    });
  });

  describe('a negation', () => {
    it('is never staged as the finding it denies', async () => {
      await say('dent 16 pas de carie');

      expect(api.recorded).toHaveLength(1);
      expect(api.recorded[0].intent).toBe('clinical.addNote');
      expect(entitiesOf(0)['content']).toBe('dent 16 pas de carie');
      expect(entitiesOf(0)['fdi']).toBe('16');
    });

    it('is read back with its words, so the dentist hears what was filed', async () => {
      await say('dent 16 pas de carie');

      expect(feedback.spoken.at(-1)?.text).toBe('Note sur la dent 16 : dent 16 pas de carie.');
    });

    it('is never staged as an allergy', async () => {
      await say('le patient n\'est pas allergique à la pénicilline');

      expect(api.recorded.map(entry => entry.intent)).toEqual(['clinical.addNote']);
      expect(entitiesOf(0)['substance']).toBeUndefined();
    });
  });

  // ── The follow-up window ───────────────────────────────────────────

  describe('speech heard in the follow-up window', () => {
    beforeEach(async () => {
      // A staged dictation opens the window and leaves tooth 16 selected.
      await say('dent 16 carie');
      feedback.spoken.length = 0;
    });

    const CHATTER = [
      'oui docteur c\'est douloureux',
      'c\'est sensible au froid',
      'j\'ai une carie ?',
      'vous avez une infection ?',
      'il faudra une couronne',
      'ouvrez grand',
      'vous avez mal depuis quand',
    ];

    for (const sentence of CHATTER) {
      it(`does not stage, speak or interpret "${sentence}"`, async () => {
        await hear(sentence);

        expect(api.recorded).toHaveLength(1);
        expect(feedback.spoken).toEqual([]);
        expect(api.interpreted).toBe(0);
        expect(orchestrator.ignoredUtterance()).toBe(sentence);
      });
    }

    it('still takes a further finding said by itself', async () => {
      await hear('carie profonde');

      expect(api.recorded).toHaveLength(2);
      expect(entitiesOf(1)['fdi']).toBe('16');
      expect((entitiesOf(1)['findings'] as Array<{ code: string }>).map(f => f.code)).toEqual(['deep_caries']);
    });

    it('takes "et une fracture" as a continuation', async () => {
      await hear('et une fracture');

      expect((entitiesOf(1)['findings'] as Array<{ code: string }>).map(f => f.code)).toEqual(['fracture']);
    });
  });

  describe('"Pas compris." — an answer for someone who asked', () => {
    it('is spoken after the wake word, and the language model is consulted', async () => {
      await hear('Calypso, ouvrez grand');

      expect(feedback.spoken.at(-1)?.text).toBe('Pas compris.');
      expect(api.interpreted).toBe(1);
    });

    it('is spoken for a typed command that was not understood', async () => {
      await say('ouvrez grand');

      expect(feedback.spoken.at(-1)?.text).toBe('Pas compris.');
    });

    it('is never spoken for room speech outside the window', async () => {
      await hear('ouvrez grand');

      expect(feedback.spoken).toEqual([]);
      expect(api.interpreted).toBe(0);
      expect(orchestrator.ignoredUtterance()).toBe('ouvrez grand');
    });

    it('keeps the examination open when only the wake word is said', async () => {
      await hear('Calypso');

      expect(session.touched).toBe(1);
      expect(feedback.spoken).toEqual([]);
    });
  });

  // ── Being told, without looking ────────────────────────────────────

  describe('pausing by voice', () => {
    beforeEach(async () => {
      await orchestrator.startExaminationMode();
      feedback.spoken.length = 0;
    });

    it('stops acting on anything but the way back', async () => {
      await hear('Calypso, pause');
      expect(orchestrator.paused()).toBe(true);
      expect(orchestrator.pausedByVoice()).toBe(true);
      expect(feedback.spoken.at(-1)?.text).toBe('En pause. Dites Calypso, reprends.');

      // Dictation that would normally need no wake word, and a command that does.
      await hear('dent 16 carie');
      await hear('Calypso, dent 26 fracture');
      await hear('Calypso, ajoute une allergie à la pénicilline');

      expect(api.recorded).toEqual([]);
      expect(orchestrator.buffered()).toEqual([]);
    });

    it('says nothing while it is ignoring speech', async () => {
      await hear('Calypso, pause');
      feedback.spoken.length = 0;

      await hear('dent 16 carie');
      await hear('ouvrez grand');

      expect(feedback.spoken).toEqual([]);
    });

    it('needs the wake word to resume: a bare "reprends" from the room does not', async () => {
      await hear('Calypso, pause');

      await hear('reprends');
      expect(orchestrator.paused()).toBe(true);

      await hear('Calypso, reprends');
      expect(orchestrator.paused()).toBe(false);
      expect(feedback.spoken.at(-1)?.text).toBe('Reprise.');
    });

    it('takes dictation again once resumed', async () => {
      await hear('Calypso, pause');
      await hear('Calypso, reprends');

      await hear('Calypso, dent 16 carie');

      expect(api.recorded.map(entry => entry.intent)).toEqual(['clinical.addFindings']);
    });

    it('does not pause on a pause that was not asked of the system', async () => {
      await hear('faites une pause de dix minutes');
      await hear('pause');

      expect(orchestrator.paused()).toBe(false);
    });

    it('can still be ended by voice while paused', async () => {
      let ended = 0;
      orchestrator.sessionHooks = {
        start: async () => undefined,
        end: async () => { ended++; },
        summary: async () => undefined,
      };
      await hear('Calypso, pause');

      await hear('fin de l\'examen');

      expect(ended).toBe(1);
    });

    it('is undone by the pause button too, and by stopping', async () => {
      await hear('Calypso, pause');
      orchestrator.setPaused(false);
      expect(orchestrator.pausedByVoice()).toBe(false);

      await hear('Calypso, pause');
      orchestrator.stopListening();
      expect(orchestrator.pausedByVoice()).toBe(false);
    });

    it('counts as the dentist being there, so the examination is not closed as idle', async () => {
      const before = session.touched;

      await hear('Calypso, pause');
      await hear('Calypso, reprends');

      expect(session.touched).toBe(before + 2);
    });
  });

  describe('a machine that cannot read French aloud', () => {
    it('warns on screen when no voice speaks the language', async () => {
      feedback.voice = 'missing';

      await orchestrator.startExaminationMode();

      expect(orchestrator.audioWarning()).toBe('no-voice');
    });

    it('does not warn when a voice exists or it is not yet known', async () => {
      await orchestrator.startExaminationMode();
      expect(orchestrator.audioWarning()).toBeNull();

      orchestrator.stopListening();
      feedback.voice = 'unknown';
      await orchestrator.startExaminationMode();
      expect(orchestrator.audioWarning()).toBeNull();
    });
  });

  describe('a reading the system is unsure of', () => {
    const UNSURE = 0.5;

    it('is read back and held for a yes, not staged', async () => {
      await orchestrator.handleTranscript('dent 16 carie', UNSURE, null, false);

      expect(api.recorded).toEqual([]);
      expect(orchestrator.buffered()).toEqual([]);
      expect(orchestrator.confirmation()?.reason).toBe('low-confidence');
      expect(feedback.spoken.at(-1)?.text).toMatch(/^Dent 16 : carie\./);
      expect(feedback.spoken.at(-1)?.text).toContain('Je ne suis pas sûr');
    });

    it('is staged once the dentist says yes, like any other dictation', async () => {
      await orchestrator.handleTranscript('dent 16 carie', UNSURE, null, false);

      await say('oui');

      expect(api.recorded.map(entry => entry.intent)).toEqual(['clinical.addFindings']);
      expect(api.recorded[0].confirmationStatus).toBe('PENDING');
      expect(orchestrator.buffered()).toHaveLength(1);
      expect(orchestrator.confirmation()).toBeNull();
    });

    it('is dropped on a no, leaving a trail that it was asked and declined', async () => {
      await orchestrator.handleTranscript('dent 16 carie', UNSURE, null, false);

      await say('non');

      expect(orchestrator.buffered()).toEqual([]);
      // Recorded as the question it was, never as the write it would have been:
      // the server accepts a write only as a PENDING row.
      expect(api.recorded).toHaveLength(1);
      expect(api.recorded[0].intent).toBe('clarification');
      expect(api.recorded[0].riskTier).toBe('SAFE');
      expect(api.recorded[0].confirmationStatus).toBe('REJECTED');
      expect(api.recorded.some(entry => entry.intent === 'clinical.addFindings')).toBe(false);
    });

    it('is replaced, and logged as cancelled, by a new command', async () => {
      await orchestrator.handleTranscript('dent 16 carie', UNSURE, null, false);

      await say('dent 26 fracture');

      const intents = api.recorded.map(entry => `${entry.intent}/${entry.confirmationStatus}`);
      expect(intents).toContain('clarification/CANCELLED');
      expect(intents).toContain('clinical.addFindings/PENDING');
      expect(orchestrator.buffered()).toHaveLength(1);
    });

    it('does not hold a confident reading', async () => {
      await orchestrator.handleTranscript('dent 16 carie', 0.95, null, false);

      expect(orchestrator.confirmation()).toBeNull();
      expect(orchestrator.buffered()).toHaveLength(1);
    });
  });

  describe('a question nobody answers', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    const said = () => feedback.spoken.map(s => s.text);

    it('is withdrawn after a while, and the dentist is told', async () => {
      await orchestrator.handleTranscript('dent 16 carie', 0.5, null, false);
      TestBed.tick();
      feedback.spoken.length = 0;

      await vi.advanceTimersByTimeAsync(24_000);
      expect(orchestrator.confirmation()).not.toBeNull();
      await vi.advanceTimersByTimeAsync(2_000);

      expect(orchestrator.confirmation()).toBeNull();
      expect(said()).toEqual(['Question annulée.']);
      expect(orchestrator.buffered()).toEqual([]);
    });

    it('does not let a late "ok" from the room confirm it', async () => {
      await orchestrator.handleTranscript('dent 16 carie', 0.5, null, false);
      TestBed.tick();
      await vi.advanceTimersByTimeAsync(26_000);

      await hear('ok');

      expect(orchestrator.buffered()).toEqual([]);
      expect(api.recorded.some(entry => entry.intent === 'clinical.addFindings')).toBe(false);
    });

    it('withdraws a question that wants a spoken answer, rather than catching the next thing said', async () => {
      await say('dent 16 carie et 17');
      TestBed.tick();
      expect(orchestrator.clarification()).not.toBeNull();
      feedback.spoken.length = 0;

      await vi.advanceTimersByTimeAsync(26_000);

      expect(orchestrator.clarification()).toBeNull();
      expect(said()).toEqual(['Question annulée.']);
    });

    it('is left open while it is being answered', async () => {
      await orchestrator.handleTranscript('dent 16 carie', 0.5, null, false);
      TestBed.tick();
      await vi.advanceTimersByTimeAsync(20_000);

      await say('oui');
      TestBed.tick();
      feedback.spoken.length = 0;
      await vi.advanceTimersByTimeAsync(30_000);

      expect(said()).not.toContain('Question annulée.');
      expect(orchestrator.buffered()).toHaveLength(1);
    });
  });

  describe('the microphone', () => {
    beforeEach(async () => {
      vi.useFakeTimers();
      await orchestrator.startExaminationMode();
      TestBed.tick();
      feedback.spoken.length = 0;
    });
    afterEach(() => vi.useRealTimers());

    const said = () => feedback.spoken.map(s => s.text);

    it('is asked for again when it is taken away, without anyone touching anything', async () => {
      capture.status.set('error');
      TestBed.tick();

      await vi.advanceTimersByTimeAsync(2_500);

      expect(capture.startCalls).toBeGreaterThanOrEqual(2);
      expect(capture.status()).toBe('capturing');
      // Back before it was worth interrupting anyone: nothing was said.
      await vi.advanceTimersByTimeAsync(5_000);
      TestBed.tick();
      expect(said()).toEqual([]);
    });

    it('is announced when it cannot be recovered, and again until it is', async () => {
      capture.startSucceeds = false;
      capture.status.set('error');
      TestBed.tick();

      await vi.advanceTimersByTimeAsync(3_500);
      expect(said()).toEqual(['Le micro est déconnecté. Je ne vous entends plus.']);

      await vi.advanceTimersByTimeAsync(25_000);
      expect(said()).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(25_000);
      expect(said()).toHaveLength(3);
    });

    it('says when it is back, once it has been announced as gone', async () => {
      capture.startSucceeds = false;
      capture.status.set('error');
      TestBed.tick();
      await vi.advanceTimersByTimeAsync(3_500);
      feedback.spoken.length = 0;

      capture.status.set('capturing');
      TestBed.tick();

      expect(said()).toEqual(['Micro rétabli.']);
      // And the alarm stops.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(said()).toEqual(['Micro rétabli.']);
    });

    it('is announced when the system suspends it, after a moment to resume by itself', async () => {
      capture.status.set('suspended');
      TestBed.tick();

      await vi.advanceTimersByTimeAsync(2_000);
      expect(said()).toEqual([]);
      await vi.advanceTimersByTimeAsync(1_500);
      expect(said()).toEqual(['Le micro est suspendu. Je ne vous entends plus.']);
    });

    it('says nothing when no examination is being dictated', async () => {
      orchestrator.stopListening();
      TestBed.tick();
      feedback.spoken.length = 0;

      capture.status.set('error');
      TestBed.tick();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(said()).toEqual([]);
    });
  });

  describe('a speech service that loses what was said', () => {
    beforeEach(async () => {
      vi.useFakeTimers();
      await orchestrator.startExaminationMode();
      feedback.spoken.length = 0;
    });
    afterEach(() => vi.useRealTimers());

    const failWith = (error: unknown) => {
      api.transcription = () => throwError(() => error);
      capture.say();
      return vi.advanceTimersByTimeAsync(0);
    };
    const said = () => feedback.spoken.map(s => s.text);

    it('tells the dentist at the first lost sentence, not the second', async () => {
      await failWith({ status: 500 });

      expect(said()).toEqual(['La reconnaissance vocale ne répond pas. Répétez.']);
    });

    it('tells them again, but not for every sentence in a burst', async () => {
      await failWith({ status: 500 });
      await failWith({ status: 500 });
      expect(said()).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(9_000);
      await failWith({ status: 500 });
      expect(said()).toHaveLength(2);
    });

    it('says so when there is no connection', async () => {
      await failWith({ status: 0 });

      expect(said()).toEqual(['Pas de connexion. Je n\'ai pas pu vous entendre. Répétez quand elle revient.']);
    });

    it('says the account is being rationed, not that the connection is bad', async () => {
      await failWith({ status: 429 });

      expect(said()).toEqual(['Trop d\'enregistrements d\'un coup. Attendez un instant, puis répétez.']);
      expect(orchestrator.transcriptionIssue()).toMatch(/Too many recordings/);
    });

    it('leaves an expired login to the sign-out message rather than blaming the speech service', async () => {
      await failWith({ status: 401 });

      expect(said()).toEqual([]);
    });

    it('stops the alarm once a sentence is heard again', async () => {
      await failWith({ status: 500 });
      api.transcription = () => of({ text: '', provider: 'p', model: 'm', language: 'fr', durationSeconds: 1, error: null });
      capture.say();
      await vi.advanceTimersByTimeAsync(0);

      expect(orchestrator.transcriptionIssue()).toBeNull();
    });
  });

  describe('ending an examination', () => {
    beforeEach(async () => {
      vi.useFakeTimers();
      await orchestrator.startExaminationMode();
      feedback.spoken.length = 0;
    });
    afterEach(() => vi.useRealTimers());

    const heard = (text: string): TranscriptionDto =>
      ({ text, provider: 'p', model: 'm', language: 'fr', durationSeconds: 1, error: null });

    it('waits for the sentence still being transcribed, so the last finding is kept', async () => {
      const answer = new Subject<TranscriptionDto>();
      api.transcription = () => answer;
      capture.say();
      expect(orchestrator.pendingTranscriptions()).toBe(1);

      let finished = false;
      const done = orchestrator.finishListening().then(() => { finished = true; });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(finished).toBe(false);

      answer.next(heard('dent 16 carie profonde'));
      answer.complete();
      await done;

      // Staged into the examination, which was still open while it was waited for.
      expect(api.recorded.map(entry => entry.intent)).toEqual(['clinical.addFindings']);
      expect(orchestrator.examinationMode()).toBe(false);
    });

    it('does not wait for ever, and says what may have been lost', async () => {
      api.transcription = () => new Subject<TranscriptionDto>();
      capture.say();

      const done = orchestrator.finishListening(2_000);
      await vi.advanceTimersByTimeAsync(2_500);
      await done;

      expect(feedback.spoken.at(-1)?.text).toBe('Votre dernière phrase n\'a pas pu être ajoutée. Vérifiez à l\'écran.');
      expect(orchestrator.examinationMode()).toBe(false);
    });

    it('returns at once when nothing is in flight', async () => {
      await orchestrator.finishListening();

      expect(orchestrator.examinationMode()).toBe(false);
      expect(feedback.spoken).toEqual([]);
    });

    it('tells the dentist what was not added when it arrives after the examination closed', async () => {
      const answer = new Subject<TranscriptionDto>();
      api.transcription = () => answer;
      capture.say();
      session.active = false;

      answer.next(heard('dent 16 carie profonde'));
      answer.complete();
      await vi.advanceTimersByTimeAsync(0);

      expect(api.recorded).toEqual([]);
      expect(toasts).toEqual(['Not added — the examination had already ended: “dent 16 carie profonde”']);
    });

    it('does not fuss about room conversation that arrives after the end', async () => {
      const answer = new Subject<TranscriptionDto>();
      api.transcription = () => answer;
      capture.say();
      session.active = false;

      answer.next(heard('merci docteur, à bientôt'));
      answer.complete();
      await vi.advanceTimersByTimeAsync(0);

      expect(toasts).toEqual([]);
    });
  });

  describe('the login', () => {
    beforeEach(async () => {
      await orchestrator.startExaminationMode();
      feedback.spoken.length = 0;
    });

    it('closes the microphone and says why when the session expires mid-examination', () => {
      auth.signOut('expired');

      expect(capture.stopCalls).toBeGreaterThan(0);
      expect(orchestrator.examinationMode()).toBe(false);
      expect(feedback.spoken.map(s => s.text)).toEqual(['Votre connexion a expiré. Reconnectez-vous : votre examen est conservé.']);
    });

    it('closes the microphone without a word when the dentist signs out', () => {
      auth.signOut('user');

      expect(orchestrator.examinationMode()).toBe(false);
      expect(feedback.spoken).toEqual([]);
    });

    it('speaks the minutes left when the session is about to end and cannot be extended', () => {
      auth.expiryWarning.set(10);
      TestBed.tick();

      expect(feedback.spoken.map(s => s.text)).toEqual([
        'Votre connexion expire dans 10 minutes. Terminez l\'examen, puis reconnectez-vous.',
      ]);
    });

    it('does not interrupt when nothing is being dictated', () => {
      orchestrator.stopListening();
      feedback.spoken.length = 0;

      auth.expiryWarning.set(5);
      TestBed.tick();

      expect(feedback.spoken).toEqual([]);
    });
  });

  describe('a recorded consultation listening in', () => {
    const transcribedAs = (text: string): TranscriptionDto =>
      ({ text, provider: 'p', model: 'm', language: 'fr', durationSeconds: 1, error: null });

    /** One clip said and transcribed, with the session left open and every promise settled. */
    async function spoken(text: string): Promise<void> {
      api.transcription = () => of(transcribedAs(text));
      capture.say();
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    let heard: string[];

    beforeEach(async () => {
      heard = [];
      orchestrator.setTranscriptListener(text => heard.push(text));
      await orchestrator.startExaminationMode();
      feedback.spoken.length = 0;
    });

    it('tells the listener everything transcribed, including what is not addressed to the system', async () => {
      await spoken('Bonjour docteur, j\'ai mal à une dent');

      expect(heard).toEqual(['Bonjour docteur, j\'ai mal à une dent']);
      // ...and the wake gate still ignored it as a command
      expect(api.recorded).toEqual([]);
      expect(orchestrator.ignoredUtterance()).toBe('Bonjour docteur, j\'ai mal à une dent');
    });

    it('does not stop the command pipeline: a dictated finding is both kept and staged', async () => {
      await spoken('dent 16 carie');

      expect(heard).toEqual(['dent 16 carie']);
      expect(api.recorded.map(entry => entry.intent)).toEqual(['clinical.addFindings']);
    });

    it('in conversation-only mode keeps what is said and runs none of it as a command', async () => {
      orchestrator.setConversationOnly(true);

      await spoken('dent 16 carie');

      expect(heard).toEqual(['dent 16 carie']);
      expect(api.recorded).toEqual([]);
      expect(orchestrator.buffered()).toEqual([]);
      expect(orchestrator.conversationOnly()).toBe(true);
    });

    it('goes back to commands when conversation-only is switched off', async () => {
      orchestrator.setConversationOnly(true);
      await spoken('dent 16 carie');
      orchestrator.setConversationOnly(false);

      await spoken('dent 17 couronne');

      expect(heard).toEqual(['dent 16 carie', 'dent 17 couronne']);
      expect(api.recorded).toHaveLength(1);
      expect(entitiesOf(0)['fdi']).toBe('17');
    });

    it('is not told about a clip that arrives after the session closed', async () => {
      session.active = false;

      await spoken('Bonjour docteur');

      expect(heard).toEqual([]);
    });

    it('is told nothing once it has stopped listening', async () => {
      orchestrator.setTranscriptListener(null);

      await spoken('Bonjour docteur');

      expect(heard).toEqual([]);
    });

    it('lets a consultation open the microphone without announcing a dictation session to the room', async () => {
      orchestrator.stopListening();
      feedback.spoken.length = 0;

      await orchestrator.startExaminationMode({ announce: false });

      expect(feedback.spoken).toEqual([]);
      expect(orchestrator.examinationMode()).toBe(true);
    });

    it('still announces by default, as a dictated examination always did', async () => {
      orchestrator.stopListening();
      feedback.spoken.length = 0;

      await orchestrator.startExaminationMode();

      expect(feedback.spoken).toHaveLength(1);
    });
  });

  describe('dictation language', () => {
    it('ignores speech in another language than the one chosen, and counts it', async () => {
      await hear('المريض ينتظر في الخارج');

      expect(orchestrator.languageNoiseCount()).toBe(1);
      expect(orchestrator.ignoredUtterance()).toBe('المريض ينتظر في الخارج');
      expect(api.recorded).toEqual([]);
    });

    it('keeps speech in the chosen language, with or without a wake word', async () => {
      await hear('dent seize carie mésiale');

      expect(orchestrator.languageNoiseCount()).toBe(0);
    });

    it('follows a different chosen language', async () => {
      inputLanguage = 'ar';

      await hear('the patient is waiting outside the room');

      expect(orchestrator.languageNoiseCount()).toBe(1);
    });

    it('never filters a command that was typed rather than heard', async () => {
      await say('المريض ينتظر في الخارج');

      expect(orchestrator.languageNoiseCount()).toBe(0);
    });

    it('starts counting again with each session', async () => {
      await hear('المريض ينتظر في الخارج');
      orchestrator.stopListening();

      await orchestrator.startExaminationMode({ announce: false });

      expect(orchestrator.languageNoiseCount()).toBe(0);
    });
  });
});
