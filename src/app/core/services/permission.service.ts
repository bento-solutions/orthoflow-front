import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import type { Wire } from '../api/wire';
import { Permission } from '../models/permission';
import { AuthService } from './auth.service';

type Me = Wire<'Me'>;

/**
 * The signed-in person's effective permissions, as the server resolved them
 * (`GET /me`). Loaded whenever a session starts, cleared when it ends, and
 * re-read on demand after an administrator changes a role.
 *
 * Everything here is advisory: it decides what the interface offers. The server
 * checks every request again.
 */
@Injectable({ providedIn: 'root' })
export class PermissionService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  private readonly meSignal = signal<Me | null>(null);
  private readonly loadedSignal = signal(false);
  private inflight: Promise<void> | null = null;
  private waiters: Array<() => void> = [];

  readonly me = this.meSignal.asReadonly();
  /** False until the first answer (or failure) after a session starts. */
  readonly loaded = this.loadedSignal.asReadonly();
  readonly permissions = computed<ReadonlySet<string>>(() => new Set(this.meSignal()?.permissions ?? []));
  readonly isAdmin = computed(() => this.meSignal()?.role === 'ADMIN');
  /** The practitioner record linked to this login, when there is one (a doctor, not the front desk). */
  readonly practitionerId = computed<string | null>(() => (this.meSignal()?.practitionerId as string | null | undefined) ?? null);

  constructor() {
    effect(() => {
      const token = this.auth.token();
      untracked(() => {
        if (token) {
          void this.load();
        } else {
          this.clear();
        }
      });
    });
  }

  /** True when the person holds at least one of the permissions. With none named, true. */
  can(...needed: Permission[]): boolean {
    if (needed.length === 0) {
      return true;
    }
    const held = this.permissions();
    return needed.some(p => held.has(p));
  }

  /** Resolves once the permissions are known, so a route guard never decides on an empty set. */
  ready(): Promise<void> {
    if (this.loadedSignal()) {
      return Promise.resolve();
    }
    if (!this.auth.token()) {
      return Promise.resolve();
    }
    return new Promise(resolve => this.waiters.push(resolve));
  }

  /** Reads `/me` again, for after an administrator changes what a role may do. */
  load(): Promise<void> {
    if (this.inflight) {
      return this.inflight;
    }
    this.inflight = firstValueFrom(this.http.get<Me>(`${environment.apiUrl}/api/v1/me`))
      .then(me => this.meSignal.set(me))
      // A failed read leaves no permissions rather than stale ones: the interface
      // shows less, never more than the person may do.
      .catch(() => this.meSignal.set(null))
      .finally(() => {
        this.inflight = null;
        this.loadedSignal.set(true);
        this.waiters.splice(0).forEach(resolve => resolve());
      });
    return this.inflight;
  }

  private clear(): void {
    this.meSignal.set(null);
    this.loadedSignal.set(false);
    this.waiters.splice(0).forEach(resolve => resolve());
  }
}
