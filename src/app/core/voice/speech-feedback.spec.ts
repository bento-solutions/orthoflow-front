import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pickVoice, SpeechFeedbackService, VoiceLike } from './speech-feedback.service';

/**
 * A French confirmation read by an English voice is not a confirmation the
 * dentist can rely on — "seize" and "treize" are exactly what gets lost.
 */
const voice = (name: string, lang: string, isDefault = false): VoiceLike =>
  ({ name, lang, localService: true, default: isDefault });

describe('pickVoice', () => {
  const voices = [
    voice('Samantha', 'en-US', true),
    voice('Thomas', 'fr-FR'),
    voice('Google français', 'fr-FR'),
    voice('Amélie', 'fr-CA'),
    voice('Microsoft Denise Online (Natural) - French (France)', 'fr-FR'),
  ];

  it('never leaves a French phrase to the default English voice', () => {
    expect(pickVoice(voices, 'fr-FR')?.lang).toBe('fr-FR');
  });

  it('prefers the natural and network voices over the robotic ones', () => {
    expect(pickVoice(voices, 'fr-FR')?.name).toContain('Natural');
    expect(pickVoice(voices.filter(v => !v.name.includes('Natural')), 'fr-FR')?.name).toBe('Google français');
  });

  it('falls back to the same language in another region', () => {
    expect(pickVoice([voice('Amélie', 'fr-CA'), voice('Samantha', 'en-US')], 'fr-FR')?.name).toBe('Amélie');
    expect(pickVoice([voice('Amélie', 'fr_CA')], 'fr-MA')?.name).toBe('Amélie');
  });

  it('returns null when there is no voice for the language, leaving it to the browser', () => {
    expect(pickVoice([voice('Samantha', 'en-US')], 'fr-FR')).toBeNull();
    expect(pickVoice([], 'fr-FR')).toBeNull();
  });
});

// ── The window the microphone is muted for ──────────────────────────────

describe('SpeechFeedbackService — how long the microphone stays muted', () => {
  class FakeUtterance {
    onstart: (() => void) | null = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    lang = '';
    voice: unknown = null;
    rate = 1;
    constructor(public text: string) {}
  }

  let spoken: FakeUtterance[];
  let service: SpeechFeedbackService;

  beforeEach(() => {
    spoken = [];
    vi.useFakeTimers();
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        paused: false,
        getVoices: () => [],
        addEventListener: () => undefined,
        resume: () => undefined,
        cancel: () => undefined,
        speak: (utterance: FakeUtterance) => spoken.push(utterance),
      },
    });
    service = new SpeechFeedbackService();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete (window as { speechSynthesis?: unknown }).speechSynthesis;
  });

  it('is muted from the moment something is said, for as long as it will take', () => {
    service.speak('Dent 16 : carie récurrente.', 'fr-FR');

    expect(service.isAudible()).toBe(true);
    vi.advanceTimersByTime(1_000);
    expect(service.isAudible()).toBe(true);
  });

  it('listens again a moment after the engine reports it has finished', () => {
    service.speak('Dent 16 : carie.', 'fr-FR');

    spoken[0].onend?.();
    vi.advanceTimersByTime(300);
    expect(service.isAudible()).toBe(true);
    vi.advanceTimersByTime(300);
    expect(service.isAudible()).toBe(false);
  });

  it('is not unmuted by the end of a read-back that the next one replaced', () => {
    service.speak('Dent 16 : carie récurrente occlusale, couronne à remplacer.', 'fr-FR');
    service.speak('Dent 17 : fracture, mobilité, abcès, sensibilité, usure.', 'fr-FR');

    // The engine reports the first one over, late, while the second is speaking.
    spoken[0].onerror?.();
    vi.advanceTimersByTime(1_000);

    // It used to cut the window to 450 ms here, and the app's own voice was
    // transcribed back as a command.
    expect(service.isAudible()).toBe(true);
  });

  it('is not re-muted by the end of a read-back that was cancelled', () => {
    service.speak('Dent 16 : carie.', 'fr-FR');
    service.cancel();

    spoken[0].onend?.();

    expect(service.isAudible()).toBe(false);
  });

  it('counts what has been said, so one read-back can be told from the next', () => {
    const before = service.generation;
    service.speak('Un.', 'fr-FR');
    service.speak('Deux.', 'fr-FR');

    expect(service.generation).toBe(before + 2);
  });
});
