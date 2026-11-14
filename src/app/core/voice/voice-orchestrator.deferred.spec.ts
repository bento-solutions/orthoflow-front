import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceCommandsService } from './register-voice-commands';
import { ReplayLine, VoiceOrchestratorService } from './voice-orchestrator.service';
import { VoicePreferencesService } from './voice-preferences.service';
import { EarconService } from './earcon.service';
import { UtteranceEvent } from './voice-intent.model';
import { voicePipelineProviders } from './testing/consultation-replay.testing';
import { FakeAudioCapture, FakeAuth, FakeSpeechFeedback, FakeVoiceApi, FakeVoiceSession } from './testing/voice-fakes.testing';

/**
 * The deferred consultation, through the real pipeline: while it records, nothing acts but the
 * consultation's own phrases; when it ends, every sentence is replayed through the commands —
 * silently, on each sentence's own time, asking nothing — and what it finds waits for the doctor.
 */
describe('a deferred consultation', () => {
  let orchestrator: VoiceOrchestratorService;
  let api: FakeVoiceApi;
  let feedback: FakeSpeechFeedback;
  let language: { value: string };
  let ended: number;
  let tones: string[];
  let events: UtteranceEvent[];
  const T0 = new Date('2026-11-13T10:00:00').getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    api = new FakeVoiceApi();
    feedback = new FakeSpeechFeedback();
    language = { value: 'fr' };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: voicePipelineProviders({
        api, feedback, capture: new FakeAudioCapture(), auth: new FakeAuth(), session: new FakeVoiceSession(), language,
      }),
    });
    orchestrator = TestBed.inject(VoiceOrchestratorService);
    TestBed.inject(VoiceCommandsService).registerAll();
    TestBed.inject(VoicePreferencesService).setSessionLevel('full');
    tones = [];
    TestBed.inject(EarconService).setRecorder(tone => tones.push(tone));
    events = [];
    orchestrator.setUtteranceListener(event => events.push(event));
    ended = 0;
    orchestrator.sessionHooks = { start: async () => undefined, end: async () => { ended++; }, summary: async () => undefined };
    let line = 1;
    orchestrator.setTranscriptListener(() => line++);
  });

  afterEach(() => vi.useRealTimers());

  const staged = () => api.recorded.filter(row => row.confirmationStatus === 'PENDING' && row.riskTier === 'CONFIRM');
  const lines = (...texts: Array<[number, string]>): ReplayLine[] =>
    texts.map(([seconds, text], index) => ({ id: index + 1, text, at: T0 + seconds * 1000 }));

  describe('while it records', () => {
    beforeEach(() => orchestrator.setDeferred(true));

    it('keeps a chart command for the end: nothing is staged, read back or sounded', async () => {
      await orchestrator.simulateHeard('dent 16, carie occlusale');
      await orchestrator.simulateHeard('Calypso, allergie à la pénicilline');

      expect(staged()).toEqual([]);
      expect(orchestrator.buffered()).toEqual([]);
      expect(feedback.spoken).toEqual([]);
      expect(events.map(event => event.verdict)).toEqual(['heard', 'heard']);
    });

    it('still ends on "fin de la consultation", with or without the wake word', async () => {
      await orchestrator.simulateHeard('fin de la consultation');
      expect(ended).toBe(1);
    });

    it('still changes the dictation language by voice', async () => {
      await orchestrator.simulateHeard('Calypso, dictée en anglais');
      expect(language.value).toBe('en');
    });

    it('still says when a command was said in another language than the one chosen', async () => {
      await orchestrator.simulateHeard('Calypso, tooth 16 caries');
      expect(feedback.spoken.length).toBe(1);
      expect(events[0].verdict).toBe('other-language');
    });

    it('does not sound "not understood" for a finding said without a command: it will be read at the end', async () => {
      await orchestrator.simulateHeard('dent 16 carie');
      await orchestrator.simulateHeard('carie occlusale');
      expect(tones).toEqual([]);
    });
  });

  describe('replayed at the end', () => {
    it('stages what the live commands would have, to validate, without a sound', async () => {
      const result = await orchestrator.replayConsultation(lines(
        [0, 'dent 16, carie occlusale'],
        [20, 'la 13 et 14 amalgame'],
        [40, 'Non, donc 14, c\'est pas amalgame, couronne.'],
      ));

      const findings = orchestrator.buffered().map(entry => entry.entities['fdi'] + ':'
        + (entry.entities['findings'] as Array<{ code: string }>).map(f => f.code).join('+'));
      expect(findings.sort()).toEqual(['13:existing_amalgam', '14:existing_crown', '16:caries']);
      expect(orchestrator.buffered().every(entry => entry.deferred && entry.needsConfirmation)).toBe(true);
      expect(result.staged).toBe(3);
      expect(feedback.spoken).toEqual([]);
      expect(tones).toEqual([]);
    });

    it('times each finding on the sentence it was said in', async () => {
      await orchestrator.replayConsultation(lines([0, 'bonjour'], [95, 'dent 21, fracture']));
      expect(orchestrator.buffered()[0].at).toBe(T0 + 95_000);
    });

    it('closes the follow-up window when it closed in the room, not a few milliseconds later', async () => {
      // "Carie occlusale" alone, five seconds after "dent 16 carie", is the doctor refining it, as
      // it was live; ten minutes later it is the conversation, and the replay must know the difference.
      const surfaces = () => orchestrator.buffered().flatMap(entry =>
        (entry.entities['findings'] as Array<{ code: string; surface: string | null }>).map(f => `${entry.entities['fdi']}:${f.code}@${f.surface ?? '-'}`));

      await orchestrator.replayConsultation(lines([0, 'dent 16 carie'], [5, 'carie occlusale']));
      expect(surfaces()).toEqual(['16:caries@occlusal']);

      orchestrator.resetBuffer();
      await orchestrator.replayConsultation(lines([0, 'dent 16 carie'], [600, 'carie occlusale']));
      expect(surfaces()).toEqual(['16:caries@-']);
    });

    it('asks nothing: a question the live pipeline would have asked comes back with the sentence', async () => {
      const result = await orchestrator.replayConsultation(lines([0, 'Calypso, carie occlusale'], [10, 'dent 17 carie']));

      expect(orchestrator.clarification()).toBeNull();
      expect(orchestrator.confirmation()).toBeNull();
      expect(result.unresolved).toHaveLength(1);
      expect(result.unresolved[0]).toMatchObject({ lineId: 1 });
      // The question did not swallow the next sentence.
      expect(orchestrator.buffered().map(entry => entry.entities['fdi'])).toEqual(['17']);
    });

    it('does not replay what only meant something in the room: views, reading aloud, ending', async () => {
      await orchestrator.replayConsultation(lines(
        [0, 'montre les allergies'],
        [5, 'Calypso, zoom sur la 16'],
        [10, 'fin de la consultation'],
      ));
      expect(api.recorded.filter(row => row.outcome === 'EXECUTED')).toEqual([]);
      expect(ended).toBe(0);
    });

    it('honours a pause said during the consultation, and the resume after it', async () => {
      await orchestrator.replayConsultation(lines(
        [0, 'Calypso, pause'],
        [5, 'dent 16 carie'],
        [10, 'Calypso, reprends'],
        [15, 'dent 17 carie'],
      ));
      expect(orchestrator.buffered().map(entry => entry.entities['fdi'])).toEqual(['17']);
    });

    it('follows a language change said during the consultation from that line on, without changing the setting', async () => {
      await orchestrator.replayConsultation(lines(
        [0, 'tooth 16 caries'],
        [5, 'Calypso, dictée en anglais'],
        [10, 'tooth 17 caries'],
      ), { language: 'fr' });
      expect(orchestrator.buffered().map(entry => entry.entities['fdi'])).toEqual(['17']);
      expect(language.value).toBe('fr');
    });

    it('applies an undo said right after a finding', async () => {
      await orchestrator.replayConsultation(lines([0, 'dent 16 carie'], [4, 'Calypso, annule'], [8, 'dent 17 carie']));
      expect(orchestrator.buffered().map(entry => entry.entities['fdi'])).toEqual(['17']);
    });

    it('hands what was dictated after the wake word to the consultation, and reports progress', async () => {
      const taken: string[] = [];
      orchestrator.setIntakeSink((intent, entities) => {
        taken.push(`${intent}:${String(entities['substance'] ?? entities['label'] ?? '')}`);
        return { list: 'allergies', value: 'x', itemKey: 'k', spoken: { text: 'Allergie.', locale: 'fr-FR' } };
      });
      const progress: string[] = [];
      await orchestrator.replayConsultation(lines([0, 'Calypso, allergie à la pénicilline'], [5, 'merci']), {
        onProgress: (done, total) => progress.push(`${done}/${total}`),
      });
      expect(taken).toEqual(['clinical.addAllergy:pénicilline']);
      expect(progress).toEqual(['1/2', '2/2']);
      expect(feedback.spoken).toEqual([]);
    });

    it('leaves the live pipeline as it found it', async () => {
      await orchestrator.replayConsultation(lines([0, 'Calypso, dent 16 carie']));
      expect(orchestrator.replaying()).toBe(false);
      expect(orchestrator.awakeUntil()).toBeNull();
      expect(orchestrator.highlightedFdi()).toBeNull();
      // Live again: a command is read back.
      await orchestrator.simulateHeard('dent 18 carie');
      expect(feedback.spoken.length).toBeGreaterThan(0);
    });
  });
});
