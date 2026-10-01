import { Injectable, signal } from '@angular/core';

/**
 * Spoken confirmation back to the doctor.
 *
 * The point of the whole feature is that the doctor does not look at the
 * screen, so a purely visual confirmation is only half an answer. What is
 * spoken is always the *resolved* values — "Tooth 16, recurrent caries" — and
 * never an echo of the transcript, because reading back what was heard proves
 * nothing about what was understood (audit XII.4 §2).
 *
 * Speech is best-effort. It is never the only confirmation: the HUD shows the
 * same information, and audio can be muted without losing anything.
 *
 * ── Choosing the voice ──────────────────────────────────────────────────
 *
 * Setting only `utterance.lang` leaves the choice to the browser, and on a
 * machine whose default voice is English that means "Dent seize, carie
 * récurrente" read with English phonetics — a confirmation the dentist
 * cannot rely on. So a voice is picked explicitly: one for the exact locale
 * if there is one, then any voice for the language, preferring the natural
 * and network voices (Google, Microsoft "Natural", Apple enhanced/premium)
 * over the robotic defaults.
 */

/**
 * Silence kept after speech ends before the microphone acts again — the room
 * and the speaker ring on for a moment after the last syllable.
 */
const ECHO_TAIL_MS = 450;

/**
 * Upper bound on how long an utterance is assumed audible when the engine
 * never reports its end, which some Android browsers do not.
 */
const MS_PER_CHARACTER = 70;
const MAX_AUDIBLE_MS = 12_000;

/** Voice-name fragments of the higher-quality voices, best first. */
const PREFERRED_VOICE_HINTS = ['natural', 'neural', 'premium', 'enhanced', 'google', 'siri', 'online'];

export interface VoiceLike {
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
}

/**
 * The best voice for `locale` among `voices`, or null to leave it to the
 * browser. Exact locale beats same language; within those, a known
 * high-quality voice beats the default.
 */
export function pickVoice<T extends VoiceLike>(voices: readonly T[], locale: string): T | null {
  const wanted = locale.toLowerCase().replace('_', '-');
  const language = wanted.split('-')[0];
  const normalise = (lang: string) => lang.toLowerCase().replace('_', '-');

  const exact = voices.filter(v => normalise(v.lang) === wanted);
  const sameLanguage = voices.filter(v => normalise(v.lang).split('-')[0] === language);
  const pool = exact.length ? exact : sameLanguage;
  if (pool.length === 0) return null;

  const score = (voice: T): number => {
    const name = voice.name.toLowerCase();
    const hint = PREFERRED_VOICE_HINTS.findIndex(h => name.includes(h));
    return (hint === -1 ? 0 : PREFERRED_VOICE_HINTS.length - hint) * 10 + (voice.default ? 1 : 0);
  };
  return [...pool].sort((a, b) => score(b) - score(a))[0];
}

@Injectable({ providedIn: 'root' })
export class SpeechFeedbackService {
  private enabledSignal = signal(this.readStoredPreference());
  private speakingSignal = signal(false);
  private audibleUntil = 0;
  private voices: SpeechSynthesisVoice[] = [];
  /**
   * Chrome garbage-collects an utterance that nothing references, and its
   * `onend` then never fires — which would leave the microphone muted for the
   * full estimate. Holding the current one prevents that.
   */
  private current: SpeechSynthesisUtterance | null = null;
  private generationCounter = 0;

  /**
   * Changes every time something new is spoken. The microphone uses it to tell
   * one read-back from the next when it measures how loudly the app's own voice
   * comes back to it.
   */
  get generation(): number {
    return this.generationCounter;
  }

  enabled = this.enabledSignal.asReadonly();
  speaking = this.speakingSignal.asReadonly();

  constructor() {
    if (!this.isSupported()) return;
    const load = () => {
      try {
        this.voices = window.speechSynthesis.getVoices();
      } catch {
        this.voices = [];
      }
    };
    load();
    // Voices load asynchronously on Chrome; the list is empty until this fires.
    try {
      window.speechSynthesis.addEventListener?.('voiceschanged', load);
    } catch {
      // Older engines: the list read at speak time is used instead.
    }
  }

  /**
   * Whether the machine has a voice for this language: 'unknown' before the
   * browser has listed its voices (or without speech synthesis at all),
   * 'missing' when it has voices and none of them speaks the language.
   *
   * A PC without the French pack reads "Dent seize, carie" in an English
   * voice, and the dentist cannot tell whether the confirmation is to be
   * trusted. The caller warns instead of guessing.
   */
  voiceStatus(locale: string): 'ok' | 'missing' | 'unknown' {
    if (!this.isSupported()) return 'unknown';
    if (this.voices.length === 0) {
      try {
        this.voices = window.speechSynthesis.getVoices();
      } catch {
        return 'unknown';
      }
    }
    if (this.voices.length === 0) return 'unknown';
    const language = locale.toLowerCase().replace('_', '-').split('-')[0];
    const speaks = this.voices.some(v => v.lang.toLowerCase().replace('_', '-').split('-')[0] === language);
    return speaks ? 'ok' : 'missing';
  }

  /**
   * True while the app's own voice may be reaching the microphone. The
   * capture service stops segmenting for that long, so a spoken confirmation
   * is never transcribed back as a command — it is phrased exactly like one.
   */
  isAudible(): boolean {
    return Date.now() < this.audibleUntil;
  }

  private readStoredPreference(): boolean {
    try {
      return localStorage.getItem('orthoflow_voice_audio') !== 'off';
    } catch {
      return true;
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabledSignal.set(enabled);
    try {
      localStorage.setItem('orthoflow_voice_audio', enabled ? 'on' : 'off');
    } catch {
      // Private mode: the choice holds for this page load.
    }
    if (!enabled) this.cancel();
  }

  toggle(): void {
    this.setEnabled(!this.enabledSignal());
  }

  isSupported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  /**
   * @param interrupt true for a new confirmation, which should replace
   *   whatever is still being read out — during a fast dictation the doctor
   *   cares about the latest tooth, not a queue of earlier ones.
   */
  speak(text: string, locale = 'en-US', interrupt = true): void {
    if (!this.enabledSignal() || !this.isSupported() || !text.trim()) return;
    try {
      if (interrupt) window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = locale;
      if (this.voices.length === 0) this.voices = window.speechSynthesis.getVoices();
      const voice = pickVoice(this.voices, locale);
      if (voice) utterance.voice = voice;
      utterance.rate = 1.05;
      const finished = () => {
        // An utterance that has been replaced — by the next read-back, or by a
        // cancel — reports its end late. Letting that report set the window
        // would shorten the one the replacement owns, and unmute the
        // microphone while the app is still talking.
        if (this.current !== utterance) return;
        this.current = null;
        this.speakingSignal.set(false);
        this.audibleUntil = Date.now() + ECHO_TAIL_MS;
      };
      utterance.onstart = () => this.speakingSignal.set(true);
      utterance.onend = finished;
      utterance.onerror = finished;
      this.current = utterance;
      this.generationCounter++;
      // Muted from the moment speech is requested, not from onstart: the
      // engine can take a few hundred milliseconds to begin.
      this.audibleUntil = Date.now()
        + Math.min(MAX_AUDIBLE_MS, text.length * MS_PER_CHARACTER) + ECHO_TAIL_MS;
      // A paused engine (Chrome after a tab switch) queues silently forever.
      if (window.speechSynthesis.paused) window.speechSynthesis.resume();
      window.speechSynthesis.speak(utterance);
    } catch {
      // Audio confirmation is an enhancement; the session panel already
      // carries the same information, so a failure here is not worth surfacing.
      this.current = null;
      this.speakingSignal.set(false);
      this.audibleUntil = 0;
    }
  }

  cancel(): void {
    if (!this.isSupported()) return;
    try {
      window.speechSynthesis.cancel();
    } catch {
      // Nothing to cancel.
    }
    this.current = null;
    this.speakingSignal.set(false);
    this.audibleUntil = 0;
  }
}
