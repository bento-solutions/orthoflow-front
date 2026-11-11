import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioCaptureService } from './audio-capture.service';
import { EarconService } from './earcon.service';
import { SpeechFeedbackService } from './speech-feedback.service';
import { FeedbackCue, POLITE_MAX_WAIT_MS, VoiceFeedbackService, decideFeedback } from './voice-feedback.service';
import { FeedbackLevel, VoicePreferencesService } from './voice-preferences.service';
import { FakeSpeechFeedback } from './testing/voice-fakes.testing';

/** docs/VOICE-COCKPIT-PLAN.md part I §4, cell by cell. */
const MATRIX: Record<FeedbackCue, Record<FeedbackLevel, string>> = {
  confirm:  { full: 'full', brief: 'brief', tones: 'tone:confirm', silent: '-' },
  proposal: { full: 'full', brief: 'brief', tones: 'tone:proposal', silent: '-' },
  view:     { full: 'full', brief: 'brief', tones: 'tone:confirm', silent: '-' },
  unsure:   { full: 'tone:unsure', brief: 'tone:unsure', tones: 'tone:unsure', silent: '-' },
  question: { full: 'full', brief: 'full', tones: 'tone:question', silent: '-' },
  error:    { full: 'full', brief: 'full', tones: 'tone:error', silent: '-' },
  alarm:    { full: 'full', brief: 'full', tones: 'full', silent: 'full' },
  asked:    { full: 'full', brief: 'full', tones: 'full', silent: 'full' },
};

const describeDecision = (cue: FeedbackCue, level: FeedbackLevel, options = {}) => {
  const decision = decideFeedback(cue, level, options);
  return decision.say ?? (decision.tone ? `tone:${decision.tone}` : '-');
};

describe('decideFeedback — the matrix', () => {
  for (const [cue, row] of Object.entries(MATRIX) as [FeedbackCue, Record<FeedbackLevel, string>][]) {
    for (const [level, expected] of Object.entries(row) as [FeedbackLevel, string][]) {
      it(`${cue} at ${level} → ${expected}`, () => {
        expect(describeDecision(cue, level)).toBe(expected);
      });
    }
  }

  it('says "Pas compris" in full only to someone who asked', () => {
    expect(describeDecision('unsure', 'full', { asked: true })).toBe('full');
    expect(describeDecision('unsure', 'brief', { asked: true })).toBe('tone:unsure');
  });

  it('keeps alarms quiet only when the doctor turned them off', () => {
    expect(describeDecision('alarm', 'silent', { criticalAlerts: false })).toBe('-');
    expect(describeDecision('alarm', 'full', { criticalAlerts: false })).toBe('-');
  });
});

describe('VoiceFeedbackService — never over a voice', () => {
  let speech: FakeSpeechFeedback;
  let tones: string[];
  let speaking: ReturnType<typeof signal<boolean>>;
  let service: VoiceFeedbackService;
  let level: FeedbackLevel;
  const fr = (text: string) => ({ text, locale: 'fr-FR' });

  beforeEach(() => {
    vi.useFakeTimers();
    speech = new FakeSpeechFeedback();
    tones = [];
    speaking = signal(false);
    level = 'full';
    TestBed.configureTestingModule({
      providers: [
        { provide: SpeechFeedbackService, useValue: speech },
        { provide: AudioCaptureService, useValue: { speaking } },
        { provide: VoicePreferencesService, useValue: { level: () => level, criticalAlerts: () => true } },
        { provide: EarconService, useValue: { play: (tone: string) => tones.push(tone) } },
      ],
    });
    service = TestBed.inject(VoiceFeedbackService);
  });
  afterEach(() => vi.useRealTimers());

  it('speaks at once when nobody is talking', () => {
    service.deliver('confirm', { full: fr('Dent 16 : carie.') });
    expect(speech.spoken.map(s => s.text)).toEqual(['Dent 16 : carie.']);
  });

  it('waits for a short silence when someone is talking, then speaks', async () => {
    speaking.set(true);
    service.deliver('confirm', { full: fr('Dent 16 : carie.') });
    expect(speech.spoken).toEqual([]);
    await vi.advanceTimersByTimeAsync(800);
    speaking.set(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(speech.spoken).toEqual([]);
    await vi.advanceTimersByTimeAsync(300);
    expect(speech.spoken.map(s => s.text)).toEqual(['Dent 16 : carie.']);
  });

  it('becomes a tone when the talking goes on, and stays on screen', async () => {
    speaking.set(true);
    service.deliver('confirm', { full: fr('Dent 16 : carie.') });
    await vi.advanceTimersByTimeAsync(POLITE_MAX_WAIT_MS + 100);
    expect(speech.spoken).toEqual([]);
    expect(tones).toEqual(['confirm']);
  });

  it('lets the latest confirmation replace one still waiting', async () => {
    speaking.set(true);
    service.deliver('confirm', { full: fr('Dent 16 : carie.') });
    service.deliver('confirm', { full: fr('Dent 17 : couronne.') });
    speaking.set(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(speech.spoken.map(s => s.text)).toEqual(['Dent 17 : couronne.']);
  });

  it('does not make an alarm or an answer wait', () => {
    speaking.set(true);
    service.deliver('alarm', { full: fr('Micro perdu.') });
    service.deliver('asked', { full: fr('3 allergies.') });
    expect(speech.spoken.map(s => s.text)).toEqual(['Micro perdu.', '3 allergies.']);
  });

  it('says the brief line at the brief level, and keeps it short', () => {
    level = 'brief';
    service.deliver('confirm', { full: fr('Dent 16 : carie occlusale.'), brief: fr('Dent 16, noté.') });
    service.deliver('proposal', { full: fr('Allergies : ananas, pénicilline, kiwi.') });
    service.deliver('view', { full: fr('Trois allergies sont notées au dossier de ce patient, dont la pénicilline et le latex, et le kiwi.') });
    expect(speech.spoken.map(s => s.text)).toEqual([
      'Dent 16, noté.', 'Noté.',
      expect.stringMatching(/^.{1,60}$/u),
    ]);
  });

  it('plays tones and says nothing at the tones level', () => {
    level = 'tones';
    service.deliver('confirm', { full: fr('Dent 16 : carie.') });
    service.deliver('unsure', { full: null });
    expect(speech.spoken).toEqual([]);
    expect(tones).toEqual(['confirm', 'unsure']);
  });

  it('remembers the last confirmation, for "répète"', () => {
    service.deliver('confirm', { full: fr('Dent 16 : carie.') });
    service.deliver('alarm', { full: fr('Micro perdu.') });
    expect(service.last()?.text).toBe('Dent 16 : carie.');
  });
});
