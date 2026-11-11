import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceCommandsService } from './register-voice-commands';
import { VoiceOrchestratorService } from './voice-orchestrator.service';
import { voicePipelineProviders } from './testing/consultation-replay.testing';
import { FakeAudioCapture, FakeAuth, FakeSpeechFeedback, FakeVoiceApi, FakeVoiceSession } from './testing/voice-fakes.testing';

/** A sentence cut by the length limit, and clips lost to the connection (WP7). */
describe('VoiceOrchestratorService — clips', () => {
  let api: FakeVoiceApi;
  let capture: FakeAudioCapture;
  let feedback: FakeSpeechFeedback;
  let orchestrator: VoiceOrchestratorService;
  let heard: string[];
  const transcript = (text: string) => ({ text, provider: 'p', model: 'm', language: 'fr', durationSeconds: 1, error: null });

  beforeEach(async () => {
    vi.useFakeTimers();
    api = new FakeVoiceApi();
    capture = new FakeAudioCapture();
    feedback = new FakeSpeechFeedback();
    TestBed.configureTestingModule({
      providers: voicePipelineProviders({ api, feedback, capture, auth: new FakeAuth(), session: new FakeVoiceSession() }),
    });
    orchestrator = TestBed.inject(VoiceOrchestratorService);
    TestBed.inject(VoiceCommandsService).registerAll();
    heard = [];
    orchestrator.setTranscriptListener(text => { heard.push(text); return heard.length; });
    await orchestrator.startExaminationMode({ announce: false });
  });
  afterEach(() => vi.useRealTimers());

  it('reads a sentence cut by the length limit together with its end', async () => {
    api.transcription = () => of(transcript('44, 43 et'));
    capture.say(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(heard).toEqual([]);
    api.transcription = () => of(transcript('45 couronnes.'));
    capture.say();
    await vi.advanceTimersByTimeAsync(0);
    expect(heard).toEqual(['44, 43 et 45 couronnes.']);
    expect(orchestrator.buffered()).toHaveLength(3);
  });

  it('lets a cut clip go alone when nothing follows it', async () => {
    api.transcription = () => of(transcript('Dent 13, carie.'));
    capture.say(true);
    await vi.advanceTimersByTimeAsync(1_300);
    expect(heard).toEqual(['Dent 13, carie.']);
    expect(orchestrator.buffered()).toHaveLength(1);
  });

  it('keeps what is said without a connection, and sends it in order when it is back', async () => {
    api.transcription = () => throwError(() => ({ status: 0 }));
    capture.say();
    capture.say();
    await vi.advanceTimersByTimeAsync(0);
    expect(heard).toEqual([]);
    expect(feedback.spoken.at(-1)?.text).toMatch(/gardé/u);

    const answers = ['Dent 13, carie.', 'Dent 14, carie.'];
    api.transcription = () => of(transcript(answers.shift()!));
    await orchestrator.flushOffline();
    expect(heard).toEqual(['Dent 13, carie.', 'Dent 14, carie.']);
    expect(orchestrator.buffered()).toHaveLength(2);
  });

  it('never runs as a command a clip transcribed long after it was said', async () => {
    api.transcription = () => throwError(() => ({ status: 0 }));
    capture.say();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(30_000);
    api.transcription = () => of(transcript('Dent 13, carie.'));
    await orchestrator.flushOffline();
    expect(heard).toEqual(['Dent 13, carie.']);
    expect(orchestrator.buffered()).toHaveLength(0);
  });
});
