import { inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { debounceTime } from 'rxjs';
import { LiveEventsService } from './live-events.service';

/**
 * Runs {@link refresh} when the server says one of {@link types} changed, for as long as the
 * calling component lives. A burst of events (a receipt and its allocations, a merge touching
 * many records) becomes one refetch. Call from a constructor or field initialiser.
 */
export function refreshOnLive(types: string[], refresh: () => void, quietMs = 300): void {
  inject(LiveEventsService)
    .of(...types)
    .pipe(debounceTime(quietMs), takeUntilDestroyed())
    .subscribe(() => refresh());
}
