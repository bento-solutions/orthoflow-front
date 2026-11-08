import { Component, inject } from '@angular/core';
import { ToastService } from '../../../core/services/toast.service';
import { IconComponent, IconName } from '../../ui/icon.component';
import { TranslateModule } from '@ngx-translate/core';

/**
 * Transient feedback region.
 *
 * Toasts enter from the edge they live on, so the motion reads as
 * "something arrived here" rather than a panel materialising in place.
 * The coloured rail on the leading edge carries the status tone without
 * tinting the whole surface, which keeps the message text at full
 * contrast against white.
 */
@Component({
  selector: 'app-toast-container',
  standalone: true,
  imports: [TranslateModule, IconComponent],
  template: `
    <div class="region" role="status" aria-live="polite">
      @for (toast of toastService.toasts(); track toast.id) {
        <div class="toast" [class]="toast.variant">
          <span class="icon-slot"><app-icon [name]="iconFor(toast.variant)" [size]="17" /></span>
          <span class="message">{{ toast.message }}</span>
          <button
            type="button"
            class="dismiss"
            (click)="toastService.dismiss(toast.id)"
            [attr.aria-label]="'COMMON.DISMISS' | translate"
          >
            <app-icon name="close" [size]="15" />
          </button>
        </div>
      }
    </div>
  `,
  styles: [`
    .region {
      position: fixed;
      bottom: var(--space-5);
      inset-inline-end: var(--space-5);
      z-index: var(--z-toast);
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      max-width: min(24rem, calc(100vw - 2rem));
      pointer-events: none;
    }

    .toast {
      position: relative;
      display: flex;
      align-items: flex-start;
      gap: var(--space-3);
      padding: 0.75rem 0.875rem 0.75rem 1rem;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow-lg);
      color: var(--text);
      font-size: var(--text-base);
      overflow: hidden;
      pointer-events: auto;
      animation: toast-in var(--dur-3) var(--ease-out);
    }

    /* Status rail, on the leading edge in both writing directions. */
    .toast::before {
      content: '';
      position: absolute;
      inset-block: 0;
      inset-inline-start: 0;
      width: 3px;
      background: var(--status-idle);
    }
    .toast.success::before { background: var(--status-done); }
    .toast.error::before   { background: var(--status-critical); }
    .toast.info::before    { background: var(--status-active); }

    .icon-slot { display: flex; flex-shrink: 0; margin-top: 1px; color: var(--text-subtle); }
    .toast.success .icon-slot { color: rgb(var(--positive-700)); }
    .toast.error .icon-slot   { color: rgb(var(--critical-700)); }
    .toast.info .icon-slot    { color: rgb(var(--petrol-700)); }

    .message { flex: 1; line-height: var(--leading-snug); }

    .dismiss {
      display: flex;
      flex-shrink: 0;
      padding: 2px;
      margin: -2px;
      border: 0;
      border-radius: var(--radius-xs);
      background: none;
      color: var(--text-subtle);
      cursor: pointer;
      transition: color var(--dur-1) var(--ease-out), background-color var(--dur-1) var(--ease-out);
    }
    .dismiss:hover { color: var(--text); background: var(--surface-hover); }

    @keyframes toast-in {
      from { opacity: 0; transform: translateY(10px) scale(0.98); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
    @media (prefers-reduced-motion: reduce) {
      .toast { animation: none; }
    }
  `],
})
export class ToastContainerComponent {
  readonly toastService = inject(ToastService);

  iconFor(variant: string): IconName {
    switch (variant) {
      case 'success': return 'check-circle';
      case 'error': return 'alert-circle';
      default: return 'info';
    }
  }
}
