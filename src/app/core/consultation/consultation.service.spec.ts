import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsultationApiService } from './consultation-api.service';
import {
  EXTRACT_DEBOUNCE_MS, EXTRACT_MAX_INTERVAL_MS, EXTRACT_MIN_INTERVAL_MS, ConsultationService, extractionInterval, REVIEW_SAVE_DEBOUNCE_MS,
  toOffsetIso,
} from './consultation.service';
import { addManualItem, emptyReview, mergeDraft, ReviewState, setItem, toStoredReview } from './consultation-draft';
import {
  ConsultationDraftDto, ConsultationDto, ConsultationLineDto, ConsultationLinePayload, ConsultationStatus,
} from './consultation.model';
import { VoiceApiService } from '../voice/voice-api.service';
import { VoiceOrchestratorService } from '../voice/voice-orchestrator.service';
import { VoiceSessionService } from '../voice/voice-session.service';
import { VoiceContextService } from '../voice/voice-context.service';
import { SpeechFeedbackService } from '../voice/speech-feedback.service';
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
    id: 'c-1', patientId: 'p-1', actorId: 'u-1', voiceSessionId: 'vs-1', status, locale: 'fr-MA',
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

const PENICILLIN = { key: 'allergy:penicilline', substance: 'pénicilline', reaction: null, severity: null, quote: 'q' };

describe('ConsultationService', () => {
  let service: ConsultationService;
  let calls: string[];
  let extractions: string[];
  let sentLines: ConsultationLinePayload[][];
  let openLines: ConsultationLineDto[] | null;
  let savedReviews: unknown[];
  let nextDraft: ConsultationDraftDto;
  let extractFails: { status: number } | null;
  let commitResult: { saved: boolean; failed: { auditId: string; intent: string; errorMessage: string }[] };
  let committed: unknown;
  let listener: ((text: string) => void) | null;
  let handledElsewhere: ((text: string) => boolean) | null;
  let routing: { end: (o: { waitForClips?: boolean }) => Promise<void>; abandon: () => Promise<void> } | null;
  let buffered: ReturnType<typeof signal<Array<{ auditId: string; preview: string }>>>;
  let patient: ReturnType<typeof signal<typeof PATIENT | null>>;
  let currentStatus: ConsultationStatus;
  let narrative: string | null;

  beforeEach(() => {
    vi.useFakeTimers();
    calls = [];
    extractions = [];
    sentLines = [];
    openLines = null;
    savedReviews = [];
    nextDraft = draft();
    extractFails = null;
    commitResult = { saved: true, failed: [] };
    committed = null;
    listener = null;
    handledElsewhere = null;
    routing = null;
    // A signal, as the real orchestrator's is: the service's computeds depend on it.
    buffered = signal([]);
    patient = signal<typeof PATIENT | null>(PATIENT);
    currentStatus = 'INTAKE';
    narrative = 'Examen : carie sur la 16.';

    TestBed.configureTestingModule({
      providers: [
        {
          provide: ConsultationApiService,
          useValue: {
            config: () => of({ enabled: true, modelExtraction: true, retainTranscript: false }),
            start: (patientId: string, locale: string, informed: boolean) => {
              calls.push(`api.start ${patientId} ${locale} informed=${informed}`);
              return of(dto('INTAKE'));
            },
            open: () => of(dto(currentStatus, { transcript: 'Bonjour\nJ\'ai mal', lines: openLines })),
            saveReviewState: (_id: string, state: unknown) => { savedReviews.push(state); return of(undefined); },
            extract: (_id: string, transcript: string, lines: ConsultationLinePayload[] = []) => {
              extractions.push(transcript);
              sentLines.push(lines);
              return extractFails ? throwError(() => extractFails) : of({ draft: nextDraft, error: null, truncated: false });
            },
            beginExamination: () => { calls.push('api.examination'); return of(dto('EXAMINATION')); },
            end: (_id: string, transcript: string, lines: ConsultationLinePayload[] = []) => {
              calls.push(`api.end ${transcript.length}`);
              sentLines.push(lines);
              return of(dto('REVIEW', { transcript }));
            },
            commit: (_id: string, body: unknown) => {
              committed = body;
              return of({
                ...commitResult, consultation: dto(commitResult.saved ? 'COMPLETED' : 'REVIEW'),
                executed: 0, rejected: 0, amended: 0, notReviewed: 0, appointmentId: null,
              });
            },
            abandon: () => { calls.push('api.abandon'); return of(dto('ABANDONED')); },
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
            setTranscriptListener: (l: ((t: string) => void) | null) => { listener = l; },
            setHandledElsewhere: (predicate: ((text: string) => boolean) | null) => { handledElsewhere = predicate; },
          },
        },
        {
          provide: VoiceSessionService,
          useValue: {
            adopt: async () => { calls.push('session.adopt'); },
            end: async (o: { direct?: boolean }) => { calls.push(`session.end direct=${o.direct}`); },
            abandon: async (o: { direct?: boolean }) => { calls.push(`session.abandon direct=${o.direct}`); },
            finishExternally: async () => { calls.push('session.finished'); },
            generateNarrative: async (_id: string, ids?: string[]) => { calls.push(`narrative ${JSON.stringify(ids)}`); },
            narrative: () => narrative,
            resumeIfAvailable: async () => null,
            touchSession: () => undefined,
            setRouting: (r: typeof routing) => { routing = r; },
          },
        },
        { provide: VoiceContextService, useValue: { snapshot: () => ({ patientId: 'p-1', locale: 'fr-MA' }), locale: () => 'fr-MA' } },
        { provide: SpeechFeedbackService, useValue: { speak: (text: string) => calls.push(`say ${text}`) } },
        { provide: PatientService, useValue: { currentPatient: patient, reload: () => of(PATIENT) } },
        { provide: ClinicalRecordService, useValue: { refresh: () => undefined } },
        { provide: ScheduleService, useValue: { refreshAppointments: () => undefined } },
        { provide: CabinetService, useValue: { cabinetInfo: () => ({ name: 'Cabinet' }) } },
        { provide: AuthService, useValue: { currentUser: () => ({ firstName: 'Samir', lastName: 'Bennani' }) } },
        { provide: LanguageService, useValue: { currentLang: () => 'fr' } },
        { provide: ToastService, useValue: { success: () => undefined, error: (m: string) => calls.push(`toast.error ${m}`), info: () => undefined } },
        { provide: TranslateService, useValue: { instant: (key: string) => key } },
      ],
    });
    service = TestBed.inject(ConsultationService);
  });

  afterEach(() => vi.useRealTimers());

  async function started(): Promise<void> {
    await service.loadConfig();
    expect(await service.start()).toBe(true);
    calls.length = 0;
  }

  /** Something the microphone heard. */
  const hear = (text: string) => listener?.(text);

  // ── Starting ────────────────────────────────────────────────────────

  describe('starting', () => {
    it('is offered only when the server says the feature is on', async () => {
      expect(service.available()).toBe(false);
      await service.loadConfig();
      expect(service.available()).toBe(true);
    });

    it('asks again for the doctor who signs in after an assistant was refused, on the same PC', async () => {
      let user = { id: 'assistant', role: 'ASSISTANT' };
      (TestBed.inject(AuthService) as unknown as { currentUser: () => unknown }).currentUser = () => user;
      const api = TestBed.inject(ConsultationApiService);
      api.config = () => throwError(() => ({ status: 403 }));
      await service.loadConfig();
      expect(service.available()).toBe(false);

      api.config = () => of({ enabled: true, modelExtraction: true, retainTranscript: false });
      await service.loadConfig(); // same person: the refusal stands
      expect(service.available()).toBe(false);

      user = { id: 'doctor', role: 'DOCTOR' };
      await service.loadConfig();
      expect(service.available()).toBe(true);
    });

    it('does not remember a network failure: the next screen asks again', async () => {
      const api = TestBed.inject(ConsultationApiService);
      api.config = () => throwError(() => ({ status: 0 }));
      await service.loadConfig();
      expect(service.available()).toBe(false);

      api.config = () => of({ enabled: true, modelExtraction: true, retainTranscript: false });
      await service.loadConfig();
      expect(service.available()).toBe(true);
    });

    it('starts recording, tells the server the doctor attested, and has the chart listening from the first second', async () => {
      await service.loadConfig();

      expect(await service.start()).toBe(true);

      expect(calls).toEqual([
        'api.start p-1 fr-MA informed=true',
        'session.adopt',
        'mic.start',
        'say Consultation démarrée. Les commandes sont actives.',
      ]);
      expect(service.phase()).toBe('intake');
      // Nothing is held back from the chart waiting for a phrase: the pipeline is told no such mode.
      expect(listener).not.toBeNull();
      expect(handledElsewhere).not.toBeNull();
      // every way of ending a session now ends the consultation
      expect(routing).not.toBeNull();
    });

    it('does not start a second consultation over an open one', async () => {
      await started();

      expect(await service.start()).toBe(false);
      expect(calls).toEqual([]);
    });

    it('leaves nothing half-started when the server refuses', async () => {
      TestBed.inject(ConsultationApiService).start = () => throwError(() => ({ status: 409, error: { detail: 'Already one.' } }));
      await service.loadConfig();

      expect(await service.start()).toBe(false);

      expect(service.phase()).toBeNull();
      expect(listener).toBeNull();
      expect(calls).toContain('mic.stop');
      expect(calls).toContain('toast.error Already one.');
    });
  });

  // ── The conversation ────────────────────────────────────────────────

  describe('the conversation', () => {
    it('keeps every utterance, in order', async () => {
      await started();

      hear('Bonjour docteur');
      hear('  J\'ai mal à une dent  ');
      hear('');

      expect(service.lines().map(l => l.text)).toEqual(['Bonjour docteur', 'J\'ai mal à une dent']);
      expect(service.transcript()).toBe('Bonjour docteur\nJ\'ai mal à une dent');
    });

    it('reads the conversation a few seconds after it goes quiet, not on every word', async () => {
      await started();

      hear('Bonjour');
      await vi.advanceTimersByTimeAsync(EXTRACT_DEBOUNCE_MS - 1);
      expect(extractions).toEqual([]);

      hear('Je suis allergique à la pénicilline');
      await vi.advanceTimersByTimeAsync(EXTRACT_DEBOUNCE_MS - 1);
      expect(extractions).toEqual([]);

      await vi.advanceTimersByTimeAsync(2);
      expect(extractions).toEqual(['Bonjour\nJe suis allergique à la pénicilline']);
    });

    it('never reads more often than the minimum interval, however much is said', async () => {
      await started();
      hear('Un');
      await vi.advanceTimersByTimeAsync(EXTRACT_DEBOUNCE_MS + 1);
      expect(extractions).toHaveLength(1);

      hear('Deux');
      await vi.advanceTimersByTimeAsync(EXTRACT_DEBOUNCE_MS + 1);
      // the debounce has passed but the interval since the last reading has not
      expect(extractions).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(EXTRACT_MIN_INTERVAL_MS);
      expect(extractions).toHaveLength(2);
    });

    it('proposes what the reading finds', async () => {
      await started();
      nextDraft = draft({ allergies: [PENICILLIN] });

      hear('Je suis allergique à la pénicilline');
      await vi.advanceTimersByTimeAsync(EXTRACT_DEBOUNCE_MS + 1);

      expect(service.review().allergies).toHaveLength(1);
      expect(service.review().allergies[0].status).toBe('proposed');
    });

    it('does not let a later reading undo a decision the doctor made on the panel', async () => {
      await started();
      nextDraft = draft({ allergies: [PENICILLIN] });
      hear('Je suis allergique à la pénicilline');
      await vi.advanceTimersByTimeAsync(EXTRACT_DEBOUNCE_MS + 1);
      service.changeReview(state => setItem(state, 'allergies', PENICILLIN.key, { status: 'removed' }));

      hear('Oui, vraiment allergique à la pénicilline');
      await vi.advanceTimersByTimeAsync(EXTRACT_MIN_INTERVAL_MS + EXTRACT_DEBOUNCE_MS);

      expect(service.review().allergies[0].status).toBe('removed');
    });

    it('keeps the conversation and tries again when the reading could not be reached', async () => {
      await started();
      extractFails = { status: 0 };
      hear('Bonjour');
      await vi.advanceTimersByTimeAsync(EXTRACT_DEBOUNCE_MS + 1);

      expect(service.note()).toBe('offline');
      expect(service.transcript()).toBe('Bonjour');

      extractFails = null;
      // a failed reading doubles the wait: an unreachable API is not helped by being asked sooner
      await vi.advanceTimersByTimeAsync(EXTRACT_MIN_INTERVAL_MS * 2 + EXTRACT_DEBOUNCE_MS);
      expect(service.note()).toBeNull();
      expect(extractions).toHaveLength(2);
    });

    it('waits longer before asking again when the model did not answer, instead of hammering a refusing API', async () => {
      await started();
      nextDraft = draft();
      TestBed.inject(ConsultationApiService).extract = (_id: string, transcript: string) => {
        extractions.push(transcript);
        return of({ draft: nextDraft, error: 'extraction-failed', truncated: false });
      };
      hear('Bonjour');
      await vi.advanceTimersByTimeAsync(EXTRACT_DEBOUNCE_MS + 1);
      expect(extractions).toHaveLength(1);

      hear('Docteur');
      // the normal interval has passed, but one failure doubled it
      await vi.advanceTimersByTimeAsync(EXTRACT_MIN_INTERVAL_MS + 1);
      expect(extractions).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(EXTRACT_MIN_INTERVAL_MS * 2);
      expect(extractions).toHaveLength(2);
    });

    it('is not told something is wrong when the server merely asks it to slow down', async () => {
      await started();
      extractFails = { status: 429 };
      hear('Bonjour');
      await vi.advanceTimersByTimeAsync(EXTRACT_DEBOUNCE_MS + 1);

      expect(service.note()).toBeNull();
    });

    it('accepts a typed line as part of the same conversation', async () => {
      await started();

      service.addTyped('Allergique au latex');

      expect(service.lines()).toHaveLength(1);
      expect(service.lines()[0].typed).toBe(true);
    });
  });

  // ── Phases ──────────────────────────────────────────────────────────

  describe('calling the consultation', () => {
    it('says the commands are active when the doctor calls the consultation, and marks the examination as begun', async () => {
      await started();

      hear('Calypso, consultation');
      await vi.advanceTimersByTimeAsync(0);

      expect(calls).toContain('api.examination');
      expect(service.phase()).toBe('examination');
      expect(calls).toContain('say Consultation en cours. Les commandes sont actives.');
    });

    it('marks the examination as begun, silently, at the first command given — nobody had to say a phrase first', async () => {
      await started();
      expect(service.phase()).toBe('intake');

      buffered.set([{ auditId: 'a-1', preview: 'Dent 16 : carie' }]);
      TestBed.tick();
      await vi.advanceTimersByTimeAsync(0);

      expect(calls).toContain('api.examination');
      expect(service.phase()).toBe('examination');
      expect(calls.some(c => c.startsWith('say'))).toBe(false);
    });

    it('does not start the examination because someone said the word in conversation', async () => {
      await started();

      hear('Après la consultation je vous donne une ordonnance');
      await vi.advanceTimersByTimeAsync(0);

      expect(service.phase()).toBe('intake');
      expect(calls).not.toContain('api.examination');
    });

    it('tells the pipeline its own phrase is handled, so "Calypso, consultation" is not answered "pas compris"', async () => {
      await started();

      expect(handledElsewhere!('Consultation')).toBe(true);
      expect(handledElsewhere!('on commence la consultation')).toBe(true);
      expect(handledElsewhere!('dent 16 carie')).toBe(false);
      expect(handledElsewhere!('après la consultation')).toBe(false);
    });

    it('answers the phrase again once the examination has begun, without asking the server twice', async () => {
      await started();
      hear('Calypso, consultation');
      await vi.advanceTimersByTimeAsync(0);
      calls.length = 0;

      hear('Calypso, consultation');
      await vi.advanceTimersByTimeAsync(0);

      expect(calls).toEqual(['say Consultation en cours. Les commandes sont actives.']);
      expect(service.phase()).toBe('examination');
    });

    it('ends from a spoken stop in the examination as well', async () => {
      await started();
      hear('Calypso, consultation');
      await vi.advanceTimersByTimeAsync(0);

      hear('Fin de la consultation');
      await vi.advanceTimersByTimeAsync(0);

      expect(service.phase()).toBe('review');
      expect(service.lines().map(l => l.text)).toContain('Fin de la consultation');
    });
  });

  describe('ending', () => {
    it('stops recording, saves the whole conversation, reads it one last time and moves to review', async () => {
      await started();
      nextDraft = draft({ allergies: [PENICILLIN] });
      hear('Je suis allergique à la pénicilline');

      await service.end();

      expect(calls).toContain('session.end direct=true');
      expect(calls.find(c => c.startsWith('api.end'))).toBe('api.end 35');
      expect(service.phase()).toBe('review');
      expect(extractions.at(-1)).toBe('Je suis allergique à la pénicilline');
      expect(service.review().allergies).toHaveLength(1);
      expect(calls).toContain('say Consultation terminée. Relisez et validez à l\u2019écran.');
      expect(listener).toBeNull();
    });

    it('ends from a spoken stop during the intake, without waiting on a queue it is inside', async () => {
      await started();

      hear('Fin de la consultation');
      await vi.advanceTimersByTimeAsync(0);

      expect(service.phase()).toBe('review');
    });

    it('ends once, however many ways of ending are triggered at the same moment', async () => {
      await started();

      await Promise.all([service.end(), service.end(), routing!.end({})]);

      expect(calls.filter(c => c.startsWith('api.end'))).toHaveLength(1);
    });

    it('is what every other way of ending a session now does', async () => {
      await started();

      await routing!.end({ waitForClips: false });

      expect(service.phase()).toBe('review');
    });

    it('discarding throws it away on the server and lets go of the session', async () => {
      await started();

      await service.abandon();

      expect(calls).toEqual(['mic.stop', 'api.abandon', 'session.abandon direct=true']);
      expect(service.phase()).toBeNull();
      expect(routing).toBeNull();
    });

    it('keeps the consultation, and says so, when a discard cannot reach the server', async () => {
      await started();
      TestBed.inject(ConsultationApiService).abandon = () => throwError(() => ({ status: 0 }));

      await service.abandon();

      expect(service.phase()).toBe('intake');
      expect(calls.some(c => c.startsWith('toast.error'))).toBe(true);
      expect(calls).not.toContain('session.abandon direct=true');
    });

    it('says why, in the doctor\'s language, when a save already wrote chart findings', async () => {
      await started();
      TestBed.inject(ConsultationApiService).abandon = () =>
        throwError(() => ({ status: 409, error: { detail: '1 chart finding(s) from this consultation…' } }));

      await service.abandon();

      expect(service.phase()).toBe('intake');
      expect(calls).toContain('toast.error CONSULTATION.ERROR_DISCARD_PARTLY_SAVED');
    });
  });

  // ── Review and save ─────────────────────────────────────────────────

  describe('saving', () => {
    async function inReview(): Promise<void> {
      await started();
      nextDraft = draft({ allergies: [PENICILLIN], chiefComplaint: { value: 'Douleur 16', quote: 'q' } });
      hear('Je suis allergique à la pénicilline');
      await service.end();
      calls.length = 0;
    }

    it('is blocked while anything is undecided, and says how many', async () => {
      await inReview();

      expect(service.pending()).toBe(2);
      expect(service.canSave()).toBe(false);
      expect(await service.commit()).toBe(false);
      expect(committed).toBeNull();
    });

    it('can be saved once every item is validated or removed', async () => {
      await inReview();
      service.changeReview(state => setItem(state, 'allergies', PENICILLIN.key, { status: 'validated' }));
      service.validateEverything();

      expect(service.pending()).toBe(0);
      expect(service.canSave()).toBe(true);
    });

    it('sends the doctor\'s decisions and the chart findings they kept, then lets go of the dictated session', async () => {
      await inReview();
      buffered.set([{ auditId: 'a-1', preview: '16 : carie' }, { auditId: 'a-2', preview: '17 : fracture' }]);
      service.toggleChartEntry('a-2');
      service.changeReview(state => addManualItem(state, 'medicalHistory', { category: 'CONDITION', label: 'Diabète', detail: null }));
      service.validateEverything();
      service.setReport('Compte rendu relu.');

      expect(await service.commit()).toBe(true);

      const body = committed as { approvedAuditIds: string[]; rejectedAuditIds: string[]; allergies: unknown[]; medicalHistory: unknown[]; report: string };
      expect(body.approvedAuditIds).toEqual(['a-1']);
      expect(body.rejectedAuditIds).toEqual(['a-2']);
      expect(body.allergies).toEqual([{ substance: 'pénicilline', reaction: null, severity: null }]);
      expect(body.medicalHistory).toEqual([{ category: 'CONDITION', label: 'Diabète', detail: null }]);
      expect(body.report).toBe('Compte rendu relu.');
      expect(calls).toContain('session.finished');
      expect(service.phase()).toBe('saved');
      expect(service.saved()?.chartLines).toEqual(['16 : carie']);
      expect(service.savedVersion()).toBe(1);
    });

    it('stays in review, and names what failed, when a chart finding did not write', async () => {
      await inReview();
      service.validateEverything();
      commitResult = { saved: false, failed: [{ auditId: 'a-1', intent: 'clinical.addFindings', errorMessage: 'unknown finding' }] };

      expect(await service.commit()).toBe(false);

      expect(service.phase()).toBe('review');
      expect(service.failures()).toHaveLength(1);
      expect(calls).not.toContain('session.finished');
      expect(service.saved()).toBeNull();
    });

    it('starts the report from the examination narrative of the findings that were kept', async () => {
      await inReview();
      buffered.set([{ auditId: 'a-1', preview: 'p1' }, { auditId: 'a-2', preview: 'p2' }]);
      service.toggleChartEntry('a-2');
      calls.length = 0;

      await service.regenerateReport();

      // only the kept finding is described: the narrative never mentions one the doctor removed
      expect(calls).toEqual(['narrative ["a-1"]']);
      expect(service.report()).toBe('Examen : carie sur la 16.');
    });

    it('leaves the report empty when no finding was dictated or every one was removed, rather than asking for nothing', async () => {
      await inReview();
      service.setReport('Texte du docteur.');

      await service.regenerateReport();

      expect(service.report()).toBe('');
      expect(calls.some(c => c.startsWith('narrative'))).toBe(false);
    });

    it('leaves the report empty when the server could not write a narrative', async () => {
      await inReview();
      buffered.set([{ auditId: 'a-1', preview: 'p1' }]);
      narrative = null;

      await service.regenerateReport();

      expect(service.report()).toBe('');
    });

    it('books an appointment only when the doctor chose one', async () => {
      await inReview();
      service.validateEverything();
      service.setAppointment({ date: '2026-10-16', time: '10:00', durationMinutes: 45, type: 'Contrôle', notes: '' });

      await service.commit();

      const body = committed as { nextAppointment: { dateTime: string; durationMinutes: number } };
      expect(body.nextAppointment.dateTime).toMatch(/^2026-10-16T10:00:00[+-]\d\d:\d\d$/);
      expect(body.nextAppointment.durationMinutes).toBe(45);
    });
  });

  // ── The consultation log ────────────────────────────────────────────

  describe('the consultation log', () => {
    it('sends each sentence with its number, the time it was heard and the phase it was said in', async () => {
      vi.setSystemTime(new Date('2026-10-13T10:00:05Z'));
      await started();
      hear('Bonjour docteur');
      vi.setSystemTime(new Date('2026-10-13T10:00:20Z'));
      await service.beginExamination();
      vi.setSystemTime(new Date('2026-10-13T10:00:31Z'));
      hear('dent 16 carie');

      await service.extractNow();

      expect(sentLines.at(-1)).toEqual([
        { seq: 1, at: '2026-10-13T10:00:05.000Z', phase: 'INTAKE', typed: false, text: 'Bonjour docteur' },
        { seq: 2, at: '2026-10-13T10:00:31.000Z', phase: 'EXAMINATION', typed: false, text: 'dent 16 carie' },
      ]);
    });

    it('marks a sentence the doctor typed', async () => {
      vi.setSystemTime(new Date('2026-10-13T10:00:05Z'));
      await started();

      service.addTyped('RDV dans 15 jours');
      await service.extractNow();

      expect(sentLines.at(-1)?.[0]).toMatchObject({ typed: true, text: 'RDV dans 15 jours' });
    });

    it('sends the lines again when recording ends, so the last sentences are in the log', async () => {
      vi.setSystemTime(new Date('2026-10-13T10:00:05Z'));
      await started();
      hear('Merci docteur');

      await service.end();

      expect(sentLines[0].map(l => l.text)).toEqual(['Merci docteur']);
    });

    it('keeps the numbers and times of a conversation it comes back to, so a resend is not a duplicate', async () => {
      openLines = [
        { seq: 7, at: '2026-10-13T09:00:00.000Z', phase: 'INTAKE', typed: false, text: 'Bonjour' },
        { seq: 8, at: '2026-10-13T09:00:09.000Z', phase: 'INTAKE', typed: false, text: 'J\'ai mal' },
      ];
      currentStatus = 'INTAKE';
      await service.resumeOpen('p-1');
      vi.setSystemTime(new Date('2026-10-13T09:05:00Z'));

      hear('Depuis hier');
      await service.extractNow();

      expect(sentLines.at(-1)?.map(l => [l.seq, l.at])).toEqual([
        [7, '2026-10-13T09:00:00.000Z'], [8, '2026-10-13T09:00:09.000Z'], [9, '2026-10-13T09:05:00.000Z'],
      ]);
    });

    it('does not invent a time for a conversation recorded before lines were timed', async () => {
      openLines = null;
      currentStatus = 'INTAKE';
      await service.resumeOpen('p-1');
      vi.setSystemTime(new Date('2026-10-13T09:05:00Z'));

      hear('Depuis hier');
      await service.extractNow();

      // The two older lines stay in the transcript text; only the new one is timed.
      expect(sentLines.at(-1)?.map(l => l.text)).toEqual(['Depuis hier']);
      expect(extractions.at(-1)).toBe('Bonjour\nJ\'ai mal\nDepuis hier');
    });
  });

  // ── Coming back ─────────────────────────────────────────────────────

  describe('coming back', () => {
    it('offers back an unfinished consultation with its conversation, and does not touch the microphone', async () => {
      currentStatus = 'INTAKE';

      await service.resumeOpen('p-1');

      expect(service.phase()).toBe('intake');
      expect(service.lines().map(l => l.text)).toEqual(['Bonjour', 'J\'ai mal']);
      expect(calls).not.toContain('mic.start');
    });

    it('goes straight to review for one that had already ended', async () => {
      currentStatus = 'REVIEW';

      await service.resumeOpen('p-1');

      expect(service.phase()).toBe('review');
      expect(listener).toBeNull();
    });

    it('comes back with the decisions the doctor had made, not a fresh copy of the draft', async () => {
      currentStatus = 'REVIEW';
      const stored = toStoredReview(
        { ...mergeDraft(emptyReview(), draft({ allergies: [PENICILLIN] })),
          allergies: [{ key: PENICILLIN.key, data: { substance: 'pénicilline', reaction: null, severity: null },
            quote: 'q', status: 'removed', manual: false, edited: false }] },
        'Rapport en cours', new Set(['a-9']));
      TestBed.inject(ConsultationApiService).open = () =>
        of(dto('REVIEW', { draft: draft({ allergies: [PENICILLIN] }), reviewState: JSON.parse(JSON.stringify(stored)) }));

      await service.resumeOpen('p-1');

      expect(service.review().allergies[0].status).toBe('removed');
      expect(service.report()).toBe('Rapport en cours');
      expect(service.excluded().has('a-9')).toBe(true);
    });

    it('keeps each decision on the server shortly after it is made, batching a run of them', async () => {
      await started();
      nextDraft = draft({ allergies: [PENICILLIN] });
      hear('Je suis allergique à la pénicilline');
      await vi.advanceTimersByTimeAsync(EXTRACT_DEBOUNCE_MS + 1);
      savedReviews.length = 0;

      service.validateEverything();
      service.setReport('a');
      service.setReport('ab');
      await vi.advanceTimersByTimeAsync(REVIEW_SAVE_DEBOUNCE_MS + 1);

      expect(savedReviews).toHaveLength(1);
      const sent = savedReviews[0] as { v: number; report: string; review: ReviewState };
      expect(sent.v).toBe(1);
      expect(sent.report).toBe('ab');
      expect(sent.review.allergies[0].status).toBe('validated');
    });

    it('sends a pending save right away when the doctor leaves the dossier', async () => {
      await started();
      service.setReport('dernier mot');

      service.detach();

      expect(savedReviews).toHaveLength(1);
    });

    it('does nothing for another patient\'s dossier', async () => {
      patient.set({ ...PATIENT, id: 'p-2' });

      await service.resumeOpen('p-1');

      expect(service.phase()).toBeNull();
    });

    it('lets go of the consultation without ending it when the doctor leaves the dossier', async () => {
      await started();

      service.detach();

      expect(service.phase()).toBeNull();
      expect(listener).toBeNull();
      expect(routing).toBeNull();
      expect(calls).not.toContain('api.abandon');
    });
  });
});

describe('toOffsetIso', () => {
  it('keeps the date and time the doctor chose and adds the offset of the zone they are in', () => {
    expect(toOffsetIso('2026-10-16', '10:00')).toMatch(/^2026-10-16T10:00:00[+-]\d\d:\d\d$/);
  });
});

describe('extractionInterval', () => {
  it('is the minimum for a short conversation that has had no trouble', () => {
    expect(extractionInterval(0, 0)).toBe(EXTRACT_MIN_INTERVAL_MS);
    expect(extractionInterval(200, 0)).toBeLessThan(EXTRACT_MIN_INTERVAL_MS + 500);
  });

  it('grows with the conversation, because every reading sends all of it', () => {
    expect(extractionInterval(20_000, 0)).toBeGreaterThan(extractionInterval(2_000, 0));
    // a twenty-minute consultation is about 20 000 characters: no longer read every nine seconds
    expect(extractionInterval(20_000, 0)).toBeGreaterThan(30_000);
  });

  it('doubles for each reading in a row that failed, and stops somewhere', () => {
    expect(extractionInterval(0, 1)).toBe(EXTRACT_MIN_INTERVAL_MS * 2);
    expect(extractionInterval(0, 2)).toBe(EXTRACT_MIN_INTERVAL_MS * 4);
    expect(extractionInterval(0, 10)).toBe(EXTRACT_MAX_INTERVAL_MS);
  });

  it('never exceeds the ceiling, however long the conversation', () => {
    expect(extractionInterval(500_000, 0)).toBe(EXTRACT_MAX_INTERVAL_MS);
  });
});
