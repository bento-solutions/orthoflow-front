import { Component, inject } from '@angular/core';
import { ConfirmDialogService } from '../../../core/services/confirm-dialog.service';
import { DialogDirective } from '../../ui/dialog.directive';

/**
 * Replacement for the native `confirm()` the product used to rely on.
 *
 * The destructive path is styled as destructive and the safe path is the
 * one nearest the reader's resting position, so the dangerous button is
 * never the one you hit by muscle memory.
 */
@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [DialogDirective],
  template: `
    @if (dialogService.request(); as req) {
      <div class="backdrop" (click)="dialogService.respond(false)">
        <div
          class="panel"
          role="alertdialog"
          [appDialog]="'confirm-title-' + req.id"
          (dialogClosed)="dialogService.respond(false)"
          [attr.aria-describedby]="'confirm-message-' + req.id"
          (click)="$event.stopPropagation()"
        >
          <div class="flex items-start gap-3">
            @if (req.danger) {
              <span class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-critical-50 text-critical-700" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4" /><circle cx="12" cy="17" r=".5" fill="currentColor" />
                </svg>
              </span>
            }
            <div class="min-w-0">
              <h2 [id]="'confirm-title-' + req.id" class="text-lg font-bold text-ink-900">{{ req.title }}</h2>
              <p [id]="'confirm-message-' + req.id" class="mt-1 text-base leading-relaxed text-ink-600">{{ req.message }}</p>
            </div>
          </div>

          <div class="mt-5 flex justify-end gap-2">
            <button type="button" class="btn btn-secondary" (click)="dialogService.respond(false)">
              {{ req.cancelLabel }}
            </button>
            <button
              type="button"
              class="btn"
              [class.btn-danger]="req.danger"
              [class.btn-primary]="!req.danger"
              (click)="dialogService.respond(true)"
            >
              {{ req.confirmLabel }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .backdrop {
      position: fixed;
      inset: 0;
      z-index: var(--z-modal);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: var(--space-4);
      background: rgb(var(--ink-950) / 0.45);
      backdrop-filter: blur(2px);
      animation: backdrop-in var(--dur-2) var(--ease-out);
    }
    .panel {
      width: 100%;
      max-width: 26rem;
      padding: var(--space-5);
      background: var(--surface);
      border-radius: var(--radius-xl);
      box-shadow: var(--shadow-xl);
      animation: panel-in var(--dur-3) var(--ease-out);
    }
    @keyframes backdrop-in { from { opacity: 0; } to { opacity: 1; } }
    @keyframes panel-in {
      from { opacity: 0; transform: scale(0.97) translateY(8px); }
      to   { opacity: 1; transform: scale(1) translateY(0); }
    }
    @media (prefers-reduced-motion: reduce) {
      .backdrop, .panel { animation: none; }
    }
  `],
})
export class ConfirmDialogComponent {
  readonly dialogService = inject(ConfirmDialogService);
}
