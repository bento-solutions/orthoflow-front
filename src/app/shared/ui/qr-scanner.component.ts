import { Component, ElementRef, InjectionToken, OnDestroy, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

/** What the scanner needs from a camera reader, so the real one (ZXing) can be replaced in tests and the library loaded only when someone opens the camera. */
export interface ScanSession {
  stop(): void;
}

export type ScanStarter = (video: HTMLVideoElement, onCode: (text: string) => void) => Promise<ScanSession>;

/** The default reader: ZXing, imported on first use so the rest of the app does not carry it. */
export const SCAN_STARTER = new InjectionToken<ScanStarter>('SCAN_STARTER', {
  providedIn: 'root',
  factory: () => async (video, onCode) => {
    const { BrowserMultiFormatReader } = await import('@zxing/browser');
    const reader = new BrowserMultiFormatReader();
    const controls = await reader.decodeFromVideoDevice(undefined, video, result => {
      if (result) {
        onCode(result.getText());
      }
    });
    return { stop: () => controls.stop() };
  },
});

/**
 * A camera that reads QR codes and barcodes. It starts when `active` is true and stops the moment
 * it is false or the component goes away, so the camera light is never left on. The same code
 * read again within a couple of seconds is ignored: a label held in front of the lens is read many
 * times a second. If there is no camera, or permission is refused, it says so and the screen's
 * typed entry keeps working.
 */
@Component({
  selector: 'app-qr-scanner',
  standalone: true,
  imports: [TranslateModule],
  template: `
    <div class="relative overflow-hidden rounded-lg bg-ink-900" [class.hidden]="!active()">
      <video #video class="aspect-[4/3] w-full object-cover" muted playsinline [attr.aria-label]="'STER.SCAN.CAMERA' | translate"></video>
      <div class="pointer-events-none absolute inset-8 rounded-lg border-2 border-white/70" aria-hidden="true"></div>
    </div>
    @if (error()) { <p class="mt-2 rounded-md bg-caution-50 p-3 text-sm text-caution-800" role="alert">{{ error()! | translate }}</p> }
  `,
})
export class QrScannerComponent implements OnDestroy {
  readonly active = input(false);
  readonly scanned = output<string>();

  protected readonly error = signal<string | null>(null);
  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('video');
  private readonly start = inject(SCAN_STARTER);
  private session: ScanSession | null = null;
  private starting = 0;
  private last = { code: '', at: 0 };

  constructor() {
    effect(() => {
      const on = this.active();
      const video = this.video()?.nativeElement;
      untracked(() => (on && video ? void this.begin(video) : this.end()));
    });
  }

  ngOnDestroy(): void {
    this.end();
  }

  private async begin(video: HTMLVideoElement): Promise<void> {
    this.end();
    const ticket = ++this.starting;
    this.error.set(null);
    try {
      const session = await this.start(video, text => this.read(text));
      if (ticket !== this.starting) {
        session.stop();
        return;
      }
      this.session = session;
    } catch (error) {
      if (ticket === this.starting) {
        this.error.set(denied(error) ? 'STER.SCAN.DENIED' : 'STER.SCAN.NO_CAMERA');
      }
    }
  }

  private end(): void {
    this.starting++;
    this.session?.stop();
    this.session = null;
  }

  private read(text: string): void {
    const now = Date.now();
    if (text === this.last.code && now - this.last.at < 2000) {
      return;
    }
    this.last = { code: text, at: now };
    this.scanned.emit(text);
  }
}

/** Whether a camera failure is the person (or the browser) refusing permission, rather than there being no camera. */
export function denied(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name ?? '';
  return name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError';
}
