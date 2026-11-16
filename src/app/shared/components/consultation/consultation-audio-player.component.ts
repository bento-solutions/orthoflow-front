import { IconComponent } from '../../ui/icon.component';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, input, signal, viewChild } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { ConsultationApiService } from '../../../core/consultation/consultation-api.service';
import { ConsultationAudioDto } from '../../../core/consultation/consultation.model';

/** How far before a line's time to start: a line is timed when it was transcribed, a few seconds after it was said. */
export const SEEK_LEAD_MS = 4_000;

/** Where a line timed `at` is in a recording that started at `startedAt`, in seconds (never before the start). */
export function audioOffsetSeconds(at: number, startedAt: number, leadMs = SEEK_LEAD_MS): number {
  return Math.max(0, (at - startedAt - leadMs) / 1000);
}

/**
 * The recording of a consultation, played beside its timestamped transcript.
 *
 * The bytes need the signed-in user's token, so they are fetched and played from an object URL
 * (released when the player goes) — only when the doctor asks, never on opening the list. A
 * recording made by Chrome does not say how long it is; the player asks the browser to find out
 * first, or seeking to a line would go nowhere.
 */
@Component({
  selector: 'app-consultation-audio-player',
  standalone: true,
  imports: [IconComponent, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (url(); as src) {
      <audio #player class="cap-audio" controls preload="metadata" [src]="src" (loadedmetadata)="onMetadata()"
             [attr.aria-label]="'CONSULTATION.LOG_AUDIO' | translate"></audio>
    } @else {
      <button type="button" class="btn btn-secondary btn-sm" (click)="load()" [disabled]="loading()" data-audio-listen>
        <app-icon class="mi text-base" name="play_arrow" size="1em" />
        {{ (loading() ? 'COMMON.LOADING' : 'CONSULTATION.DOCS_LISTEN') | translate }}
      </button>
    }
    @if (failed()) {
      <p class="mt-1 text-xs text-critical-700" role="alert">{{ 'CONSULTATION.DOCS_LOAD_FAILED' | translate }}</p>
    }
  `,
  styles: [`
    :host { display: block; }
    .cap-audio { width: 100%; max-width: 32rem; height: 2.5rem; }
  `],
})
export class ConsultationAudioPlayerComponent {
  private api = inject(ConsultationApiService);

  readonly consultationId = input.required<string>();
  readonly audio = input<ConsultationAudioDto | null>(null);

  protected readonly url = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly failed = signal(false);
  private readonly player = viewChild<ElementRef<HTMLAudioElement>>('player');
  private pendingSeek: number | null = null;
  private durationKnown = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.release());
  }

  /** Fetches the recording (once) and shows the player. */
  async load(): Promise<void> {
    if (this.url() || this.loading()) return;
    this.loading.set(true);
    this.failed.set(false);
    try {
      const blob = await firstValueFrom(this.api.audio(this.consultationId()));
      this.url.set(URL.createObjectURL(blob));
    } catch {
      this.failed.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  /** Plays from where a line timed `at` (ms since the epoch) is in the recording. */
  async playFrom(at: number): Promise<void> {
    const started = this.audio()?.startedAt ? Date.parse(this.audio()!.startedAt!) : null;
    if (started === null || Number.isNaN(started)) return;
    this.pendingSeek = audioOffsetSeconds(at, started);
    if (!this.url()) await this.load();
    this.applySeek();
  }

  protected onMetadata(): void {
    const element = this.player()?.nativeElement;
    if (!element) return;
    if (!Number.isFinite(element.duration) && !this.durationKnown) {
      // A MediaRecorder WebM carries no duration: seeking far past the end makes the browser
      // read the file through and learn it; then back to where the doctor wanted.
      const restore = () => {
        element.removeEventListener('durationchange', restore);
        this.durationKnown = true;
        element.currentTime = 0;
        this.applySeek();
      };
      element.addEventListener('durationchange', restore);
      element.currentTime = 1e7;
      return;
    }
    this.durationKnown = true;
    this.applySeek();
  }

  private applySeek(): void {
    const element = this.player()?.nativeElement;
    if (!element || this.pendingSeek === null || !this.durationKnown) return;
    element.currentTime = Number.isFinite(element.duration) ? Math.min(this.pendingSeek, element.duration) : this.pendingSeek;
    this.pendingSeek = null;
    void element.play().catch(() => undefined);
  }

  private release(): void {
    const url = this.url();
    if (url) URL.revokeObjectURL(url);
    this.url.set(null);
  }
}
