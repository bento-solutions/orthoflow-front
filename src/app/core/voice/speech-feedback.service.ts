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

@Injectable({ providedIn: 'root' })
export class SpeechFeedbackService {
  private enabledSignal = signal(this.readStoredPreference());
  private speakingSignal = signal(false);
  private audibleUntil = 0;

  enabled = this.enabledSignal.asReadonly();
  speaking = this.speakingSignal.asReadonly();

  /**
   * True while the app's own voice may be reaching the microphone. The
   * capture service stops segmenting for that long, so a spoken confirmation
   * is never transcribed back as a command — it is phrased exactly like one.
   */
  isAudible(): boolean {
    return Date.now() < this.audibleUntil;
  }

  private readStoredPreference(): boolean {
    return localStorage.getItem('orthoflow_voice_audio') !== 'off';
  }

  setEnabled(enabled: boolean): void {
    this.enabledSignal.set(enabled);
    localStorage.setItem('orthoflow_voice_audio', enabled ? 'on' : 'off');
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
      utterance.rate = 1.05;
      const finished = () => {
        this.speakingSignal.set(false);
        this.audibleUntil = Date.now() + ECHO_TAIL_MS;
      };
      utterance.onstart = () => this.speakingSignal.set(true);
      utterance.onend = finished;
      utterance.onerror = finished;
      // Muted from the moment speech is requested, not from onstart: the
      // engine can take a few hundred milliseconds to begin.
      this.audibleUntil = Date.now()
        + Math.min(MAX_AUDIBLE_MS, text.length * MS_PER_CHARACTER) + ECHO_TAIL_MS;
      window.speechSynthesis.speak(utterance);
    } catch {
      // Audio confirmation is an enhancement; the session panel already
      // carries the same information, so a failure here is not worth surfacing.
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
    this.speakingSignal.set(false);
    this.audibleUntil = 0;
  }
}
