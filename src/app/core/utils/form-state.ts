import { WritableSignal, signal } from '@angular/core';

export interface FormState<T extends object> {
  value: WritableSignal<T>;
  /** Sets one field. */
  set<K extends keyof T>(key: K, value: T[K]): void;
  /** Replaces the whole form, for opening it on a record or clearing it. */
  reset(value: T): void;
}

/**
 * A form as one signal. The app has no zone.js, so a plain object mutated after an
 * `await` would not repaint; a signal always does. Bind a field with
 * `[ngModel]="f.value().name" (ngModelChange)="f.set('name', $event)"`.
 */
export function formState<T extends object>(initial: T): FormState<T> {
  const value = signal<T>(initial);
  return {
    value,
    set: (key, v) => value.update(current => ({ ...current, [key]: v })),
    reset: v => value.set(v),
  };
}
