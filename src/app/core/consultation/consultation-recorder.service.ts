import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { AudioCaptureService } from '../voice/audio-capture.service';

/** A finished recording, ready to send. */
export interface ConsultationRecording {
  blob: Blob;
  /** When the recording started (ms since the epoch): a line's time minus this is where it is in the audio. */
  startedAt: number;
  durationMs: number;
}

interface Segment {
  recorder: MediaRecorder;
  /** The copy being recorded, and the microphone track it was copied from. */
  track: MediaStreamTrack;
  sourceId: string;
  chunks: Blob[];
  bytes: number;
  startedAt: number;
  stoppedAt: number | null;
  done: Promise<void>;
}

/** Opus at this rate is clear speech at about 15 MB an hour. */
export const RECORDING_BITS_PER_SECOND = 32_000;
/** A chunk every few seconds, so a long consultation is never one buffer in memory. */
export const RECORDING_TIMESLICE_MS = 5_000;

/**
 * The audio of a consultation, kept beside its timestamped transcript (docs/CONSULTATION.md,
 * "The recording").
 *
 * It records the microphone the consultation already has open — a copy of its track, so stopping
 * the recording never closes the microphone and closing the microphone never leaves the recording
 * running. A pause **mutes** the copy rather than pausing the recorder: what is said while paused
 * is not kept, and the recording stays as long as the consultation, so a line said at 10:12:30 is
 * still found 12 min 30 s into a recording that began at 10:00:00.
 *
 * If the microphone is reopened mid-consultation (the device was unplugged), recording starts
 * again on the new stream; the longest continuous part is the one kept (a browser cannot join two
 * of its own recordings into one file).
 */
@Injectable({ providedIn: 'root' })
export class ConsultationRecorderService {
  private capture = inject(AudioCaptureService);

  private segments: Segment[] = [];
  private active = false;
  private maxBytes = 100 * 1024 * 1024;
  private recordingSignal = signal(false);
  /** Audio is being kept for this consultation. */
  recording = this.recordingSignal.asReadonly();
  private truncatedSignal = signal(false);
  /** The recording reached the clinic's limit and stopped growing. */
  truncated = this.truncatedSignal.asReadonly();

  constructor() {
    // A reopened microphone is a new stream: follow it.
    effect(() => {
      const stream = this.capture.mediaStream();
      untracked(() => {
        if (!this.active || !stream) return;
        const current = this.segments[this.segments.length - 1];
        if (current && current.stoppedAt === null && stream.getAudioTracks().some(t => t.id === current.sourceId)) return;
        if (current?.stoppedAt === null) this.finish(current);
        this.begin(stream);
      });
    });
    // Paused: nothing said is kept, and the timeline does not move away from the clock.
    effect(() => {
      const paused = this.capture.paused();
      untracked(() => {
        for (const segment of this.segments) {
          if (segment.stoppedAt === null) segment.track.enabled = !paused;
        }
      });
    });
  }

  /** Whether this browser can record audio at all. */
  static supported(): boolean {
    return typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function';
  }

  /** The best type this browser records speech in, or '' to let it choose. */
  static mimeType(): string {
    if (!ConsultationRecorderService.supported()) return '';
    for (const type of ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4']) {
      if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return '';
  }

  /**
   * Starts keeping the audio of the open microphone. Returns false when there is no microphone
   * open or the browser cannot record — the consultation carries on without its audio.
   */
  start(options: { maxBytes?: number } = {}): boolean {
    if (this.active) return true;
    if (!ConsultationRecorderService.supported()) return false;
    const stream = this.capture.mediaStream();
    if (!stream || stream.getAudioTracks().length === 0) return false;
    this.maxBytes = options.maxBytes ?? this.maxBytes;
    this.segments = [];
    this.truncatedSignal.set(false);
    this.active = true;
    if (!this.begin(stream)) {
      this.active = false;
      return false;
    }
    this.recordingSignal.set(true);
    return true;
  }

  /** Stops and hands over what was recorded, or null when nothing was. */
  async stop(): Promise<ConsultationRecording | null> {
    if (!this.active) return null;
    this.active = false;
    this.recordingSignal.set(false);
    for (const segment of this.segments) this.finish(segment);
    await Promise.all(this.segments.map(segment => segment.done));
    const kept = this.longest();
    this.segments = [];
    if (!kept || kept.bytes === 0) return null;
    const type = kept.recorder.mimeType || kept.chunks[0]?.type || 'audio/webm';
    return {
      blob: new Blob(kept.chunks, { type: type.split(';')[0] }),
      startedAt: kept.startedAt,
      durationMs: Math.max(0, (kept.stoppedAt ?? Date.now()) - kept.startedAt),
    };
  }

  /** Stops and throws the recording away: the consultation was discarded. */
  discard(): void {
    this.active = false;
    this.recordingSignal.set(false);
    for (const segment of this.segments) this.finish(segment);
    this.segments = [];
  }

  private begin(stream: MediaStream): boolean {
    const source = stream.getAudioTracks()[0];
    if (!source) return false;
    const track = source.clone();
    let recorder: MediaRecorder;
    try {
      const mimeType = ConsultationRecorderService.mimeType();
      recorder = new MediaRecorder(new MediaStream([track]), {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: RECORDING_BITS_PER_SECOND,
      });
    } catch {
      track.stop();
      return false;
    }
    let resolveDone!: () => void;
    const segment: Segment = {
      recorder, track, sourceId: source.id, chunks: [], bytes: 0, startedAt: Date.now(), stoppedAt: null,
      done: new Promise<void>(resolve => { resolveDone = resolve; }),
    };
    recorder.ondataavailable = event => {
      if (!event.data || event.data.size === 0) return;
      if (this.totalBytes() + event.data.size > this.maxBytes) {
        this.truncatedSignal.set(true);
        this.finish(segment);
        return;
      }
      segment.chunks.push(event.data);
      segment.bytes += event.data.size;
    };
    recorder.onstop = () => resolveDone();
    recorder.onerror = () => {
      this.finish(segment);
      resolveDone();
    };
    track.enabled = !this.capture.paused();
    try {
      recorder.start(RECORDING_TIMESLICE_MS);
    } catch {
      track.stop();
      return false;
    }
    this.segments.push(segment);
    return true;
  }

  private finish(segment: Segment): void {
    if (segment.stoppedAt !== null) return;
    segment.stoppedAt = Date.now();
    try {
      if (segment.recorder.state !== 'inactive') segment.recorder.stop();
      else queueMicrotask(() => segment.recorder.onstop?.(new Event('stop')));
    } catch {
      queueMicrotask(() => segment.recorder.onstop?.(new Event('stop')));
    }
    segment.track.stop();
  }

  private totalBytes(): number {
    return this.segments.reduce((sum, segment) => sum + segment.bytes, 0);
  }

  private longest(): Segment | null {
    return this.segments.reduce<Segment | null>((best, segment) => {
      const length = (segment.stoppedAt ?? Date.now()) - segment.startedAt;
      const bestLength = best ? (best.stoppedAt ?? Date.now()) - best.startedAt : -1;
      return segment.bytes > 0 && length > bestLength ? segment : best;
    }, null);
  }
}
