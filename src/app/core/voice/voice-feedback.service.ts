import { Injectable, inject, signal } from '@angular/core';
import { AudioCaptureService } from './audio-capture.service';
import { Earcon, EarconService } from './earcon.service';
import { SpeechFeedbackService } from './speech-feedback.service';
import { FeedbackLevel, VoicePreferencesService } from './voice-preferences.service';
import { Spoken } from './voice-vocabulary';

/**
 * Decides, for everything the app has to tell the doctor, whether it is said,
 * said briefly, sounded as a tone, or only shown — from the doctor's feedback
 * level and what kind of thing it is (docs/VOICE-COCKPIT-PLAN.md part I §4):
 *
 * | What happened                         | full      | brief     | tones          | silent |
 * |---------------------------------------|-----------|-----------|----------------|--------|
 * | staged, corrected, dictated (confirm) | read-back | "noté"    | rising tone    | —      |
 * | read from the conversation (proposal) | read-back | "noté"    | soft tone      | —      |
 * | a view or camera command (view)       | one line  | its name  | rising tone    | —      |
 * | looked like a command, not understood | "Pas compris" after the wake word, else falling tone | falling tone | falling tone | — |
 * | the app needs an answer (question)    | spoken    | spoken    | question tone  | —      |
 * | could not be staged, save failed      | spoken    | spoken    | error tone     | —      |
 * | microphone lost, service down (alarm) | spoken unless alarms are off, whatever the level            |
 * | explicitly asked for (asked)          | spoken, whatever the level                                  |
 *
 * And two rules for everything spoken. **Never over a voice**: when someone is
 * speaking as a confirmation comes due, it waits for a short silence, at most a
 * couple of seconds, and past that it becomes a tone — the screen has it anyway.
 * **Short**: a brief line is at most 60 characters.
 */
export type FeedbackCue = 'confirm' | 'proposal' | 'view' | 'unsure' | 'question' | 'error' | 'alarm' | 'asked';

export interface FeedbackLines {
  full: Spoken | null;
  brief?: Spoken | null;
}

export interface FeedbackOptions {
  /** The doctor addressed the system (wake word, typed): "Pas compris" is an answer to them. */
  asked?: boolean;
}

/** What one delivery does, before politeness: the words to say, or the tone, or nothing. */
export interface FeedbackDecision {
  say: 'full' | 'brief' | null;
  tone: Earcon | null;
}

/** Silence needed before speaking over someone who just started talking. */
export const POLITE_SILENCE_MS = 350;
/** Past this, a confirmation that is still waiting becomes a tone. */
export const POLITE_MAX_WAIT_MS = 2_500;
export const BRIEF_MAX_CHARS = 60;
const POLL_MS = 50;

const TONE_FOR: Readonly<Record<FeedbackCue, Earcon | null>> = {
  confirm: 'confirm',
  proposal: 'proposal',
  view: 'confirm',
  unsure: 'unsure',
  question: 'question',
  error: 'error',
  alarm: null,
  asked: null,
};

/** The table above, as a function: the spec checks every cell of it. */
export function decideFeedback(
  cue: FeedbackCue,
  level: FeedbackLevel,
  options: { asked?: boolean; criticalAlerts?: boolean } = {},
): FeedbackDecision {
  if (cue === 'asked') return { say: 'full', tone: null };
  if (cue === 'alarm') return { say: options.criticalAlerts === false ? null : 'full', tone: null };
  if (level === 'silent') return { say: null, tone: null };
  if (level === 'tones') return { say: null, tone: TONE_FOR[cue] };
  if (cue === 'unsure') {
    return level === 'full' && options.asked ? { say: 'full', tone: null } : { say: null, tone: 'unsure' };
  }
  if (cue === 'question' || cue === 'error') return { say: 'full', tone: null };
  return { say: level, tone: null };
}

function briefOf(cue: FeedbackCue, lines: FeedbackLines): Spoken | null {
  if (lines.brief) return lines.brief;
  const full = lines.full;
  if (!full) return null;
  const fr = full.locale.toLowerCase().startsWith('fr');
  if (cue === 'confirm' || cue === 'proposal') return { text: fr ? 'Noté.' : 'Noted.', locale: full.locale };
  return { text: full.text.length <= BRIEF_MAX_CHARS ? full.text : `${full.text.slice(0, BRIEF_MAX_CHARS - 1).trimEnd()}…`, locale: full.locale };
}

@Injectable({ providedIn: 'root' })
export class VoiceFeedbackService {
  private readonly prefs = inject(VoicePreferencesService);
  private readonly speech = inject(SpeechFeedbackService);
  private readonly earcons = inject(EarconService);
  private readonly capture = inject(AudioCaptureService);

  private waiting: { spoken: Spoken; tone: Earcon | null; since: number; quietSince: number | null } | null = null;
  private poll: ReturnType<typeof setInterval> | null = null;
  private readonly lastSignal = signal<Spoken | null>(null);

  /** The last confirmation said or shown, for "Calypso, répète". */
  readonly last = this.lastSignal.asReadonly();

  deliver(cue: FeedbackCue, lines: FeedbackLines, options: FeedbackOptions = {}): FeedbackDecision {
    const decision = decideFeedback(cue, this.prefs.level(), { asked: options.asked, criticalAlerts: this.prefs.criticalAlerts() });
    if (lines.full && cue !== 'alarm') this.lastSignal.set(lines.full);

    const spoken = decision.say === 'full' ? lines.full : decision.say === 'brief' ? briefOf(cue, lines) : null;
    if (spoken?.text.trim()) {
      // An alarm, an answer the doctor asked for and a question cannot wait
      // their turn: each is what they need to hear next.
      const urgent = cue === 'alarm' || cue === 'asked' || cue === 'question';
      if (!urgent && this.someoneSpeaking()) this.waitForSilence(spoken, TONE_FOR[cue]);
      else this.say(spoken);
    } else if (decision.tone) {
      this.earcons.play(decision.tone);
    }
    return decision;
  }

  /** Stops whatever is being said, and anything waiting to be: "Calypso, silence". */
  cancel(): void {
    this.clearWaiting();
    this.speech.cancel();
  }

  private say(spoken: Spoken): void {
    this.clearWaiting();
    this.speech.speak(spoken.text, spoken.locale);
  }

  private someoneSpeaking(): boolean {
    try {
      return this.capture.speaking();
    } catch {
      return false;
    }
  }

  /** The latest confirmation replaces one still waiting: during a fast dictation the newest tooth is the one that matters. */
  private waitForSilence(spoken: Spoken, tone: Earcon | null): void {
    this.waiting = { spoken, tone, since: Date.now(), quietSince: null };
    if (this.poll !== null) return;
    this.poll = setInterval(() => this.check(), POLL_MS);
  }

  private check(): void {
    const waiting = this.waiting;
    if (!waiting) {
      this.clearWaiting();
      return;
    }
    const now = Date.now();
    if (this.someoneSpeaking()) {
      waiting.quietSince = null;
    } else if (waiting.quietSince === null) {
      waiting.quietSince = now;
    }
    if (waiting.quietSince !== null && now - waiting.quietSince >= POLITE_SILENCE_MS) {
      this.say(waiting.spoken);
      return;
    }
    if (now - waiting.since >= POLITE_MAX_WAIT_MS) {
      this.clearWaiting();
      if (waiting.tone) this.earcons.play(waiting.tone);
    }
  }

  private clearWaiting(): void {
    this.waiting = null;
    if (this.poll !== null) clearInterval(this.poll);
    this.poll = null;
  }
}
