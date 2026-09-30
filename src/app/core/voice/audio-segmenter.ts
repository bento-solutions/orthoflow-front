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
 *
 * ── Why the detector only listens to the speech band ─────────────────────
 *
 * A dental surgery's loudest noises sit outside the voice. An air turbine
 * whines at 5–8 kHz and above, a compressor and the chair motor rumble below
 * 100 Hz, and measured on the full band either one opened "utterances" of
 * pure noise — each one a round trip to the recogniser, a slice of a
 * rate-limited quota, and a chance for it to hallucinate a finding. So the
 * level the detector reacts to is measured after a band-pass over the
 * speech formants ({@link SpeechBandFilter}); the clip that is uploaded is
 * still the full, unfiltered signal.
 *
 * Band-limiting alone does not stop a loud turbine or the suction, whose
 * noise reaches into the speech band. What does is that speech is not
 * steady: its level rises and falls with every syllable, four to eight times
 * a second, while a machine holds one level. An open "utterance" whose level
 * barely moves is noise; it is dropped, and the noise floor jumps to it so
 * the machine stops re-triggering the detector until it is switched off.
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
  /** How long an open utterance runs before it is checked for being a machine. */
  steadyCheckMs: number;
  /**
   * Coefficient of variation of the frame levels below which a sound is
   * steady noise. Speech measures 0.5 and above; a turbine or the suction
   * well under 0.2.
   */
  steadyMaxVariation: number;
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
  steadyCheckMs: 1200,
  steadyMaxVariation: 0.2,
};

/** Fewer frames than this say nothing reliable about variation. */
const MIN_FRAMES_FOR_VARIATION = 10;

/** Coefficient of variation — standard deviation over mean. */
export function variation(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return 0;
  const variance = values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length;
  return Math.sqrt(variance) / mean;
}

/**
 * One RBJ biquad section, direct form I, state kept across frames so a
 * frame boundary is not a discontinuity.
 */
class Biquad {
  private x1 = 0; private x2 = 0; private y1 = 0; private y2 = 0;
  private constructor(private b0: number, private b1: number, private b2: number,
                      private a1: number, private a2: number) {}

  static lowPass(sampleRate: number, cutoff: number, q = Math.SQRT1_2): Biquad {
    const w = (2 * Math.PI * Math.min(cutoff, sampleRate * 0.45)) / sampleRate;
    const alpha = Math.sin(w) / (2 * q);
    const cos = Math.cos(w);
    const a0 = 1 + alpha;
    return new Biquad(((1 - cos) / 2) / a0, (1 - cos) / a0, ((1 - cos) / 2) / a0, (-2 * cos) / a0, (1 - alpha) / a0);
  }

  static highPass(sampleRate: number, cutoff: number, q = Math.SQRT1_2): Biquad {
    const w = (2 * Math.PI * cutoff) / sampleRate;
    const alpha = Math.sin(w) / (2 * q);
    const cos = Math.cos(w);
    const a0 = 1 + alpha;
    return new Biquad(((1 + cos) / 2) / a0, (-(1 + cos)) / a0, ((1 + cos) / 2) / a0, (-2 * cos) / a0, (1 - alpha) / a0);
  }

  step(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x;
    this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

/**
 * The band the voice-activity detector listens to: 150 Hz – 3.8 kHz, with
 * the upper edge fourth-order so a turbine's whine is well down before it
 * can open an utterance.
 */
export class SpeechBandFilter {
  private readonly stages: Biquad[];

  constructor(sampleRate: number, lowHz = 150, highHz = 3800) {
    this.stages = [
      Biquad.highPass(sampleRate, lowHz),
      Biquad.lowPass(sampleRate, highHz),
      Biquad.lowPass(sampleRate, highHz),
    ];
  }

  /** RMS of the frame within the speech band. */
  rms(frame: Float32Array): number {
    if (frame.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < frame.length; i++) {
      let v = frame[i];
      for (const stage of this.stages) v = stage.step(v);
      sum += v * v;
    }
    return Math.sqrt(sum / frame.length);
  }
}

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
  /** Speech-band level of each frame of the open utterance. */
  private levels: number[] = [];
  private steadyChecked = false;
  private readonly band: SpeechBandFilter;

  /** 0–1 input level of the last frame. */
  level = 0;

  constructor(options: Partial<SegmenterOptions> & { sampleRate: number }) {
    this.options = { ...DEFAULT_SEGMENTER_OPTIONS, ...options };
    this.band = new SpeechBandFilter(this.options.sampleRate);
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
    // Speech-band energy decides; the meter shows the same, so a dentist
    // watching it sees what the detector reacts to, not the turbine.
    const energy = this.band.rms(frame);
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
    this.levels.push(energy);

    if (energy >= this.threshold * this.options.releaseRatio) {
      this.voicedTotalMs += frameMs;
      this.silenceRunMs = 0;
    } else {
      this.silenceRunMs += frameMs;
    }

    const durationMs = (this.utteranceSamples / this.options.sampleRate) * 1000;
    if (!this.steadyChecked && durationMs >= this.options.steadyCheckMs) {
      this.steadyChecked = true;
      if (this.isSteady(this.levels)) {
        this.rejectAsMachine();
        return null;
      }
    }
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
    this.levels = [];
    this.steadyChecked = false;
  }

  /** True when the voiced part of an utterance holds one level — a machine, not a voice. */
  private isSteady(levels: number[]): boolean {
    const floor = this.threshold * this.options.releaseRatio;
    const voiced = levels.filter(level => level >= floor);
    return voiced.length >= MIN_FRAMES_FOR_VARIATION && variation(voiced) < this.options.steadyMaxVariation;
  }

  /**
   * Drops a steady sound and makes it the new quiet, so the machine that
   * made it cannot open the next utterance either. The floor falls back
   * quickly once it stops.
   */
  private rejectAsMachine(): void {
    const floor = this.threshold * this.options.releaseRatio;
    const voiced = this.levels.filter(level => level >= floor);
    const mean = voiced.reduce((a, b) => a + b, 0) / Math.max(1, voiced.length);
    this.discard();
    this.noiseFloor = Math.min(MAX_NOISE_FLOOR * 3, Math.max(this.noiseFloor ?? 0, mean));
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
    this.levels = [];
    this.steadyChecked = false;
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
    // A short steady burst — a beep, a brief run of the handpiece — never
    // reached the in-flight check.
    const steady = !this.steadyChecked && this.isSteady(this.levels);

    this.utterance = [];
    this.utteranceSamples = 0;
    this.open = false;
    this.voicedTotalMs = 0;
    this.silenceRunMs = 0;
    this.levels = [];
    this.steadyChecked = false;

    if (voicedMs < this.options.minVoicedMs || steady) return null;

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

/** Taps in the anti-aliasing filter; odd, so it has a centre. */
const ANTI_ALIAS_TAPS = 63;

/**
 * Windowed-sinc low-pass, normalised to unity gain at DC.
 *
 * @param cutoff as a fraction of the sample rate (0–0.5)
 */
function lowPassKernel(cutoff: number, taps = ANTI_ALIAS_TAPS): Float32Array {
  const kernel = new Float32Array(taps);
  const middle = (taps - 1) / 2;
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const n = i - middle;
    const sinc = n === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * n) / (Math.PI * n);
    const blackman = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (taps - 1));
    kernel[i] = sinc * blackman;
    sum += kernel[i];
  }
  for (let i = 0; i < taps; i++) kernel[i] /= sum;
  return kernel;
}

/**
 * Resampling with a real anti-aliasing filter.
 *
 * The box filter this replaced averaged three samples per output sample,
 * which barely attenuates anything above the new Nyquist: a handpiece
 * whining at 9–12 kHz folded straight down into the 4–7 kHz band, on top of
 * the fricatives that tell "seize" from "treize". A 63-tap windowed sinc
 * with its cutoff just under 8 kHz removes it, then samples are taken by
 * linear interpolation, which also handles 44.1 kHz hardware cleanly.
 */
export function resample(samples: Float32Array, inputRate: number, outputRate: number): Float32Array {
  if (inputRate === outputRate) return samples;

  let source = samples;
  if (outputRate < inputRate) {
    const kernel = lowPassKernel((0.45 * outputRate) / inputRate);
    const half = (kernel.length - 1) / 2;
    const filtered = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      let acc = 0;
      for (let k = 0; k < kernel.length; k++) {
        const j = i + k - half;
        if (j >= 0 && j < samples.length) acc += samples[j] * kernel[k];
      }
      filtered[i] = acc;
    }
    source = filtered;
  }

  const ratio = inputRate / outputRate;
  const outLength = Math.floor(samples.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const position = i * ratio;
    const index = Math.floor(position);
    const fraction = position - index;
    const next = index + 1 < source.length ? source[index + 1] : source[index];
    out[i] = source[index] + (next - source[index]) * fraction;
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
