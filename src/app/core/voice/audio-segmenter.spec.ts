import { describe, expect, it } from 'vitest';
import { encodeWav, resample, rms, SpeechBandFilter, toUploadWav, UtteranceSegmenter, UPLOAD_SAMPLE_RATE } from './audio-segmenter';

/**
 * The segmenter decides what the recogniser ever hears. The failures worth
 * pinning are the ones a dentist experiences as "it didn't hear me": a
 * clipped first syllable, a quiet voice that never opens an utterance, and
 * a pause mid-command that splits it in two.
 */

const RATE = 48_000;
const FRAME = 1024;
const frameMs = (FRAME / RATE) * 1000;

/** Running sample clock, so a syllable envelope continues across frames. */
let clock = 0;

/**
 * A frame of voice-like sound: a 220 Hz tone whose level rises and falls
 * five times a second, as syllables do. A steady tone is what a machine
 * sounds like, and the segmenter is right to reject it.
 */
function voiced(amplitude: number, phase = clock): Float32Array {
  const frame = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) {
    const t = (phase + i) / RATE;
    const syllables = 0.15 + 0.85 * Math.abs(Math.sin(Math.PI * 5 * t));
    frame[i] = amplitude * syllables * Math.sin(((phase + i) * 2 * Math.PI * 220) / RATE);
  }
  clock = phase + FRAME;
  return frame;
}

/** A machine: one level, held. */
function steadyTone(amplitude: number, hz = 800): Float32Array {
  const frame = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) frame[i] = amplitude * Math.sin(((clock + i) * 2 * Math.PI * hz) / RATE);
  clock += FRAME;
  return frame;
}

/** A dental turbine: a whine well above the voice, loud. */
function whine(amplitude: number, hz = 6000, phase = 0): Float32Array {
  const frame = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) frame[i] = amplitude * Math.sin(((phase + i) * 2 * Math.PI * hz) / RATE);
  return frame;
}

function sum(a: Float32Array, b: Float32Array): Float32Array {
  return a.map((v, i) => v + b[i]);
}

function quiet(amplitude = 0.001): Float32Array {
  const frame = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) frame[i] = (Math.random() * 2 - 1) * amplitude;
  return frame;
}

function feed(segmenter: UtteranceSegmenter, frames: Float32Array[]): Float32Array[] {
  const out: Float32Array[] = [];
  for (const frame of frames) {
    const clip = segmenter.push(frame);
    if (clip) out.push(clip);
  }
  return out;
}

const times = (ms: number, make: () => Float32Array) =>
  Array.from({ length: Math.ceil(ms / frameMs) }, make);

describe('UtteranceSegmenter', () => {
  it('ships one utterance for speech followed by silence', () => {
    const segmenter = new UtteranceSegmenter({ sampleRate: RATE });
    const clips = feed(segmenter, [
      ...times(600, () => quiet()),
      ...times(1200, () => voiced(0.2)),
      ...times(1200, () => quiet()),
    ]);
    expect(clips).toHaveLength(1);
  });

  it('keeps audio from before the onset, so the first syllable is not clipped', () => {
    const segmenter = new UtteranceSegmenter({ sampleRate: RATE, preRollMs: 500 });
    const [clip] = feed(segmenter, [
      ...times(1000, () => quiet()),
      ...times(800, () => voiced(0.2)),
      ...times(1200, () => quiet()),
    ]);
    // 800 ms of speech plus most of the 500 ms pre-roll plus a short tail.
    const durationMs = (clip.length / RATE) * 1000;
    expect(durationMs).toBeGreaterThan(800 + 400);
  });

  it('does not split a command on a short pause between words', () => {
    const segmenter = new UtteranceSegmenter({ sampleRate: RATE });
    const clips = feed(segmenter, [
      ...times(500, () => quiet()),
      ...times(500, () => voiced(0.2)),   // "carie"
      ...times(400, () => quiet()),       // breath
      ...times(600, () => voiced(0.2)),   // "récurrente"
      ...times(1200, () => quiet()),
    ]);
    expect(clips).toHaveLength(1);
  });

  it('opens for a quiet voice in a quiet room — a phone a metre away', () => {
    const segmenter = new UtteranceSegmenter({ sampleRate: RATE });
    const clips = feed(segmenter, [
      ...times(800, () => quiet(0.0008)),
      ...times(900, () => voiced(0.02)),
      ...times(1200, () => quiet(0.0008)),
    ]);
    expect(clips).toHaveLength(1);
  });

  it('raises its threshold in a noisy room instead of recording the noise', () => {
    const segmenter = new UtteranceSegmenter({ sampleRate: RATE });
    const clips = feed(segmenter, times(4000, () => quiet(0.01)));
    expect(clips).toHaveLength(0);
  });

  it('does not open an utterance for a handpiece whine, however loud', () => {
    const segmenter = new UtteranceSegmenter({ sampleRate: RATE });
    let phase = 0;
    const clips = feed(segmenter, [
      ...times(600, () => quiet()),
      ...times(3000, () => { const f = whine(0.3, 6000, phase); phase += FRAME; return f; }),
      ...times(1200, () => quiet()),
    ]);
    expect(clips).toHaveLength(0);
  });

  it('still hears the dentist over the handpiece', () => {
    const segmenter = new UtteranceSegmenter({ sampleRate: RATE });
    let phase = 0;
    const next = (voice: number) => { const f = sum(whine(0.1, 6000, phase), voiced(voice)); phase += FRAME; return f; };
    const clips = feed(segmenter, [
      ...times(1500, () => next(0)),
      ...times(1000, () => next(0.2)),
      ...times(1500, () => next(0)),
    ]);
    expect(clips).toHaveLength(1);
  });

  it('drops a steady machine noise in the speech band and stops re-triggering on it', () => {
    const segmenter = new UtteranceSegmenter({ sampleRate: RATE });
    const clips = feed(segmenter, [
      ...times(600, () => quiet()),
      // Suction starts and runs.
      ...times(5000, () => sum(steadyTone(0.08), quiet(0.004))),
    ]);
    expect(clips).toHaveLength(0);
    expect(segmenter.speaking).toBe(false);
  });

  it('hears speech over steady suction once the floor has risen to it', () => {
    const segmenter = new UtteranceSegmenter({ sampleRate: RATE });
    const clips = feed(segmenter, [
      ...times(600, () => quiet()),
      ...times(3000, () => steadyTone(0.03)),
      ...times(1200, () => sum(steadyTone(0.03), voiced(0.3))),
      ...times(1500, () => steadyTone(0.03)),
    ]);
    expect(clips).toHaveLength(1);
  });

  it('drops a click too short to be speech', () => {
    const segmenter = new UtteranceSegmenter({ sampleRate: RATE });
    const clips = feed(segmenter, [
      ...times(600, () => quiet()),
      voiced(0.5),
      ...times(1500, () => quiet()),
    ]);
    expect(clips).toHaveLength(0);
  });

  it('closes an unbroken dictation at the maximum length', () => {
    const segmenter = new UtteranceSegmenter({ sampleRate: RATE, maxUtteranceMs: 2000 });
    const clips = feed(segmenter, [...times(400, () => quiet()), ...times(4500, () => voiced(0.2))]);
    expect(clips.length).toBeGreaterThanOrEqual(1);
    for (const clip of clips) expect((clip.length / RATE) * 1000).toBeLessThanOrEqual(2600);
  });

  it('discards a partial utterance, so the app never transcribes its own voice', () => {
    const segmenter = new UtteranceSegmenter({ sampleRate: RATE });
    feed(segmenter, [...times(500, () => quiet()), ...times(500, () => voiced(0.2))]);
    expect(segmenter.speaking).toBe(true);
    segmenter.discard();
    expect(segmenter.speaking).toBe(false);
    expect(feed(segmenter, times(1500, () => quiet()))).toHaveLength(0);
  });

  it('ships what is mid-utterance on flush', () => {
    const segmenter = new UtteranceSegmenter({ sampleRate: RATE });
    feed(segmenter, [...times(500, () => quiet()), ...times(600, () => voiced(0.2))]);
    expect(segmenter.flush()).not.toBeNull();
  });
});

describe('SpeechBandFilter', () => {
  it('passes the voice and attenuates a turbine whine and a motor rumble', () => {
    const tone = (hz: number) => { const f = new Float32Array(RATE / 2); for (let i = 0; i < f.length; i++) f[i] = Math.sin((2 * Math.PI * hz * i) / RATE); return f; };
    const through = (hz: number) => new SpeechBandFilter(RATE).rms(tone(hz)) / rms(tone(hz));
    expect(through(1000)).toBeGreaterThan(0.9);
    expect(through(6000)).toBeLessThan(0.3);
    expect(through(9000)).toBeLessThan(0.1);
    expect(through(40)).toBeLessThan(0.15);
  });
});

describe('encoding', () => {
  it('resamples 48 kHz to 16 kHz by a factor of three', () => {
    const input = new Float32Array(48_000).fill(0.5);
    const out = resample(input, 48_000, 16_000);
    expect(out.length).toBe(16_000);
    expect(out[100]).toBeCloseTo(0.5);
  });

  it('filters out a whine above the new Nyquist instead of folding it into the voice band', () => {
    // 11 kHz at 48 kHz would alias to 5 kHz at 16 kHz.
    const input = new Float32Array(48_000);
    for (let i = 0; i < input.length; i++) input[i] = Math.sin((2 * Math.PI * 11_000 * i) / 48_000);
    const out = resample(input, 48_000, 16_000);
    expect(rms(out.subarray(100, out.length - 100))).toBeLessThan(0.02);
  });

  it('keeps speech-band content through resampling, including from 44.1 kHz', () => {
    const input = new Float32Array(44_100);
    for (let i = 0; i < input.length; i++) input[i] = Math.sin((2 * Math.PI * 1000 * i) / 44_100);
    const out = resample(input, 44_100, 16_000);
    expect(out.length).toBe(16_000);
    expect(rms(out.subarray(100, out.length - 100))).toBeGreaterThan(0.65);
  });

  it('writes a valid mono 16-bit PCM WAV header', () => {
    const wav = encodeWav(new Float32Array(160), 16_000);
    const view = new DataView(wav);
    const ascii = (offset: number) => String.fromCharCode(...new Uint8Array(wav, offset, 4));
    expect(ascii(0)).toBe('RIFF');
    expect(ascii(8)).toBe('WAVE');
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(wav.byteLength).toBe(44 + 320);
  });

  it('lifts a quiet clip without clipping it', () => {
    const quietTone = voiced(0.05).slice();
    const wav = toUploadWav(quietTone, RATE);
    const samples = new Int16Array(wav, 44);
    const peak = Math.max(...Array.from(samples, Math.abs));
    expect(peak).toBeGreaterThan(0.05 * 0x7fff * 2);
    expect(peak).toBeLessThanOrEqual(0x7fff);
    expect(rms(quietTone)).toBeGreaterThan(0);
    expect(samples.length).toBe(Math.floor(quietTone.length / (RATE / UPLOAD_SAMPLE_RATE)));
  });
});
