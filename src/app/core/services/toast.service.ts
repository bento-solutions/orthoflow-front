import { Injectable, signal } from '@angular/core';

export type ToastVariant = 'success' | 'error' | 'info';

/** A link the toast offers, for an error the person fixes somewhere else (an incomplete clinic profile). */
export interface ToastAction {
  label: string;
  link: string;
}

export interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
  durationMs: number;
  action?: ToastAction;
}

let nextId = 1;

/**
 * Global notification service. Every mutation in the app should resolve to
 * exactly one visible outcome — a success toast or an actionable error toast
 * — instead of a result the user has no way to observe (see audit VIII.2).
 */
@Injectable({
  providedIn: 'root'
})
export class ToastService {
  private toastsSignal = signal<Toast[]>([]);
  toasts = this.toastsSignal.asReadonly();

  success(message: string, durationMs = 4000): void {
    this.push(message, 'success', durationMs);
  }

  /** Stays until dismissed: seven seconds is not long enough for everyone to read why something failed. */
  error(message: string, durationMs = 0, action?: ToastAction): void {
    this.push(message, 'error', durationMs, action);
  }

  info(message: string, durationMs = 4000): void {
    this.push(message, 'info', durationMs);
  }

  dismiss(id: number): void {
    this.toastsSignal.update(toasts => toasts.filter(t => t.id !== id));
  }

  private push(message: string, variant: ToastVariant, durationMs: number, action?: ToastAction): void {
    const toast: Toast = { id: nextId++, message, variant, durationMs, ...(action ? { action } : {}) };
    this.toastsSignal.update(toasts => [...toasts, toast]);
    if (durationMs > 0) {
      setTimeout(() => this.dismiss(toast.id), durationMs);
    }
  }
}
