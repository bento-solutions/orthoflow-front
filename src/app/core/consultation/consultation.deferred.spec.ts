import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsultationApiService } from './consultation-api.service';
import { ConsultationAnalysis, ConsultationService, LINE_SAVE_DEBOUNCE_MS } from './consultation.service';
import { ConsultationDraftDto, ConsultationDto, ConsultationLinePayload, ConsultationStatus } from './consultation.model';
import { ConsultationRecorderService } from './consultation-recorder.service';
import { VoiceApiService } from '../voice/voice-api.service';
import { IntakeSink, ReplayLine, ReplayUnresolved, VoiceOrchestratorService } from '../voice/voice-orchestrator.service';
import { VoiceSessionService } from '../voice/voice-session.service';
import { VoiceContextService } from '../voice/voice-context.service';
import { VoiceFeedbackService } from '../voice/voice-feedback.service';
import { EarconService } from '../voice/earcon.service';
import { SpeechFeedbackService } from '../voice/speech-feedback.service';
import { InputLanguageService } from '../voice/input-language.service';
import { PatientService } from '../services/patient.service';
import { ClinicalRecordService } from '../services/clinical-record.service';
import { ScheduleService } from '../services/schedule.service';
import { CabinetService } from '../services/cabinet.service';
import { AuthService } from '../services/auth.service';
import { LanguageService } from '../services/language.service';
import { ToastService } from '../services/toast.service';

const PATIENT = { id: 'p-1', firstName: 'Karim', lastName: 'Alaoui', phone: null, cin: null, dateOfBirth: null };

function dto(status: ConsultationStatus, extra: Partial<ConsultationDto> = {}): ConsultationDto {
  return {
    id: 'c-1', patientId: 'p-1', actorId: 'u-1', voiceSessionId: 'vs-1', status, locale: 'fr-MA', mode: 'DEFERRED',
    patientInformedAt: '', transcript: '', draft: null, reviewed: null, report: null, appointmentId: null,
    startedAt: '', examinationStartedAt: null, endedAt: null, completedAt: null, ...extra,
  };
}

function draft(overrides: Partial<ConsultationDraftDto> = {}): ConsultationDraftDto {
  return {
    patient: {
      firstName: null, lastName: null, age: null, dateOfBirth: null, gender: null,
      phone: null, cin: null, insuranceProvider: null, insuranceNumber: null,
    },
    chiefComplaint: null, activeTreatments: [], allergies: [], medicalHistory: [], treatmentPlan: [],
    nextAppointment: null, source: 'groq:test', ...overrides,
  };
}

/**
 * The deferred consultation, end to end in the browser's service: nothing is read or acted on
 * while it records, the conversation is only kept; ending it replays every sentence through the
 * commands, reads the whole of it once, and puts everything to the doctor to validate.
 */
describe('ConsultationService — the deferred mode', () => {
  let service: ConsultationService;
  let calls: string[];
  let config: Record<string, unknown>;
  let startedWith: string | undefined;
  let kept: ConsultationLinePayload[][];
  let extractions: number;
  let replayed: ReplayLine[];
  let replayLanguage: string | undefined;
  let replayUnresolved: ReplayUnresolved[];
  let listener: ((text: string) => number | null | void) | null;
  let sink: IntakeSink | null;
  let deferredFlags: boolean[];
  let buffered: ReturnType<typeof signal<Array<Record<string, unknown>>>>;
  let analyses: Array<ConsultationAnalysis | null>;
  let uploadFails: number;
  let uploads: number;
  let nextDraft: ConsultationDraftDto;
  let recording: boolean;
  let stagedRecovered: Array<[string | null, string, string]>;

  beforeEach(() => {
    vi.useFakeTimers();
    calls = [];
    config = { enabled: true, modelExtraction: true, retainTranscript: true, defaultMode: 'deferred', keepAudio: true, maxAudioMegabytes: 100 };
    startedWith = undefined;
    kept = [];
    extractions = 0;
    replayed = [];
    replayLanguage = undefined;
    replayUnresolved = [];
    listener = null;
    sink = null;
    deferredFlags = [];
    buffered = signal([]);
    analyses = [];
    uploadFails = 0;
    uploads = 0;
    nextDraft = draft();
    recording = false;
    stagedRecovered = [];

    TestBed.configureTestingModule({
      providers: [
        {
          provide: ConsultationApiService,
          useValue: {
            config: () => of(config),
            start: (_p: string, _l: string, _i: boolean, mode?: string) => {
              startedWith = mode;
              return of(dto('INTAKE', { mode: (mode ?? 'LIVE') as 'LIVE' | 'DEFERRED' }));
            },
            keepLines: (_id: string, _t: string, lines: ConsultationLinePayload[]) => { kept.push(lines); calls.push('api.lines'); return of(undefined); },
            extract: () => {
              extractions++;
              calls.push('api.extract');
              analyses.push(service.analysis());
              return of({ draft: nextDraft, error: null, truncated: false, chartMentions: [] });
            },
            end: () => { calls.push('api.end'); return of(dto('REVIEW')); },
            beginExamination: () => of(dto('EXAMINATION')),
            saveReviewState: () => of(undefined),
            uploadAudio: () => {
              uploads++;
              calls.push('api.audio');
              if (uploadFails > 0) {
                uploadFails--;
                return throwError(() => ({ status: 503 }));
              }
              return of(dto('REVIEW', { audio: { fileId: 'f-1', contentType: 'audio/webm', sizeBytes: 10, startedAt: null, durationMs: 60_000 } }));
            },
            abandon: () => of(dto('ABANDONED')),
            continue: () => {
              calls.push('api.continue');
              return of(dto('EXAMINATION', { audio: { fileId: 'f-1', contentType: 'audio/webm', sizeBytes: 10, startedAt: null, durationMs: 60_000 } }));
            },
          },
        },
        { provide: VoiceApiService, useValue: { getSession: () => of({ id: 'vs-1', status: 'ACTIVE' }) } },
        {
          provide: VoiceOrchestratorService,
          useValue: {
            examinationMode: () => true,
            buffered: () => buffered(),
            openMicrophone: () => Promise.resolve(true),
            startExaminationMode: async () => { calls.push('mic.start'); },
            stopListening: () => calls.push('mic.stop'),
            finishListening: async () => { calls.push('mic.finish'); analyses.push(service.analysis()); },
            setDeferred: (on: boolean) => deferredFlags.push(on),
            setTranscriptListener: (l: typeof listener) => { listener = l; },
            setHandledElsewhere: () => undefined,
            setUtteranceListener: () => undefined,
            setIntakeSink: (s: IntakeSink | null) => { sink = s; },
            stageRecovered: async (teeth: string | null, finding: string, quote: string) => {
              stagedRecovered.push([teeth, finding, quote]);
              return 'staged';
            },
            replayConsultation: async (lines: ReplayLine[], options: { language?: string; onProgress?: (d: number, t: number) => void }) => {
              calls.push('replay');
              replayed = lines;
              replayLanguage = options.language;
              lines.forEach((_, i) => { options.onProgress?.(i + 1, lines.length); analyses.push(service.analysis()); });
              // What the real pipeline does with "Calypso, allergie à la pénicilline", and with a finding.
              sink?.('clinical.addAllergy', { substance: 'pénicilline' }, 'Calypso, allergie à la pénicilline');
              buffered.set([{ auditId: 'a-1', intent: 'clinical.addFindings', entities: { fdi: '16', findings: [{ code: 'caries' }] },
                preview: 'p', transcript: 'dent 16 carie', corrections: [], at: 0, needsConfirmation: true, deferred: true }]);
              return { unresolved: replayUnresolved, staged: 1 };
            },
          },
        },
        {
          provide: ConsultationRecorderService,
          useValue: {
            recording: () => recording,
            start: () => { calls.push('audio.start'); recording = true; return true; },
            stop: async () => { calls.push('audio.stop'); recording = false; return { blob: new Blob(['x']), startedAt: 1, durationMs: 60_000 }; },
            discard: () => { calls.push('audio.discard'); recording = false; },
          },
        },
        {
          provide: VoiceSessionService,
          useValue: {
            adopt: async () => undefined,
            end: async () => { calls.push('session.end'); },
            abandon: async () => undefined,
            finishExternally: async () => undefined,
            generateNarrative: async () => { calls.push('narrative'); },
            narrative: () => 'Examen.',
            resumeIfAvailable: async () => null,
            reopen: async () => { calls.push('session.reopen'); },
            touchSession: () => undefined,
            setRouting: () => undefined,
          },
        },
        { provide: InputLanguageService, useValue: { language: () => 'fr', set: () => undefined } },
        { provide: VoiceContextService, useValue: { snapshot: () => ({ patientId: 'p-1', locale: 'fr-MA' }), locale: () => 'fr-MA', dentition: () => 'adult' } },
        { provide: SpeechFeedbackService, useValue: { speak: () => undefined, unlock: () => undefined } },
        { provide: VoiceFeedbackService, useValue: { deliver: (_c: string, lines: { full: { text: string } | null }) => { if (lines.full) calls.push(`say ${lines.full.text}`); } } },
        { provide: EarconService, useValue: { unlock: () => undefined, play: () => undefined } },
        { provide: PatientService, useValue: { currentPatient: signal(PATIENT), reload: () => of(PATIENT) } },
        { provide: ClinicalRecordService, useValue: { refresh: () => undefined } },
        { provide: ScheduleService, useValue: { refreshAppointments: () => undefined } },
        { provide: CabinetService, useValue: { cabinetInfo: () => ({ name: 'Cabinet' }) } },
        { provide: AuthService, useValue: { currentUser: () => ({ id: 'doc-1', firstName: 'Samir', lastName: 'Bennani' }) } },
        { provide: LanguageService, useValue: { currentLang: () => 'fr' } },
        { provide: ToastService, useValue: { success: () => undefined, error: (m: string) => calls.push(`toast ${m}`), info: () => undefined } },
        { provide: TranslateService, useValue: { instant: (key: string) => key } },
      ],
    });
    service = TestBed.inject(ConsultationService);
    try { localStorage.clear(); } catch { /* no storage in this runner */ }
  });

  afterEach(() => vi.useRealTimers());

  async function recordingDeferred(): Promise<void> {
    await service.loadConfig();
    service.openIntro();
    expect(await service.start()).toBe(true);
  }

  it('is the default the clinic sets: the server is told, nothing acts, and the audio is kept', async () => {
    await recordingDeferred();

    expect(startedWith).toBe('DEFERRED');
    expect(service.deferred()).toBe(true);
    expect(deferredFlags.at(-1)).toBe(true);
    expect(calls).toContain('audio.start');
    expect(service.audioState()).toBe('recording');
    expect(calls).toContain('say Consultation démarrée. J’écoute ; tout sera analysé à la fin.');
  });

  it('acts live when an older server says nothing, as it always did', async () => {
    delete config['defaultMode'];
    await service.loadConfig();
    service.openIntro();
    await service.start();
    expect(startedWith).toBe('LIVE');
    expect(service.deferred()).toBe(false);
  });

  it('starts without the consent card for a doctor who asked not to see it again, in their mode', async () => {
    await service.loadConfig();
    expect(service.introHidden()).toBe(false);
    service.chooseMode('LIVE');
    service.setIntroHidden(true);
    expect(service.introHidden()).toBe(true);

    expect(await service.startWithoutIntro()).toBe(true);
    expect(service.intro()).toBe(false);
    expect(startedWith).toBe('LIVE');
  });

  it('shows the consent card again once the doctor asks for it back', async () => {
    service.setIntroHidden(true);
    service.setIntroHidden(false);
    expect(service.introHidden()).toBe(false);
  });

  it('does not start without the card when the clinic has consultations off', async () => {
    config['enabled'] = false;
    await service.loadConfig();
    service.setIntroHidden(true);
    expect(await service.startWithoutIntro()).toBe(false);
    expect(startedWith).toBeUndefined();
  });

  it('lets the doctor pick live commands for the next one', async () => {
    await service.loadConfig();
    service.openIntro();
    service.chooseMode('LIVE');
    await service.start();
    expect(startedWith).toBe('LIVE');
  });

  it('puts no verdict on a sentence while it records: the replay decides it, and the server fills it once', async () => {
    let onVerdict: ((event: { lineId: number | null; verdict: string; summary: string | null }) => void) | null = null;
    const voice = TestBed.inject(VoiceOrchestratorService) as unknown as { setUtteranceListener: (l: typeof onVerdict) => void };
    voice.setUtteranceListener = l => { onVerdict = l; };
    await recordingDeferred();
    const id = listener?.('dent 16 carie') as number;
    onVerdict!({ lineId: id, verdict: 'heard', summary: null });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(service.lines()[0].verdict ?? null).toBeNull();
    expect(kept.flat()[0].verdict).toBeUndefined();
  });

  it('reads nothing while it records; it only keeps the conversation, a few seconds after the last sentence', async () => {
    await recordingDeferred();
    listener?.('Bonjour docteur.');
    listener?.('dent 16 carie');
    await vi.advanceTimersByTimeAsync(60_000);

    expect(extractions).toBe(0);
    expect(kept.length).toBeGreaterThanOrEqual(1);
    expect(kept.flat().map(line => line.text)).toEqual(['Bonjour docteur.', 'dent 16 carie']);
  });

  it('keeps the conversation even while people keep talking', async () => {
    await recordingDeferred();
    for (let i = 0; i < 8; i++) {
      listener?.(`phrase ${i}`);
      await vi.advanceTimersByTimeAsync(LINE_SAVE_DEBOUNCE_MS - 500);
    }
    expect(kept.length).toBeGreaterThanOrEqual(1);
  });

  describe('ending it', () => {
    beforeEach(async () => {
      await recordingDeferred();
      listener?.('Bonjour docteur, j\'ai mal.');
      listener?.('dent 16 carie');
      service.addTyped('note tapée');
      listener?.('Calypso, allergie à la pénicilline');
      calls.length = 0;
    });

    async function end(): Promise<void> {
      await service.end();
      await vi.advanceTimersByTimeAsync(10);
    }

    it('replays every spoken sentence, then reads the whole conversation, then ends, then sends the audio', async () => {
      await end();

      const order = calls.filter(call => ['mic.finish', 'audio.stop', 'api.lines', 'replay', 'api.extract', 'session.end', 'api.end', 'api.audio', 'narrative'].includes(call));
      expect(order).toEqual(['mic.finish', 'audio.stop', 'api.lines', 'replay', 'api.extract', 'session.end', 'api.end', 'api.audio', 'narrative']);
      // Typed lines were never commands.
      expect(replayed.map(line => line.text)).toEqual(['Bonjour docteur, j\'ai mal.', 'dent 16 carie', 'Calypso, allergie à la pénicilline']);
      expect(replayLanguage).toBe('fr');
      expect(service.phase()).toBe('review');
      expect(service.analysis()).toBeNull();
      expect(service.audioState()).toBe('kept');
      expect(calls).toContain('say Analyse terminée. Relisez et validez à l’écran.');
    });

    it('puts what was dictated after the wake word in front of the doctor, to validate', async () => {
      await end();
      const allergy = service.review().allergies[0];
      expect(allergy.data.substance).toBe('pénicilline');
      expect(allergy.status).toBe('proposed');
      expect(allergy.dictated).toBe(true);
    });

    it('a later reading that does not mention it does not take a dictated item away', async () => {
      nextDraft = draft();
      await end();
      expect(service.review().allergies.map(a => a.data.substance)).toEqual(['pénicilline']);
    });

    it('cannot be saved until every finding the replay staged is validated, and "validate all" covers the chart', async () => {
      await end();
      expect(service.pending()).toBeGreaterThanOrEqual(2);
      expect(service.canSave()).toBe(false);

      service.validateEverything();
      expect(service.pending()).toBe(0);
      expect(service.canSave()).toBe(true);
    });

    it('lists what the replay could not settle, unless it is already on the chart', async () => {
      replayUnresolved = [
        { lineId: 7, text: 'Calypso, carie occlusale', question: 'Sur quelle dent ?' },
        { lineId: 8, text: 'dent 16 carie', question: null },
      ];
      await end();
      const mentions = service.review().chartMentions;
      expect(mentions).toEqual([{ teeth: null, finding: 'Sur quelle dent ?', quote: 'Calypso, carie occlusale', unresolved: true }]);
    });

    it('shows where it is while it runs', async () => {
      await end();
      const steps = [...new Set(analyses.filter(Boolean).map(a => a!.step))];
      expect(steps).toEqual(['finishing', 'commands', 'reading']);
      expect(analyses.filter(a => a?.step === 'commands').map(a => `${a!.done}/${a!.total}`)).toEqual(['1/3', '2/3', '3/3']);
    });

    it('puts a sentence left to confirm on the chart as its suggestion reads it, still to validate', async () => {
      replayUnresolved = [{ lineId: 9, text: 'la 36 a une fracture', question: null }];
      await end();
      expect(service.review().chartMentions.map(m => m.quote)).toEqual(['la 36 a une fracture']);

      expect(await service.chartSuggestion('la 36 a une fracture')).toBe(true);

      expect(stagedRecovered).toHaveLength(1);
      expect(stagedRecovered[0][0]).toBe('36');
      expect(stagedRecovered[0][2]).toBe('la 36 a une fracture');
      expect(service.review().chartMentions).toEqual([]);
    });

    it('leaves a suggestion with no tooth for the doctor to place by hand', async () => {
      replayUnresolved = [{ lineId: 9, text: 'Calypso, carie occlusale', question: 'Sur quelle dent ?' }];
      await end();

      expect(await service.chartSuggestion('Calypso, carie occlusale')).toBe(false);
      expect(stagedRecovered).toEqual([]);
      expect(service.review().chartMentions).toHaveLength(1);
    });

    describe('continuing it after the end', () => {
      it('is only offered from the review', async () => {
        expect(await service.continueConsultation()).toBe(false);
        expect(calls).not.toContain('api.continue');
      });

      it('records again with nothing lost, keeps the audio already sent, and replays only what was added', async () => {
        await end();
        const linesBefore = service.lines().length;
        calls.length = 0;

        expect(await service.continueConsultation()).toBe(true);

        expect(calls).toEqual(expect.arrayContaining(['api.continue', 'session.reopen', 'mic.start']));
        expect(service.phase()).toBe('examination');
        expect(service.lines()).toHaveLength(linesBefore);
        expect(service.review().allergies.map(a => a.data.substance)).toEqual(['pénicilline']);
        // The recording already kept would be replaced by a second one: none is made.
        expect(calls).not.toContain('audio.start');
        expect(service.audioState()).toBe('kept');
        expect(calls).toContain('say Consultation reprise. J’écoute ; ce qui est ajouté sera analysé à la fin.');

        listener?.('dent 26 fracture');
        await end();

        expect(replayed.map(line => line.text)).toEqual(['dent 26 fracture']);
        expect(service.phase()).toBe('review');
        expect(service.review().allergies.map(a => a.data.substance)).toEqual(['pénicilline']);
      });

      it('keeps the report the doctor wrote when it ends again', async () => {
        await end();
        service.setReport('Mes propres mots.');
        await service.continueConsultation();
        listener?.('dent 26 fracture');
        calls.length = 0;

        await end();

        expect(service.report()).toBe('Mes propres mots.');
        expect(calls).not.toContain('narrative');
      });
    });

    it('keeps the recording when it cannot be sent, and sends it again on request', async () => {
      uploadFails = 3;
      await service.end();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(service.audioState()).toBe('failed');

      await service.retryAudio();
      expect(service.audioState()).toBe('kept');
      expect(uploads).toBe(4);
    });
  });

  it('throws the recording away with a discarded consultation', async () => {
    await recordingDeferred();
    await service.abandon();
    expect(calls).toContain('audio.discard');
  });
});
