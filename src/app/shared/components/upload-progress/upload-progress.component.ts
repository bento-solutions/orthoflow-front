import { ChangeDetectionStrategy, Component, HostListener, inject } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { UploadProgressService } from '../../../core/uploads/upload-progress';

/**
 * The bar shown while any file uploads, wherever it was started from: a thin bar across the
 * top of the window and a card that names the file and asks the user to stay on the screen.
 * Closing or reloading the tab mid-upload asks for confirmation first.
 */
@Component({
  selector: 'app-upload-progress',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (uploads.active()) {
      <div class="top-bar" aria-hidden="true">
        <div class="top-fill" [class.indeterminate]="uploads.percent() === null" [style.width.%]="uploads.percent() ?? 100"></div>
      </div>
      <div class="upload-card" role="status" aria-live="polite">
        <div class="flex items-center justify-between gap-3">
          <p class="truncate text-sm font-bold text-ink-900">
            {{ 'COMMON.UPLOADING_FILE' | translate }}
            @if (uploads.label()) { <span class="font-medium text-ink-600">· {{ uploads.label() }}</span> }
            @else if (uploads.count() > 1) { <span class="font-medium text-ink-600">· {{ 'COMMON.UPLOADING_FILES' | translate: { count: uploads.count() } }}</span> }
          </p>
          @if (uploads.percent() !== null) { <span class="text-sm font-bold tabular-nums text-petrol-800">{{ uploads.percent() }}%</span> }
        </div>
        <div class="track" role="progressbar" aria-valuemin="0" aria-valuemax="100"
             [attr.aria-valuenow]="uploads.percent()" [attr.aria-label]="'COMMON.UPLOADING_FILE' | translate">
          <div class="fill" [class.indeterminate]="uploads.percent() === null" [style.width.%]="uploads.percent() ?? 100"></div>
        </div>
        <p class="mt-2 text-xs text-ink-500">{{ 'COMMON.UPLOAD_STAY' | translate }}</p>
      </div>
    }
  `,
  styles: [`
    .top-bar {
      position: fixed; inset-inline: 0; top: 0; height: 3px; z-index: 1000;
      background: rgb(var(--petrol-500) / 0.15);
    }
    .top-fill, .fill {
      height: 100%;
      background: rgb(var(--petrol-600));
      transition: width 0.2s ease-out;
    }
    .upload-card {
      position: fixed; z-index: 1000;
      bottom: 1.5rem; left: 50%; transform: translateX(-50%);
      width: min(26rem, calc(100vw - 2rem));
      padding: 0.875rem 1rem;
      background: var(--surface);
      border: 1px solid rgb(var(--ink-200));
      border-radius: var(--radius-xl);
      box-shadow: var(--shadow-lg);
    }
    .track {
      margin-top: 0.625rem; height: 0.5rem; overflow: hidden;
      border-radius: var(--radius-full); background: rgb(var(--ink-100));
    }
    .fill { border-radius: var(--radius-full); }
    /* Before the browser reports a size: a sliding stripe instead of a fake percentage. */
    .indeterminate {
      width: 40% !important;
      animation: slide 1.1s ease-in-out infinite;
    }
    @keyframes slide {
      from { transform: translateX(-100%); }
      to { transform: translateX(250%); }
    }
    @media (prefers-reduced-motion: reduce) {
      .indeterminate { animation: none; width: 100% !important; opacity: 0.6; }
    }
  `],
})
export class UploadProgressComponent {
  protected readonly uploads = inject(UploadProgressService);

  /** Leaving the page would cancel the upload, so the browser asks first. */
  @HostListener('window:beforeunload', ['$event'])
  protected warnBeforeLeaving(event: BeforeUnloadEvent): void {
    if (this.uploads.active()) {
      event.preventDefault();
      event.returnValue = '';
    }
  }
}
