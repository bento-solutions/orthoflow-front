import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioCaptureService } from './audio-capture.service';
import { SpeechFeedbackService } from './speech-feedback.service';

/**
 * The part of dictation that happens before any word is recognised: opening
 * the microphone, noticing it was lost, and deciding what is worth posting.
 * The audio stack is replaced by recorders; what is pinned is the order things
 * are asked for (iOS refuses anything after an await), what the status says
 * when the microphone goes, and that the app's own voice is never posted back.
 */

const RATE = 48_000;
const FRAME = 1024;

class FakeTrack {
  stopped = false;
  private listeners = new Map<string, Set<() => void>>();
  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, (this.listeners.get(type) ?? new Set()).add(listener));
  }
  removeEventListener(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener);
  }
  stop() { this.stopped = true; }
  end() { this.listeners.get('ended')?.forEach(listener => listener()); }
}

class FakeStream {
  track = new FakeTrack();
  getTracks() { return [this.track]; }
  getAudioTracks() { return [this.track]; }
}

class FakeNode {
  connected = true;
  connect() { return this; }
  disconnect() { this.connected = false; }
  gain = { value: 1 };
}

class FakeProcessor extends FakeNode {
  onaudioprocess: ((event: { inputBuffer: { getChannelData: () => Float32Array } }) => void) | null = null;
}

let contexts: FakeContext[];
let events: string[];

class FakeContext {
  state: 'running' | 'suspended' | 'closed' | 'interrupted' = 'running';
  sampleRate = RATE;
  destination = {};
  onstatechange: (() => void) | null = null;
  processor = new FakeProcessor();
  closed = false;

  constructor() {
    events.push('context');
    contexts.push(this);
  }
  resume() { events.push('resume'); this.state = 'running'; return Promise.resolve(); }
  close() { this.closed = true; this.state = 'closed'; return Promise.resolve(); }
  createMediaStreamSource() { return new FakeNode(); }
  createGain() { return new FakeNode(); }
  createScriptProcessor() { return this.processor; }
  /** The OS suspends or returns the audio. */
  setState(state: FakeContext['state']) {
    this.state = state;
    this.onstatechange?.();
  }
  /** One frame of sound arrives from the microphone. */
  hear(frame: Float32Array) {
    this.processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => frame } });
  }
}

/** Voice-like: a tone whose level rises and falls like syllables. */
let clock = 0;
function voiced(amplitude = 0.3): Float32Array {
  const frame = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) {
    const t = (clock + i) / RATE;
    const syllables = 0.15 + 0.85 * Math.abs(Math.sin(Math.PI * 5 * t));
    frame[i] = amplitude * syllables * Math.sin(((clock + i) * 2 * Math.PI * 220) / RATE);
  }
  clock += FRAME;
  return frame;
}
const silence = () => new Float32Array(FRAME);
const frames = (count: number, make: () => Float32Array) => Array.from({ length: count }, make);

/** A frame is about 21 ms: a beat of quiet, a sentence, then the pause that ends it. */
const QUIET_BEFORE = 28;
const SENTENCE = 56;
const PAUSE_AFTER = 56;

describe('AudioCaptureService', () => {
  let capture: AudioCaptureService;
  let audible: boolean;
  let generation: number;
  let cancelled: number;
  let stream: FakeStream;
  let permission: Promise<FakeStream> | null;
  let clips: Blob[];

  beforeEach(() => {
    contexts = [];
    events = [];
    clips = [];
    audible = false;
    generation = 0;
    cancelled = 0;
    localStorage.removeItem('orthoflow_voice_bargein');
    stream = new FakeStream();
    permission = null;

    vi.stubGlobal('AudioContext', FakeContext);
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn(() => {
          events.push('getUserMedia');
          return permission ?? Promise.resolve(stream);
        }),
      },
    });
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });

    TestBed.configureTestingModule({
      providers: [{
        provide: SpeechFeedbackService,
        useValue: {
          isAudible: () => audible,
          get generation() { return generation; },
          // What the real service does: the read-back stops and the microphone is no longer muted.
          cancel: () => { cancelled++; audible = false; },
        },
      }],
    });
    capture = TestBed.inject(AudioCaptureService);
    capture.setUtteranceHandler(clip => clips.push(clip));
  });

  afterEach(() => {
    capture.stop();
    vi.unstubAllGlobals();
  });

  const ctx = () => contexts[0];

  /** Someone says one sentence into the microphone. */
  const sentence = () => {
    frames(QUIET_BEFORE, silence).forEach(frame => ctx().hear(frame));
    frames(SENTENCE, voiced).forEach(frame => ctx().hear(frame));
    frames(PAUSE_AFTER, silence).forEach(frame => ctx().hear(frame));
  };

  // ── Opening the microphone ──────────────────────────────────────────

  it('opens the audio context and asks for the microphone before awaiting anything', async () => {
    const started = capture.start();

    // iOS only honours both inside the tap: nothing may have been awaited yet.
    expect(events).toEqual(['context', 'resume', 'getUserMedia']);

    expect(await started).toBe(true);
    expect(capture.status()).toBe('capturing');
    expect(capture.isActive()).toBe(true);
  });

  it('does not open a second microphone while one is opening', async () => {
    const first = capture.start();
    const second = capture.start();

    await Promise.all([first, second]);

    expect(contexts).toHaveLength(1);
  });

  it('says why when the microphone is blocked, and is left with nothing open', async () => {
    permission = Promise.reject({ name: 'NotAllowedError' });

    expect(await capture.start()).toBe(false);

    expect(capture.status()).toBe('error');
    expect(capture.lastError()).toMatch(/blocked for this site/);
    expect(ctx().closed).toBe(true);
    expect(capture.isActive()).toBe(false);
  });

  it('says so when there is no microphone, or another app has it', async () => {
    permission = Promise.reject({ name: 'NotFoundError' });
    await capture.start();
    expect(capture.lastError()).toBe('No microphone was found.');

    permission = Promise.reject({ name: 'NotReadableError' });
    await capture.start();
    expect(capture.lastError()).toMatch(/in use by another app/);
  });

  it('refuses over an insecure connection rather than fail silently', async () => {
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });

    expect(await capture.start()).toBe(false);

    expect(capture.lastError()).toMatch(/secure connection/);
    expect(contexts).toHaveLength(0);
  });

  it('lets go of a microphone granted after the dentist had already stopped', async () => {
    let grant!: (value: FakeStream) => void;
    permission = new Promise<FakeStream>(resolve => { grant = resolve; });

    const started = capture.start();
    capture.stop();
    grant(stream);

    expect(await started).toBe(false);
    expect(stream.track.stopped).toBe(true);
  });

  // ── Losing it ───────────────────────────────────────────────────────

  it('reports the microphone as lost when the system takes it away', async () => {
    await capture.start();

    stream.track.end();

    expect(capture.status()).toBe('error');
    expect(capture.lastError()).toMatch(/disconnected or taken by another app/);
    expect(ctx().closed).toBe(true);
  });

  it('reports a suspended context, and recovers when it runs again', async () => {
    await capture.start();

    ctx().state = 'suspended';
    ctx().onstatechange?.();
    expect(capture.status()).toBe('suspended');

    ctx().setState('running');
    expect(capture.status()).toBe('capturing');
  });

  it('treats WebKit\'s "interrupted" after a call as suspended', async () => {
    await capture.start();

    ctx().state = 'interrupted';
    ctx().onstatechange?.();

    expect(capture.status()).toBe('suspended');
  });

  // ── What is posted ──────────────────────────────────────────────────

  it('posts one clip for one utterance, as WAV', async () => {
    await capture.start();

    sentence();

    expect(clips).toHaveLength(1);
    expect(clips[0].type).toBe('audio/wav');
    expect(clips[0].size).toBeGreaterThan(44);
  });

  it('never posts the app\'s own voice back, however loud', async () => {
    await capture.start();
    audible = true;

    sentence();

    expect(clips).toEqual([]);
    expect(capture.speaking()).toBe(false);
  });

  it('hears the dentist again as soon as the app has stopped speaking', async () => {
    await capture.start();
    audible = true;
    frames(10, voiced).forEach(frame => ctx().hear(frame));
    audible = false;

    sentence();

    expect(clips).toHaveLength(1);
  });

  it('posts nothing while paused, and nothing is held over from before', async () => {
    await capture.start();
    frames(8, voiced).forEach(frame => ctx().hear(frame));

    capture.setPaused(true);
    sentence();

    expect(clips).toEqual([]);
    expect(capture.paused()).toBe(true);
  });

  it('ships what was being said when it is stopped mid-sentence', async () => {
    await capture.start();
    frames(QUIET_BEFORE, silence).forEach(frame => ctx().hear(frame));
    frames(SENTENCE, voiced).forEach(frame => ctx().hear(frame));
    expect(clips).toHaveLength(0);

    capture.stop();

    // The last words before "end examination" are not thrown away.
    expect(clips).toHaveLength(1);
  });

  it('discards an unfinished utterance when paused at the time it is stopped', async () => {
    await capture.start({ paused: true });
    frames(QUIET_BEFORE, silence).forEach(frame => ctx().hear(frame));
    frames(SENTENCE, voiced).forEach(frame => ctx().hear(frame));

    capture.stop();

    expect(clips).toEqual([]);
  });

  // ── Letting go ──────────────────────────────────────────────────────

  it('releases the microphone and the audio context when stopped', async () => {
    await capture.start();

    capture.stop();

    expect(stream.track.stopped).toBe(true);
    expect(ctx().closed).toBe(true);
    expect(capture.status()).toBe('idle');
    expect(capture.isActive()).toBe(false);
  });

  it('can be started again after it was lost', async () => {
    await capture.start();
    stream.track.end();
    expect(capture.status()).toBe('error');

    stream = new FakeStream();
    expect(await capture.start()).toBe(true);

    expect(capture.status()).toBe('capturing');
    expect(contexts).toHaveLength(2);
  });

  // ── Speaking over a read-back ───────────────────────────────────────

  describe('speaking over a read-back', () => {
    /** The app's own voice as the microphone hears it: faint. */
    const echo = () => voiced(0.02);
    /** A person, plainly louder. */
    const person = () => voiced(0.3);

    /** The app reads something back, and the microphone hears only its own echo. */
    const readBack = (frameCount = 30) => {
      audible = true;
      generation++;
      frames(frameCount, echo).forEach(frame => ctx().hear(frame));
    };

    /** The read-back ends. */
    const readBackEnds = () => {
      audible = false;
      ctx().hear(silence());
    };

    /** The app has read one thing back and finished: its voice has been measured. */
    const measured = async () => {
      await capture.start();
      readBack();
      readBackEnds();
    };

    it('does not stop the first read-back: there is nothing to compare a voice against yet', async () => {
      await capture.start();
      audible = true;
      generation++;

      frames(40, person).forEach(frame => ctx().hear(frame));

      expect(cancelled).toBe(0);
    });

    it('stops a read-back that someone speaks over, and keeps what they said', async () => {
      await measured();
      readBack(5);

      frames(30, person).forEach(frame => ctx().hear(frame));
      expect(cancelled).toBe(1);

      // The rest of the sentence, and the pause that ends it, arrive once the app is quiet.
      frames(30, person).forEach(frame => ctx().hear(frame));
      frames(56, silence).forEach(frame => ctx().hear(frame));
      expect(clips).toHaveLength(1);
      // It starts where the interruption started, not after it: the wake word is in it.
      expect(clips[0].size).toBeGreaterThan((0.9 * 16_000 * 2));
    });

    it('does not take the app\'s own voice, however many times it is heard, for a person', async () => {
      await measured();

      for (let i = 0; i < 4; i++) {
        readBack(40);
        readBackEnds();
      }

      expect(cancelled).toBe(0);
    });

    it('ignores a cough or a door: it has to last', async () => {
      await measured();
      readBack(5);

      frames(3, person).forEach(frame => ctx().hear(frame));
      frames(10, echo).forEach(frame => ctx().hear(frame));
      frames(3, person).forEach(frame => ctx().hear(frame));

      expect(cancelled).toBe(0);
    });

    it('can be interrupted again at the next read-back: the interruption was not taken for the app\'s voice', async () => {
      await measured();

      for (let round = 0; round < 3; round++) {
        readBack(5);
        frames(30, person).forEach(frame => ctx().hear(frame));
        frames(56, silence).forEach(frame => ctx().hear(frame));
        expect(cancelled, `round ${round}`).toBe(round + 1);
      }
    });

    it('stands down when interruptions keep coming to nothing: that is the app hearing itself', async () => {
      await measured();

      // Each one is followed by another read-back at once, and nobody speaks.
      for (let round = 0; round < 5; round++) {
        readBack(5);
        frames(30, person).forEach(frame => ctx().hear(frame));
        audible = true;
        generation++;
        frames(5, echo).forEach(frame => ctx().hear(frame));
      }

      // Three acted on (the first, and the two that followed one with nothing to show),
      // and then it stops acting.
      expect(cancelled).toBe(3);
    });

    it('can be switched off', async () => {
      localStorage.setItem('orthoflow_voice_bargein', 'off');
      await measured();
      readBack(5);

      frames(40, person).forEach(frame => ctx().hear(frame));

      expect(cancelled).toBe(0);
    });

    it('starts again from nothing when the microphone is reopened', async () => {
      await measured();
      capture.stop();
      await capture.start();
      audible = true;
      generation++;

      frames(40, person).forEach(frame => ctx().hear(frame));

      expect(cancelled).toBe(0);
    });
  });
});
