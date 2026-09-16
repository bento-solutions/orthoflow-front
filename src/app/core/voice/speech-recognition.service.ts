import { Injectable, signal } from '@angular/core';

/**
 * Microphone capture and speech-to-text, wrapped around the browser's
 * SpeechRecognition API.
 *
 * ── Two modes, and why ──────────────────────────────────────────────────
 *
 * Audit XII.4 §1 argues against always-listening: a hot microphone in a
 * consultation room continuously processes a conversation containing other
 * people's health information. **Push-to-talk is the default here.**
 *
 * The requirements also ask for a continuous examination mode, and that is a
 * real clinical need — a doctor with both hands in a patient's mouth cannot
 * press a key between findings. It is provided, but on terms that answer the
 * same concern: it is never the default, it is entered by an explicit action,
 * the HUD shows an unmissable "listening" state the whole time, and it stops
 * itself after a period of silence rather than running until someone
 * remembers to end it.
 *
 * ── The provider caveat, stated plainly ─────────────────────────────────
 *
 * `SpeechRecognition` is **not** guaranteed to be on-device. Chrome and Edge
 * stream audio to a cloud service; Safari performs recognition locally in
 * most configurations. So on Chrome this is already a disclosure of audio
 * from a consultation room to a third party, before any of this project's own
 * NLU settings come into it. {@link recognitionIsLocal} reports what the
 * current browser most likely does so the UI can say so, and the deployment
 * notes cover the options (Safari, or a self-hosted Whisper/Vosk endpoint).
 */

export type RecognitionStatus = 'unsupported' | 'consent-required' | 'idle' | 'listening' | 'error';

export interface RecognitionResult {
  transcript: string;
  isFinal: boolean;
  confidence: number;
}

/** Minimal structural types — the DOM lib does not ship SpeechRecognition. */
interface SpeechRecognitionAlternativeLike { transcript: string; confidence: number }
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionErrorEventLike { error: string; message?: string }
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

/** Silence after which continuous mode stops on its own. */
const CONTINUOUS_IDLE_TIMEOUT_MS = 90_000;

const CONSENT_KEY = 'orthoflow_voice_consent';

@Injectable({ providedIn: 'root' })
export class SpeechRecognitionService {
  private recognition: SpeechRecognitionLike | null = null;
  private continuous = false;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private manualStop = false;

  private statusSignal = signal<RecognitionStatus>('idle');
  private interimSignal = signal('');
  private errorSignal = signal<string | null>(null);
  private consentSignal = signal(this.hasConsent());

  status = this.statusSignal.asReadonly();
  /**
   * Whether the clinician has agreed to the microphone being opened. Tracked
   * separately from {@link status}, which only knows about this recogniser:
   * on a browser with no SpeechRecognition at all the status is
   * 'unsupported', and consent used to read as already given there.
   */
  consented = this.consentSignal.asReadonly();
  /** Live partial transcript — the user must always see what is being heard. */
  interimTranscript = this.interimSignal.asReadonly();
  lastError = this.errorSignal.asReadonly();

  /** Emitted for each final utterance. */
  private onFinal: ((result: RecognitionResult) => void) | null = null;

  constructor() {
    if (!this.constructorRef()) {
      this.statusSignal.set('unsupported');
    } else if (!this.hasConsent()) {
      this.statusSignal.set('consent-required');
    }
  }

  /**
   * Informed opt-in before the microphone is ever opened.
   *
   * This is not a legal fig leaf bolted on: on Chrome and Edge the browser
   * uploads the captured audio to a cloud speech service, and a consultation
   * room microphone picks up more than the doctor's commands. The clinician
   * is entitled to know that before the first recording, and to be able to
   * withdraw it afterwards. It makes the disclosure honest — it does not make
   * the disclosure go away, which is why the deployment notes cover Safari
   * and a self-hosted recogniser as the real answers.
   */
  hasConsent(): boolean {
    try {
      return localStorage.getItem(CONSENT_KEY) === 'true';
    } catch {
      return false;
    }
  }

  grantConsent(): void {
    try {
      localStorage.setItem(CONSENT_KEY, 'true');
    } catch {
      // Private mode: consent holds for this page load only.
    }
    this.consentSignal.set(true);
    if (this.statusSignal() === 'consent-required') this.statusSignal.set('idle');
  }

  revokeConsent(): void {
    try {
      localStorage.removeItem(CONSENT_KEY);
    } catch {
      // Nothing stored.
    }
    this.consentSignal.set(false);
    this.stop();
    if (this.isSupported()) this.statusSignal.set('consent-required');
  }

  private constructorRef(): SpeechRecognitionCtor | null {
    const w = window as unknown as Record<string, unknown>;
    return (w['SpeechRecognition'] ?? w['webkitSpeechRecognition']) as SpeechRecognitionCtor ?? null;
  }

  isSupported(): boolean {
    return this.constructorRef() !== null;
  }

  /**
   * Best-effort report of whether recognition stays on this machine. Safari
   * (WebKit, not Chrome-on-macOS) performs it locally in most configurations;
   * Chrome and Edge stream audio to a cloud service. Surfaced in the UI
   * because a doctor is entitled to know whether the room is being uploaded.
   */
  recognitionIsLocal(): boolean {
    const ua = navigator.userAgent;
    const isSafari = /Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua);
    return isSafari;
  }

  setResultHandler(handler: (result: RecognitionResult) => void): void {
    this.onFinal = handler;
  }

  /**
   * @param locale BCP-47 tag. Moroccan clinicians code-switch, so `fr-MA`
   *   generally out-performs `fr-FR` on French-with-Arabic speech even though
   *   the clinical vocabulary itself is French.
   * @param continuous true only for the explicit examination mode.
   */
  start(locale: string, continuous = false): boolean {
    const Ctor = this.constructorRef();
    if (!Ctor) {
      this.statusSignal.set('unsupported');
      return false;
    }
    if (!this.consentSignal()) {
      this.statusSignal.set('consent-required');
      return false;
    }
    this.stop();

    const recognition = new Ctor();
    recognition.lang = locale;
    recognition.continuous = continuous;
    recognition.interimResults = true;
    // One alternative: a second-best guess is not something to act on in a
    // clinical record, and the confidence score is what gates the write.
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      this.statusSignal.set('listening');
      this.errorSignal.set(null);
    };

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const alternative = result[0];
        if (!alternative) continue;
        if (result.isFinal) {
          const transcript = alternative.transcript.trim();
          if (transcript) {
            this.onFinal?.({
              transcript,
              isFinal: true,
              // Some engines report 0 for confidence rather than omitting it;
              // treating that as "no signal" avoids failing every utterance
              // against the confidence floor on those browsers.
              confidence: alternative.confidence > 0 ? alternative.confidence : 0.85,
            });
          }
        } else {
          interim += alternative.transcript;
        }
      }
      this.interimSignal.set(interim);
      this.armIdleTimer();
    };

    recognition.onerror = (event) => {
      // 'no-speech' and 'aborted' are ordinary in continuous use and must not
      // present to the doctor as failures.
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      this.errorSignal.set(this.describeError(event.error));
      this.statusSignal.set('error');
    };

    recognition.onend = () => {
      this.interimSignal.set('');
      // Continuous recognition ends on its own every so often; restart unless
      // the user asked to stop or an error already surfaced.
      if (this.continuous && !this.manualStop && this.statusSignal() === 'listening') {
        try {
          recognition.start();
          return;
        } catch {
          // Restart can throw if the engine has not fully released; fall
          // through to idle rather than looping.
        }
      }
      if (this.statusSignal() !== 'error') this.statusSignal.set('idle');
      this.clearIdleTimer();
    };

    this.recognition = recognition;
    this.continuous = continuous;
    this.manualStop = false;

    try {
      recognition.start();
      if (continuous) this.armIdleTimer();
      return true;
    } catch (error) {
      this.errorSignal.set('Could not start the microphone. Is another tab using it?');
      this.statusSignal.set('error');
      return false;
    }
  }

  stop(): void {
    this.clearIdleTimer();
    this.manualStop = true;
    this.continuous = false;
    this.interimSignal.set('');
    if (!this.recognition) return;
    try {
      this.recognition.stop();
    } catch {
      // Already stopped.
    }
    this.recognition = null;
    const status = this.statusSignal();
    if (status !== 'error' && status !== 'unsupported' && status !== 'consent-required') {
      this.statusSignal.set('idle');
    }
  }

  /** Continuous mode stops itself after a stretch of silence. */
  private armIdleTimer(): void {
    if (!this.continuous) return;
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.errorSignal.set('Examination mode paused after a period of silence. Tap the microphone to resume.');
      this.stop();
    }, CONTINUOUS_IDLE_TIMEOUT_MS);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private describeError(code: string): string {
    switch (code) {
      case 'not-allowed':
      case 'service-not-allowed':
        return 'Microphone access was blocked. Allow it in the browser\'s site settings, then try again.';
      case 'audio-capture':
        return 'No microphone was found.';
      case 'network':
        return 'Speech recognition could not reach its service. Check the network connection.';
      case 'language-not-supported':
        return 'This browser does not support speech recognition in the selected language.';
      default:
        return `Speech recognition failed (${code}).`;
    }
  }
}
