/**
 * Where one dictated command ends and the next begins, decided from raw PCM.
 *
 * Framework-free so it can be tested with synthetic frames — the capture
 * service feeds it whatever the microphone produces and ships what it
 * returns.
 *
 * ── Why this replaced MediaRecorder-per-utterance ───────────────────────
 *
 * The previous capture path watched the input level and, once it crossed a
 * threshold, *started* a MediaRecorder. Everything said before the recorder
 * was running was never recorded, and on a phone that start-up takes long
 * enough to swallow the first syllable. The first word of nearly every
 * command is the wake word, so "Calypso, dent 16" reached the recogniser as
 * "lypso, dent 16" — and the wake gate then declined a perfectly spoken
 * command. The fixed threshold made it worse: tuned for a laptop microphone
 * at arm's length, it never fired for a phone lying on the bracket table.
 *
 * Three things fix that, and they are the standard ingredients of an energy
 * voice-activity detector:
 *
 * - **Pre-roll.** The last few hundred milliseconds are always buffered, so
 *   an utterance starts before the moment it was detected.
 * - **An adaptive noise floor.** The threshold follows the room — suction,
 *   a compressor, a quiet surgery — instead of being one number.
 * - **Onset and hangover.** A click must last long enough to be a voice
 *   before it opens an utterance, and a pause between "carie" and
 *   "récurrente" must last long enough to be the end before it closes one.
 */

export interface SegmenterOptions {
  /** Sample rate of the frames pushed in. */
  sampleRate: number;
  /** Audio kept from before the detected onset. */
  preRollMs: number;
  /** Voiced audio needed, uninterrupted, before an utterance opens. */
  onsetMs: number;
  /** Silence that closes an open utterance. */
  hangoverMs: number;
  /** An utterance with less voiced audio than this is a cough or a door. */
  minVoicedMs: number;
  /** Closed regardless of speech, so one long dictation cannot stall the rest. */
  maxUtteranceMs: number;
  /** RMS below which nothing counts as voice, however quiet the room. */
  minThreshold: number;
  /** How far above the noise floor speech must be. 3× ≈ +9.5 dB. */
  noiseMultiplier: number;
  /**
   * Once open, an utterance stays open at this fraction of the threshold.
   * Hysteresis: the tail of a word is quieter than its onset.
   */
  releaseRatio: number;
}

export const DEFAULT_SEGMENTER_OPTIONS: Omit<SegmenterOptions, 'sampleRate'> = {
  preRollMs: 500,
  onsetMs: 80,
  hangoverMs: 850,
  minVoicedMs: 200,
  maxUtteranceMs: 15_000,
  minThreshold: 0.004,
  noiseMultiplier: 3,
  releaseRatio: 0.5,
};

/** Trailing silence kept on a closed utterance; the rest is not worth uploading. */
const KEPT_TAIL_MS = 300;

/** The noise floor never rises above this — a shouting room is not "quiet". */
const MAX_NOISE_FLOOR = 0.03;

export function rms(frame: Float32Array): number {
  if (frame.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
}

/** RMS on a perceptual 0–1 scale (−60 dBFS … −10 dBFS), for the level meter. */
export function levelOf(value: number): number {
  if (value <= 0) return 0;
  const db = 20 * Math.log10(value);
  return Math.min(1, Math.max(0, (db + 60) / 50));
}

export class UtteranceSegmenter {
  private readonly options: SegmenterOptions;

  private preRoll: Float32Array[] = [];
  private preRollSamples = 0;
  private utterance: Float32Array[] = [];
  private utteranceSamples = 0;

  private open = false;
  private voicedRunMs = 0;
  private voicedTotalMs = 0;
  private silenceRunMs = 0;
  private noiseFloor: number | null = null;

  /** 0–1 input level of the last frame. */
  level = 0;

  constructor(options: Partial<SegmenterOptions> & { sampleRate: number }) {
    this.options = { ...DEFAULT_SEGMENTER_OPTIONS, ...options };
  }

  /** True while an utterance is open — the speaker is talking. */
  get speaking(): boolean {
    return this.open;
  }

  /** The RMS a frame must reach to count as voice right now. */
  get threshold(): number {
    const floor = this.noiseFloor ?? this.options.minThreshold;
    return Math.max(this.options.minThreshold, floor * this.options.noiseMultiplier);
  }

  /**
   * Feeds one frame. Returns the samples of an utterance that this frame
   * closed, or null.
   */
  push(frame: Float32Array): Float32Array | null {
    const frameMs = (frame.length / this.options.sampleRate) * 1000;
    const energy = rms(frame);
    this.level = levelOf(energy);

    if (!this.open) {
      this.keepPreRoll(frame);
      if (energy >= this.threshold) {
        this.voicedRunMs += frameMs;
        if (this.voicedRunMs >= this.options.onsetMs) this.openUtterance();
      } else {
        this.voicedRunMs = 0;
        this.adaptNoiseFloor(energy);
      }
      return null;
    }

    this.utterance.push(frame);
    this.utteranceSamples += frame.length;

    if (energy >= this.threshold * this.options.releaseRatio) {
      this.voicedTotalMs += frameMs;
      this.silenceRunMs = 0;
    } else {
      this.silenceRunMs += frameMs;
    }

    const durationMs = (this.utteranceSamples / this.options.sampleRate) * 1000;
    if (this.silenceRunMs >= this.options.hangoverMs || durationMs >= this.options.maxUtteranceMs) {
      return this.close();
    }
    return null;
  }

  /** Closes whatever is open — the session is ending, ship what was said. */
  flush(): Float32Array | null {
    return this.open ? this.close() : null;
  }

  /**
   * Drops any partial utterance and the pre-roll, keeping the learned noise
   * floor. Used while the app is speaking, so its own voice is never
   * transcribed as a command.
   */
  discard(): void {
    this.preRoll = [];
    this.preRollSamples = 0;
    this.utterance = [];
    this.utteranceSamples = 0;
    this.open = false;
    this.voicedRunMs = 0;
    this.voicedTotalMs = 0;
    this.silenceRunMs = 0;
  }

  private keepPreRoll(frame: Float32Array): void {
    this.preRoll.push(frame);
    this.preRollSamples += frame.length;
    // The onset frames themselves live in the ring too, so it is sized to
    // hold the pre-roll *plus* the onset.
    const limit = Math.ceil(((this.options.preRollMs + this.options.onsetMs) / 1000) * this.options.sampleRate);
    while (this.preRoll.length > 1 && this.preRollSamples - this.preRoll[0].length >= limit) {
      this.preRollSamples -= this.preRoll.shift()!.length;
    }
  }

  private openUtterance(): void {
    this.open = true;
    this.utterance = this.preRoll;
    this.utteranceSamples = this.preRollSamples;
    this.preRoll = [];
    this.preRollSamples = 0;
    this.voicedTotalMs = this.voicedRunMs;
    this.voicedRunMs = 0;
    this.silenceRunMs = 0;
  }

  /**
   * Falls quickly and rises slowly: a door slam must not deafen the detector
   * for the next minute, while a compressor that starts running should
   * gradually become the new quiet.
   */
  private adaptNoiseFloor(energy: number): void {
    if (this.noiseFloor === null) {
      this.noiseFloor = Math.min(energy, MAX_NOISE_FLOOR);
      return;
    }
    const rate = energy < this.noiseFloor ? 0.2 : 0.01;
    this.noiseFloor = Math.min(MAX_NOISE_FLOOR, this.noiseFloor + (energy - this.noiseFloor) * rate);
  }

  private close(): Float32Array | null {
    const chunks = this.utterance;
    const total = this.utteranceSamples;
    const voicedMs = this.voicedTotalMs;
    const trailingSamples = Math.round((this.silenceRunMs / 1000) * this.options.sampleRate);

    this.utterance = [];
    this.utteranceSamples = 0;
    this.open = false;
    this.voicedTotalMs = 0;
    this.silenceRunMs = 0;

    if (voicedMs < this.options.minVoicedMs) return null;

    const keptTail = Math.round((KEPT_TAIL_MS / 1000) * this.options.sampleRate);
    const length = total - Math.max(0, trailingSamples - keptTail);
    return concat(chunks, length);
  }
}

function concat(chunks: Float32Array[], length: number): Float32Array {
  const out = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= length) break;
    const take = Math.min(chunk.length, length - offset);
    out.set(take === chunk.length ? chunk : chunk.subarray(0, take), offset);
    offset += take;
  }
  return out;
}

// ── Encoding ────────────────────────────────────────────────────────────

/** What the recogniser receives: 16 kHz is all speech recognition uses. */
export const UPLOAD_SAMPLE_RATE = 16_000;

/**
 * Box-filter resampling. Averaging every input sample that falls inside an
 * output sample is a crude low-pass, but for speech going to a recogniser it
 * is indistinguishable from a proper filter and avoids the aliasing a plain
 * decimation would add.
 */
export function resample(samples: Float32Array, inputRate: number, outputRate: number): Float32Array {
  if (inputRate === outputRate) return samples;
  const ratio = inputRate / outputRate;
  const outLength = Math.floor(samples.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(samples.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = start; j < end; j++) sum += samples[j];
    out[i] = sum / (end - start);
  }
  return out;
}

/**
 * Lifts a quiet clip towards a usable level. A phone on the bracket table
 * hears the dentist a metre away; a recogniser does noticeably better on
 * the same words at a normal level. Capped, so noise is not amplified into
 * something that sounds like speech.
 */
export function normalizePeak(samples: Float32Array, target = 0.9, maxGain = 6): Float32Array {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  if (peak === 0) return samples;
  const gain = Math.min(maxGain, target / peak);
  if (gain <= 1) return samples;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * gain;
  return out;
}

/**
 * Mono 16-bit PCM WAV. Chosen over the browser's compressed formats because
 * it is the one container every browser can produce identically and every
 * recogniser accepts: Safari's MediaRecorder only writes MP4, Chrome only
 * WebM, and the differences surfaced as clips the server could not decode.
 * A ten-second command is ~320 KB.
 */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);          // fmt chunk size
  view.setUint16(20, 1, true);           // PCM
  view.setUint16(22, 1, true);           // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true);           // block align
  view.setUint16(34, 16, true);          // bits per sample
  writeAscii(36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}

/** Samples at the capture rate → a WAV ready to upload. */
export function toUploadWav(samples: Float32Array, captureRate: number): ArrayBuffer {
  return encodeWav(normalizePeak(resample(samples, captureRate, UPLOAD_SAMPLE_RATE)), UPLOAD_SAMPLE_RATE);
}
