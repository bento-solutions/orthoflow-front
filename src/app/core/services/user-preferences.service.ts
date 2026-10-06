import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

export type Preferences = Record<string, unknown>;

/**
 * Per-person interface preferences, kept on the server so they follow someone
 * from the front-desk PC to their phone. The server treats the JSON as opaque
 * (`GET`/`PUT /me/preferences`): this service owns its shape, so a new
 * preference never needs a backend change.
 *
 * Writes are queued one after another, each merged onto the latest value, so
 * two quick changes (theme, then agenda view) cannot overwrite each other.
 */
@Injectable({ providedIn: 'root' })
export class UserPreferencesService {
  private readonly http = inject(HttpClient);
  private readonly url = `${environment.apiUrl}/api/v1/me/preferences`;
  private cache: Preferences | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  async get(): Promise<Preferences> {
    if (this.cache) {
      return this.cache;
    }
    this.cache = await firstValueFrom(this.http.get<Preferences>(this.url));
    return this.cache;
  }

  /** Merges `partial` into the stored preferences. Resolves with the result. */
  patch(partial: Preferences): Promise<Preferences> {
    const next = this.queue.then(async () => {
      const merged = { ...(await this.get()), ...partial };
      this.cache = await firstValueFrom(this.http.put<Preferences>(this.url, merged));
      return this.cache;
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Forgets the cached copy, for when someone else signs in. */
  clear(): void {
    this.cache = null;
  }
}
