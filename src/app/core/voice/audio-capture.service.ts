import { Injectable, inject, signal } from '@angular/core';
import { SpeechFeedbackService } from './speech-feedback.service';
import { SpeechBandFilter, toUploadWav, UtteranceSegmenter } from './audio-segmenter';

/**
 * Continuous microphone capture for a voice session, segmented into
 * utterances and shipped as 16 kHz WAV.
 *
 * ── Why this exists alongside SpeechRecognitionService ──────────────────
 *
 * `SpeechRecognitionService` wraps the browser's own recogniser, which has no
 * notion of dental vocabulary and loses clinical terms in French-with-Darija
 * speech. It stays as a fallback. This is the primary path: it records the
 * audio and hands each clip to the server, whose recogniser is told what
 * kind of speech and which command words to expect.
 *
 * ── What made it fail on phones ─────────────────────────────────────────
 *
 * Three separate things, any one of which was enough:
 *
 * 1. The AudioContext was created *after* `await getUserMedia()`. iOS Safari
 *    only lets a context run when it is created or resumed inside the tap
 *    that asked for it, and that allowance does not survive an await. The
 *    context stayed suspended, the level meter read silence forever, and no
 *    utterance ever opened. Both are now started synchronously, before the
 *    first await, and a context the OS suspends later (a call, the screen
 *    locking) is resumed on return or offered back as a tap.
 * 2. A MediaRecorder was started at speech onset, clipping the wake word.
 *    See `audio-segmenter.ts` — audio is now tapped continuously and the
 *    utterance includes a pre-roll.
 * 3. MediaRecorder writes WebM on Chrome and MP4 on Safari. Encoding WAV
 *    ourselves removes the one per-browser difference the server saw.
 *
 * The screen is also kept awake while listening: a phone that dims and locks
 * mid-examination suspends the page and with it the microphone, and the
 * dentist's hands are not free to wake it.
 *
 * ── What is not kept ────────────────────────────────────────────────────
 *
 * Audio is held only until its clip has been posted, then dropped. Nothing is
 * written to disk, and the session buffer stores transcripts rather than
 * recordings — a browser profile should not accumulate consultation audio.
 */

export type CaptureStatus = 'idle' | 'starting' | 'capturing' | 'suspended' | 'error';

/** Served from `public/`; loads under `script-src 'self'`. */
const WORKLET_PATH = 'voice/pcm-capture-worklet.js';

/** The level meter does not need 47 updates a second. */
const LEVEL_INTERVAL_MS = 70;

// ── Speaking over the app ───────────────────────────────────────────────
//
// While the app reads something back the microphone is deaf, because its own
// voice is phrased exactly like a command. A dentist who talks over a read-back
// — correcting a tooth the moment they hear it wrong — used to be lost for the
// whole of it. The microphone now measures how loudly the app's voice comes
// back to it, and only when someone is plainly louder than that does the read-
// back stop and listening resume. Until the first read-back has been measured
// there is nothing to compare against, and the old behaviour holds.

/** A voice must reach at least this level in the speech band to interrupt a read-back. */
const BARGE_IN_MIN_ENERGY = 0.05;
/** ... and this many times the loudest the app's own voice has been heard to be. */
const BARGE_IN_FACTOR = 3;
/**
 * ... for this long, allowing the gaps between words: a cough or a door is not
 * an interruption. Time above the level counts up; time below it counts down
 * twice as fast, so a breath between two words does not start the count over.
 */
const BARGE_IN_HOLD_MS = 350;
/** Audio kept while the app speaks, so the start of what interrupts it is not lost. */
const BARGE_IN_RING_MS = 1000;
/** The measured level decays by this each read-back, so a loud one does not mute barging for good. */
const ECHO_DECAY = 0.9;
/** Frames a read-back must last to say anything about the echo. */
const ECHO_MIN_FRAMES = 5;
/** Interruptions that produced nothing, in a row, after which the feature stops for the session. */
const MAX_FALSE_BARGES = 2;
/** Same ceiling as the segmenter's threshold: within an ordinary voice's reach. */
const BARGE_IN_MAX_ENERGY = 0.14;

const BARGE_IN_PREFERENCE_KEY = 'orthoflow_voice_bargein';

function bargeInPreferred(): boolean {
  try {
    return localStorage.getItem(BARGE_IN_PREFERENCE_KEY) !== 'off';
  } catch {
    return true;
  }
}

type AudioContextCtor = new (options?: AudioContextOptions) => AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

@Injectable({ providedIn: 'root' })
export class AudioCaptureService {
  private feedback = inject(SpeechFeedbackService);

  private statusSignal = signal<CaptureStatus>('idle');
  private levelSignal = signal(0);
  private speakingSignal = signal(false);
  private pausedSignal = signal(false);
  private errorSignal = signal<string | null>(null);

  status = this.statusSignal.asReadonly();
  /** 0–1 input level, so the dentist can see the microphone hears them. */
  level = this.levelSignal.asReadonly();
  /** True while an utterance is being recorded. */
  speaking = this.speakingSignal.asReadonly();
  /** Listening is paused without releasing the microphone. */
  paused = this.pausedSignal.asReadonly();
  lastError = this.errorSignal.asReadonly();

  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private tap: AudioNode | null = null;
  private sink: GainNode | null = null;
  private segmenter: UtteranceSegmenter | null = null;
  private wakeLock: WakeLockSentinel | null = null;
  private starting: Promise<boolean> | null = null;
  private lastLevelAt = 0;

  // Speaking over a read-back. See the constants above.
  private echoBand: SpeechBandFilter | null = null;
  /** The loudest the app's own voice has recently been heard to be, or null before the first read-back. */
  private echoLevel: number | null = null;
  private playback: { generation: number; peak: number; frames: number; barged: boolean } | null = null;
  private ring: Array<{ seq: number; frame: Float32Array }> = [];
  private ringSamples = 0;
  private ringSeq = 0;
  private bargeRunMs = 0;
  /** The first frame of the stretch of speech being counted. */
  private bargeRunStart: number | null = null;
  /** An interruption was acted on and no clip has come of it yet. */
  private bargePending = false;
  private falseBarges = 0;

  private onUtterance: ((clip: Blob) => void) | null = null;

  /** Called with each closed utterance. Set before {@link start}. */
  setUtteranceHandler(handler: (clip: Blob) => void): void {
    this.onUtterance = handler;
  }

  isSupported(): boolean {
    return typeof window !== 'undefined'
      && window.isSecureContext
      && !!navigator.mediaDevices?.getUserMedia
      && audioContextCtor() !== null;
  }

  isActive(): boolean {
    const status = this.statusSignal();
    return status === 'capturing' || status === 'suspended' || status === 'starting';
  }

  /**
   * Opens the microphone and begins segmenting.
   *
   * **Call this synchronously from the tap or click that asked for it**,
   * before awaiting anything else — see the class comment for why iOS
   * requires it.
   *
   * @param options.paused open the microphone without acting on speech yet —
   *   for a tap that must open it immediately, while the session it belongs
   *   to is still being created.
   * @returns false when capture could not start; {@link lastError} says why.
   */
  start(options: { paused?: boolean } = {}): Promise<boolean> {
    if (this.starting) return this.starting;
    const status = this.statusSignal();
    if (status === 'capturing' || status === 'suspended') {
      void this.resume();
      return Promise.resolve(true);
    }
    this.pausedSignal.set(options.paused ?? false);
    this.starting = this.open().finally(() => { this.starting = null; });
    return this.starting;
  }

  private async open(): Promise<boolean> {
    this.errorSignal.set(null);

    if (typeof window === 'undefined' || !window.isSecureContext) {
      return this.fail('The microphone only works over a secure connection. Open OrthoFlow from its https:// address.');
    }
    const Ctor = audioContextCtor();
    if (!navigator.mediaDevices?.getUserMedia || !Ctor) {
      return this.fail('This browser cannot capture audio from the microphone.');
    }

    this.statusSignal.set('starting');

    // Both requests leave before the first await — iOS only honours them
    // inside the user's tap.
    let context: AudioContext;
    try {
      context = new Ctor({ latencyHint: 'interactive' });
    } catch {
      return this.fail('Could not open the audio pipeline.');
    }
    this.context = context;
    const resumed = context.resume().catch(() => undefined);
    const streamRequest = navigator.mediaDevices.getUserMedia({
      audio: {
        // A consultation room has suction, handpieces and a second person in
        // it. These are the browser's own DSP and cost nothing.
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });

    let stream: MediaStream;
    try {
      stream = await streamRequest;
    } catch (error) {
      this.teardown();
      return this.fail(describeGetUserMediaError(error));
    }
    await resumed;

    // Stopped while the permission prompt was up.
    if (this.context !== context) {
      stream.getTracks().forEach(track => track.stop());
      return false;
    }
    this.stream = stream;

    try {
      this.source = context.createMediaStreamSource(stream);
      // The tap has to reach the destination to be pulled on every engine;
      // a muted gain keeps the microphone out of the speaker.
      this.sink = context.createGain();
      this.sink.gain.value = 0;
      this.sink.connect(context.destination);
      this.tap = await this.createTap(context);
      this.source.connect(this.tap);
      this.tap.connect(this.sink);
    } catch {
      this.teardown();
      return this.fail('Could not open the audio pipeline.');
    }

    this.segmenter = new UtteranceSegmenter({ sampleRate: context.sampleRate });
    stream.getAudioTracks().forEach(track => track.addEventListener('ended', this.onTrackEnded));
    context.onstatechange = () => this.syncContextState();
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    void this.acquireWakeLock();
    this.syncContextState();
    return true;
  }

  /**
   * Resumes a context the OS suspended. Safe to call from any tap; on iOS it
   * is the only thing that will bring the microphone back after a call.
   */
  async resume(): Promise<void> {
    if (!this.context) return;
    try {
      await this.context.resume();
    } catch {
      // Stays suspended; the status says so and the UI offers the tap again.
    }
    this.syncContextState();
    void this.acquireWakeLock();
  }

  /** Stops acting on speech without releasing the microphone. */
  setPaused(paused: boolean): void {
    this.pausedSignal.set(paused);
    this.segmenter?.discard();
    if (paused) this.publish(0, false, true);
  }

  stop(): void {
    // Ship whatever is mid-utterance rather than discarding a finding the
    // dentist has already said.
    const context = this.context;
    const tail = this.pausedSignal() ? null : this.segmenter?.flush() ?? null;
    if (tail && context) this.emit(tail, context.sampleRate);

    this.teardown();
    if (this.statusSignal() !== 'error') this.statusSignal.set('idle');
  }

  // ── Audio graph ─────────────────────────────────────────────────────

  private async createTap(context: AudioContext): Promise<AudioNode> {
    if (context.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
      try {
        await context.audioWorklet.addModule(new URL(WORKLET_PATH, document.baseURI).href);
        const node = new AudioWorkletNode(context, 'pcm-capture', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          channelCount: 1,
          channelCountMode: 'explicit',
        });
        node.port.onmessage = (event: MessageEvent<Float32Array>) => this.onFrame(event.data);
        return node;
      } catch {
        // Fall through to the legacy tap.
      }
    }
    // Deprecated, but the only tap older WebKit has — a working microphone on
    // an old iPad beats a modern one that never opens.
    const processor = context.createScriptProcessor(2048, 1, 1);
    processor.onaudioprocess = event => this.onFrame(new Float32Array(event.inputBuffer.getChannelData(0)));
    return processor;
  }

  private onFrame(frame: Float32Array): void {
    const segmenter = this.segmenter;
    if (!segmenter || !this.context) return;

    // Half-duplex. Echo cancellation does not reliably cover speech
    // synthesis, and a spoken confirmation transcribed back is the worst
    // possible false trigger — it is phrased exactly like a command.
    if (this.pausedSignal()) {
      segmenter.discard();
      this.publish(0, false);
      return;
    }
    if (this.feedback.isAudible()) {
      segmenter.discard();
      this.publish(0, false);
      this.duringPlayback(frame);
      return;
    }
    this.finishPlayback();

    const clip = segmenter.push(frame);
    this.publish(segmenter.level, segmenter.speaking);
    if (clip) this.emit(clip, this.context.sampleRate);
  }

  /**
   * The app is speaking. Measures how loudly its voice reaches the microphone,
   * and stops it if someone is plainly louder.
   */
  private duringPlayback(frame: Float32Array): void {
    const context = this.context;
    if (!context) return;
    // A new read-back is a new measurement.
    const generation = this.feedback.generation ?? 0;
    if (this.playback && this.playback.generation !== generation) this.finishPlayback();
    if (!this.playback) {
      this.playback = { generation, peak: 0, frames: 0, barged: false };
      // A filter that last saw the end of the previous read-back — or someone
      // talking over it — would colour the first frames of this one.
      this.echoBand = new SpeechBandFilter(context.sampleRate);
    }
    const energy = this.echoBand!.rms(frame);
    this.playback.peak = Math.max(this.playback.peak, energy);
    this.playback.frames++;

    const frameMs = (frame.length / context.sampleRate) * 1000;
    const seq = this.ringSeq++;
    this.ring.push({ seq, frame });
    this.ringSamples += frame.length;
    const limit = Math.ceil((BARGE_IN_RING_MS / 1000) * context.sampleRate);
    while (this.ring.length > 1 && this.ringSamples - this.ring[0].frame.length >= limit) {
      this.ringSamples -= this.ring.shift()!.frame.length;
    }

    if (this.echoLevel === null || this.falseBarges >= MAX_FALSE_BARGES || !bargeInPreferred()) return;
    const needed = Math.min(BARGE_IN_MAX_ENERGY, Math.max(BARGE_IN_MIN_ENERGY, this.echoLevel * BARGE_IN_FACTOR));
    if (energy < needed) {
      this.bargeRunMs = Math.max(0, this.bargeRunMs - frameMs * 2);
      if (this.bargeRunMs === 0) this.bargeRunStart = null;
      return;
    }
    this.bargeRunStart ??= seq;
    this.bargeRunMs += frameMs;
    if (this.bargeRunMs >= BARGE_IN_HOLD_MS) this.bargeIn();
  }

  /** Someone is speaking over the app: it stops, and what they have said so far is kept. */
  private bargeIn(): void {
    const segmenter = this.segmenter;
    const context = this.context;
    if (!segmenter || !context || !this.playback) return;

    // The previous interruption produced no clip: that was the app hearing
    // itself. Twice in a row and the feature stands down for the session.
    if (this.bargePending) this.falseBarges++;
    this.bargePending = true;
    this.playback.barged = true;

    // The frames of the interruption, with a little before them.
    const from = (this.bargeRunStart ?? this.ringSeq) - 2;
    const kept = this.ring.filter(entry => entry.seq >= from);
    this.ring = [];
    this.ringSamples = 0;
    this.bargeRunMs = 0;
    this.bargeRunStart = null;

    this.feedback.cancel();
    for (const { frame } of kept) {
      const clip = segmenter.push(frame);
      this.publish(segmenter.level, segmenter.speaking);
      if (clip) this.emit(clip, context.sampleRate);
    }
  }

  /** The app has stopped speaking: what its voice measured becomes the baseline. */
  private finishPlayback(): void {
    const playback = this.playback;
    this.playback = null;
    this.ring = [];
    this.ringSamples = 0;
    this.bargeRunMs = 0;
    this.bargeRunStart = null;
    // A read-back someone spoke over says how loud they are, not the app.
    if (!playback || playback.barged || playback.frames < ECHO_MIN_FRAMES) return;
    this.echoLevel = Math.max(playback.peak, (this.echoLevel ?? 0) * ECHO_DECAY);
  }

  private publish(level: number, speaking: boolean, force = false): void {
    if (speaking !== this.speakingSignal()) this.speakingSignal.set(speaking);
    const now = performance.now();
    if (force || now - this.lastLevelAt >= LEVEL_INTERVAL_MS) {
      this.lastLevelAt = now;
      this.levelSignal.set(level);
    }
  }

  private emit(samples: Float32Array, sampleRate: number): void {
    // Something came of the last interruption: it was a person.
    this.bargePending = false;
    this.falseBarges = 0;
    const wav = toUploadWav(samples, sampleRate);
    this.onUtterance?.(new Blob([wav], { type: 'audio/wav' }));
  }

  private syncContextState(): void {
    const context = this.context;
    if (!context || this.statusSignal() === 'error') return;
    if (context.state === 'running') {
      this.statusSignal.set('capturing');
      return;
    }
    if (context.state === 'closed') return;
    // 'suspended', or WebKit's 'interrupted' after a phone call.
    this.statusSignal.set('suspended');
    this.publish(0, false, true);
    void context.resume().catch(() => undefined);
  }

  private onVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') void this.resume();
  };

  /** The OS took the microphone — a phone call, another app, a headset unplugged. */
  private onTrackEnded = (): void => {
    this.teardown();
    this.fail('The microphone was disconnected or taken by another app. Start listening again.');
  };

  private async acquireWakeLock(): Promise<void> {
    if (this.wakeLock || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    try {
      const sentinel = await navigator.wakeLock.request('screen');
      // Released by the browser whenever the page is hidden.
      sentinel.addEventListener('release', () => {
        if (this.wakeLock === sentinel) this.wakeLock = null;
      });
      this.wakeLock = sentinel;
    } catch {
      // Low battery mode or an unsupported browser. Listening still works
      // while the screen is on.
    }
  }

  private teardown(): void {
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.stream?.getAudioTracks().forEach(track => track.removeEventListener('ended', this.onTrackEnded));
    try { this.source?.disconnect(); } catch { /* already */ }
    try { this.tap?.disconnect(); } catch { /* already */ }
    try { this.sink?.disconnect(); } catch { /* already */ }
    if (typeof AudioWorkletNode !== 'undefined' && this.tap instanceof AudioWorkletNode) {
      this.tap.port.onmessage = null;
    }
    this.stream?.getTracks().forEach(track => track.stop());
    if (this.context) {
      this.context.onstatechange = null;
      void this.context.close().catch(() => undefined);
    }
    void this.wakeLock?.release().catch(() => undefined);

    this.context = null;
    this.stream = null;
    this.source = null;
    this.tap = null;
    this.sink = null;
    this.segmenter = null;
    this.wakeLock = null;
    this.echoBand = null;
    this.echoLevel = null;
    this.playback = null;
    this.ring = [];
    this.ringSamples = 0;
    this.bargeRunMs = 0;
    this.bargeRunStart = null;
    this.bargePending = false;
    this.falseBarges = 0;
    this.pausedSignal.set(false);
    this.publish(0, false, true);
  }

  private fail(message: string): false {
    this.errorSignal.set(message);
    this.statusSignal.set('error');
    return false;
  }
}

function describeGetUserMediaError(error: unknown): string {
  const name = (error as { name?: string } | null)?.name ?? '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Microphone access is blocked for this site. Allow it in the browser\'s site settings '
        + '(iPhone: aA › Website Settings › Microphone; Android: lock icon › Permissions), then try again.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No microphone was found.';
    case 'NotReadableError':
    case 'AbortError':
      return 'The microphone is in use by another app. Close it, then try again.';
    case 'OverconstrainedError':
      return 'The microphone does not support the requested settings.';
    default:
      return 'Could not open the microphone.';
  }
}
