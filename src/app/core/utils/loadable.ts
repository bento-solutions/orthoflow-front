import { WritableSignal, inject, signal } from '@angular/core';
import { Observable, firstValueFrom, isObservable } from 'rxjs';
import { ApiErrors } from '../services/api-error.service';

export interface Loadable<T> {
  data: WritableSignal<T>;
  loading: WritableSignal<boolean>;
  /** True after a load that failed, until the next one succeeds. The error itself was already shown. */
  failed: WritableSignal<boolean>;
  /** Runs the request, keeping the old data on screen while it runs and after it fails. */
  load(source: () => Observable<T> | Promise<T>): Promise<boolean>;
}

/**
 * The state every list or report screen needs: the data, whether a request is out,
 * and whether the last one failed. A failure is reported once, as a toast, and the
 * previous data stays visible: an empty table after a network blip reads as
 * "there is nothing", which is the wrong message.
 *
 * Call in an injection context (a field initialiser).
 */
export function loadable<T>(initial: T): Loadable<T> {
  const errors = inject(ApiErrors);
  const data = signal<T>(initial);
  const loading = signal(false);
  const failed = signal(false);
  // A newer request makes an older one irrelevant: its answer must not overwrite what the person asked for last.
  let latest = 0;

  return {
    data,
    loading,
    failed,
    async load(source) {
      const mine = ++latest;
      loading.set(true);
      try {
        const result = source();
        const value = isObservable(result) ? await firstValueFrom(result) : await result;
        if (mine === latest) {
          data.set(value);
          failed.set(false);
        }
        return true;
      } catch (error) {
        if (mine === latest) {
          failed.set(true);
          errors.report(error);
        }
        return false;
      } finally {
        if (mine === latest) {
          loading.set(false);
        }
      }
    },
  };
}
