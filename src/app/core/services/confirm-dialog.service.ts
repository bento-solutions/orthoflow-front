import { Injectable, inject, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

export interface ConfirmRequest {
  id: number;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
  resolve: (confirmed: boolean) => void;
}

export interface ConfirmOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Renders the confirm button in the destructive/red style. */
  danger?: boolean;
}

let nextId = 1;

/**
 * Replaces the native window.confirm() used across ~10 feature files for
 * every delete/archive/cancel action (audit III.12/VIII.3) — a native
 * confirm blocks the render thread, cannot be styled or localized, and is
 * indistinguishable from a phishing prompt on some browsers. Callers await
 * the same boolean they'd get from window.confirm(); the actual UI is a
 * single ConfirmDialogComponent mounted once in AppComponent.
 */
@Injectable({
  providedIn: 'root'
})
export class ConfirmDialogService {
  private readonly translate = inject(TranslateService);
  private requestSignal = signal<ConfirmRequest | null>(null);
  request = this.requestSignal.asReadonly();

  confirm(message: string, options: ConfirmOptions = {}): Promise<boolean> {
    return new Promise<boolean>(resolve => {
      this.requestSignal.set({
        id: nextId++,
        title: options.title ?? this.translate.instant('COMMON.CONFIRM_TITLE'),
        message,
        confirmLabel: options.confirmLabel ?? this.translate.instant('COMMON.CONFIRM'),
        cancelLabel: options.cancelLabel ?? this.translate.instant('COMMON.CANCEL'),
        danger: options.danger ?? false,
        resolve,
      });
    });
  }

  respond(confirmed: boolean): void {
    const current = this.requestSignal();
    if (!current) return;
    this.requestSignal.set(null);
    current.resolve(confirmed);
  }
}
