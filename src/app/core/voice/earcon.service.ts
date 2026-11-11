import { Injectable, inject } from '@angular/core';
import { SpeechFeedbackService } from './speech-feedback.service';

/**
 * Five short sounds, made with oscillators — no audio file to load or cache.
 *
 * For a doctor who chose "tones" they are the whole confirmation, and for
 * everyone they are what the app says when speaking would talk over someone.
 * Each is short and quiet (−18 dBFS, 10 ms fades), and holds the microphone
 * shut for its own length plus a little, like a spoken read-back does, so a
 * tone is never transcribed as speech.
 */
export type Earcon = 'confirm' | 'proposal' | 'unsure' | 'question' | 'error';

interface Note { hz: number; ms: number }

const TONES: Readonly<Record<Earcon, Note[]>> = {
  // Rising two notes: done.
  confirm: [{ hz: 880, ms: 80 }, { hz: 1320, ms: 80 }],
  // One soft note: something read from the conversation.
  proposal: [{ hz: 660, ms: 60 }],
  // Falling, twice: that looked like a command and was not understood.
  unsure: [{ hz: 330, ms: 90 }, { hz: 0, ms: 50 }, { hz: 330, ms: 90 }],
  // Up and back down: the app needs an answer.
  question: [{ hz: 660, ms: 70 }, { hz: 880, ms: 70 }, { hz: 660, ms: 70 }],
  // One low note: could not be staged, or the save failed.
  error: [{ hz: 220, ms: 250 }],
};

/** −18 dBFS. */
const GAIN = 10 ** (-18 / 20);
const FADE_S = 0.01;
/** The microphone stays shut this much longer than the tone itself. */
const ECHO_TAIL_MS = 120;

export function earconLength(tone: Earcon): number {
  return TONES[tone].reduce((total, note) => total + note.ms, 0);
}

type AudioContextLike = AudioContext;

@Injectable({ providedIn: 'root' })
export class EarconService {
  private readonly speech = inject(SpeechFeedbackService);
  private context: AudioContextLike | null = null;
  private recorder: ((tone: Earcon) => void) | null = null;

  /** The development hook's "mute": tones are listed instead of played. */
  setRecorder(recorder: ((tone: Earcon) => void) | null): void {
    this.recorder = recorder;
  }

  /**
   * Called synchronously inside the tap that starts a consultation: iOS lets
   * audio start only inside a gesture, and the first confirmation comes long
   * after it.
   */
  unlock(): void {
    const context = this.audio();
    if (context && context.state === 'suspended') void context.resume().catch(() => undefined);
  }

  play(tone: Earcon): void {
    const length = earconLength(tone);
    this.speech.holdMicrophone?.(length + ECHO_TAIL_MS);
    if (this.recorder) {
      this.recorder(tone);
      return;
    }
    const context = this.audio();
    if (!context) return;
    try {
      let at = context.currentTime + 0.01;
      for (const note of TONES[tone]) {
        const seconds = note.ms / 1000;
        if (note.hz > 0) {
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          oscillator.type = 'sine';
          oscillator.frequency.setValueAtTime(note.hz, at);
          gain.gain.setValueAtTime(0, at);
          gain.gain.linearRampToValueAtTime(GAIN, at + FADE_S);
          gain.gain.setValueAtTime(GAIN, at + Math.max(FADE_S, seconds - FADE_S));
          gain.gain.linearRampToValueAtTime(0, at + seconds);
          oscillator.connect(gain).connect(context.destination);
          oscillator.start(at);
          oscillator.stop(at + seconds + 0.01);
        }
        at += seconds;
      }
    } catch {
      // A tone is a convenience; the screen says the same.
    }
  }

  private audio(): AudioContextLike | null {
    if (this.context) return this.context;
    try {
      const Ctor = (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
        .AudioContext ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      this.context = Ctor ? new Ctor() : null;
    } catch {
      this.context = null;
    }
    return this.context;
  }
}
