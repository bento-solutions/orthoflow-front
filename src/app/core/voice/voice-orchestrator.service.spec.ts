import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { InvoiceService } from '../../features/billing/services/invoice.service';
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
import { VoiceApiService, RecordVoiceCommandDto } from './voice-api.service';
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

  interpret() {
    this.interpreted++;
    return of({ intent: null, entities: {}, confidence: 0, clarification: null, resolver: 'llm', provider: 'disabled', error: null });
  }
}

class FakeFeedback {
  spoken: Array<{ text: string; locale: string }> = [];
  speak(text: string, locale: string) {
    this.spoken.push({ text, locale });
  }
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

const capture = {
  level: signal(0),
  speaking: signal(false),
  paused: signal(false),
  status: signal('idle'),
  isActive: () => false,
  isSupported: () => true,
  setUtteranceHandler: () => undefined,
  stop: () => undefined,
  setPaused: () => undefined,
  lastError: () => null,
};

const recognition = {
  interimTranscript: signal(''),
  status: signal('idle'),
  consented: signal(true),
  isSupported: () => true,
  setResultHandler: () => undefined,
  stop: () => undefined,
};

describe('VoiceOrchestratorService — staging what was dictated', () => {
  let orchestrator: VoiceOrchestratorService;
  let api: FakeApi;
  let feedback: FakeFeedback;

  const say = (text: string) => orchestrator.handleTranscript(text, 1, null, false);
  const entitiesOf = (index: number) => JSON.parse(api.recorded[index].entities) as Record<string, unknown>;

  beforeEach(() => {
    api = new FakeApi();
    feedback = new FakeFeedback();
    TestBed.configureTestingModule({
      providers: [
        { provide: VoiceApiService, useValue: api },
        { provide: SpeechFeedbackService, useValue: feedback },
        { provide: VoiceContextService, useClass: FakeContext },
        { provide: AudioCaptureService, useValue: capture },
        { provide: SpeechRecognitionService, useValue: recognition },
        { provide: SessionBufferService, useValue: { append: async () => undefined, remove: async () => undefined } },
        { provide: ToastService, useValue: { success: () => undefined, info: () => undefined, error: () => undefined } },
        { provide: VoiceSessionService, useValue: { isActive: () => true, touchSession: () => undefined } },
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
});
