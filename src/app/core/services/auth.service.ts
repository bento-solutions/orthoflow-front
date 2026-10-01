import { Injectable, signal, computed, inject } from '@angular/core';
import { Observable, firstValueFrom, tap } from 'rxjs';
import { AuthApiService } from './auth-api.service';
import { AuthUser } from '../models/user.model';

const TOKEN_KEY = 'orthoflow_auth_token';
const USER_KEY = 'orthoflow_auth_user';

/** Why the session ended: the person chose to, or the server stopped accepting it. */
export type SignOutReason = 'user' | 'expired';

/**
 * Renew when this fraction of the token's life remains, and never later than
 * {@link MIN_RENEW_LEAD_MS} before it ends.
 */
const RENEW_AT_REMAINING = 0.25;
const MIN_RENEW_LEAD_MS = 15 * 60_000;

/** A renewal that failed for a reason that may pass (offline, a restart) is tried again. */
const RENEW_RETRY_MS = 60_000;

/** Minutes remaining at which the person is told the session is about to end. */
const EXPIRY_WARNING_MINUTES = [30, 10, 5];

/** setTimeout stores its delay in 32 bits. */
const MAX_TIMER_MS = 2_000_000_000;

interface TokenTimes {
  issuedAt: number | null;
  expiresAt: number;
}

/** The times a token carries, read without verifying it — the server does that. */
function readTokenTimes(token: string | null): TokenTimes | null {
  if (!token) return null;
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '='));
    const claims = JSON.parse(json) as { iat?: number; exp?: number };
    if (typeof claims.exp !== 'number') return null;
    return { issuedAt: typeof claims.iat === 'number' ? claims.iat * 1000 : null, expiresAt: claims.exp * 1000 };
  } catch {
    return null;
  }
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private api = inject(AuthApiService);

  private tokenSignal = signal<string | null>(localStorage.getItem(TOKEN_KEY));
  private userSignal = signal<AuthUser | null>(this.readStoredUser());
  private expiryWarningSignal = signal<number | null>(null);

  token = computed(() => this.tokenSignal());
  currentUser = computed(() => this.userSignal());
  isAuthenticated = computed(() => !!this.tokenSignal());

  /**
   * Minutes the session has left, set when it can no longer be renewed and is
   * about to end — the maximum session length has been reached. Null while
   * renewal is working. A dentist mid-examination cannot look at a countdown,
   * so the voice layer speaks it.
   */
  expiryWarning = this.expiryWarningSignal.asReadonly();

  private renewTimer: ReturnType<typeof setTimeout> | null = null;
  private warningTimers: Array<ReturnType<typeof setTimeout>> = [];
  private signOutHandlers = new Set<(reason: SignOutReason) => void>();
  /** How long a token issued at sign-in lives; a shorter one means the session cap applies. */
  private fullLifetimeMs: number | null = null;

  constructor() {
    this.scheduleRenewal();
    if (typeof document !== 'undefined') {
      // Timers are throttled or paused while a tab is hidden or a laptop sleeps.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && this.tokenSignal()) this.scheduleRenewal();
      });
    }
  }

  private readStoredUser(): AuthUser | null {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AuthUser;
    } catch {
      return null;
    }
  }

  login(email: string, password: string): Observable<{ token: string; user: AuthUser }> {
    return this.api.login(email, password).pipe(
      tap(response => {
        this.storeSession(response.token, response.user);
        const times = readTokenTimes(response.token);
        this.fullLifetimeMs = times?.issuedAt ? times.expiresAt - times.issuedAt : null;
        this.expiryWarningSignal.set(null);
        this.scheduleRenewal();
      })
    );
  }

  /**
   * @param reason `expired` when the server stopped accepting the token. Passed
   *   to whoever registered with {@link onSignOut}, so a running examination
   *   can say which it was.
   */
  logout(reason: SignOutReason = 'user'): void {
    for (const handler of this.signOutHandlers) {
      try {
        handler(reason);
      } catch {
        // One listener failing must not leave the session open.
      }
    }
    this.clearTimers();
    this.expiryWarningSignal.set(null);
    this.tokenSignal.set(null);
    this.userSignal.set(null);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  }

  /**
   * Called synchronously as the session ends, before the token is cleared and
   * before the router leaves the page — while a dictated examination can still
   * close its microphone and tell the dentist why. Returns an unsubscribe.
   */
  onSignOut(handler: (reason: SignOutReason) => void): () => void {
    this.signOutHandlers.add(handler);
    return () => this.signOutHandlers.delete(handler);
  }

  hasRole(...roles: AuthUser['role'][]): boolean {
    const user = this.userSignal();
    return !!user && roles.includes(user.role);
  }

  // ── Keeping the session alive ───────────────────────────────────────

  private storeSession(token: string, user: AuthUser): void {
    this.tokenSignal.set(token);
    this.userSignal.set(user);
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }

  private clearTimers(): void {
    if (this.renewTimer !== null) clearTimeout(this.renewTimer);
    this.renewTimer = null;
    this.warningTimers.forEach(timer => clearTimeout(timer));
    this.warningTimers = [];
  }

  /**
   * A token lasts a few hours and a clinic day is longer. Left alone, it runs
   * out under a dentist mid-consultation, the first request after that is a
   * 401, and the app sends them to the sign-in page from the chart they are
   * dictating onto. So the token is swapped for a fresh one well before that
   * happens, without anyone noticing.
   */
  private scheduleRenewal(): void {
    if (this.renewTimer !== null) clearTimeout(this.renewTimer);
    this.renewTimer = null;

    const times = readTokenTimes(this.tokenSignal());
    if (!times) return;

    const lifetime = times.issuedAt ? times.expiresAt - times.issuedAt : null;
    if (this.fullLifetimeMs === null) this.fullLifetimeMs = lifetime;
    const lead = Math.max(MIN_RENEW_LEAD_MS, (lifetime ?? 4 * 3_600_000) * RENEW_AT_REMAINING);
    const delay = Math.max(0, times.expiresAt - lead - Date.now());
    this.renewTimer = setTimeout(() => void this.renew(), Math.min(delay, MAX_TIMER_MS));
  }

  /** Exchanges the token for a later one. Public so a caller can renew on demand. */
  async renew(): Promise<void> {
    if (!this.tokenSignal()) return;
    try {
      const response = await firstValueFrom(this.api.refresh());
      this.storeSession(response.token, response.user);
      this.warningTimers.forEach(timer => clearTimeout(timer));
      this.warningTimers = [];
      this.expiryWarningSignal.set(null);

      const times = readTokenTimes(response.token);
      const capped = !!times?.issuedAt && this.fullLifetimeMs !== null
        && times.expiresAt - times.issuedAt < this.fullLifetimeMs - 60_000;
      // A token shorter than a normal one is the session's last: the maximum
      // session length was reached, and the next renewal will be refused.
      if (capped) this.scheduleWarnings();
      this.scheduleRenewal();
    } catch (error) {
      const status = (error as { status?: number } | null)?.status;
      if (status === 401) {
        // The sign-in is too old to extend (or the account is no longer
        // valid). This token is the last one: warn as it runs out.
        this.scheduleWarnings();
        return;
      }
      // Offline, or the server restarting: try again while the token is alive.
      const times = readTokenTimes(this.tokenSignal());
      if (times && times.expiresAt > Date.now()) {
        this.renewTimer = setTimeout(() => void this.renew(), RENEW_RETRY_MS);
      }
    }
  }

  /**
   * Tells the person, at 30, 10 and 5 minutes, that the session is about to
   * end and cannot be extended — or at once, if it is already that close.
   */
  private scheduleWarnings(): void {
    const times = readTokenTimes(this.tokenSignal());
    if (!times) return;
    this.warningTimers.forEach(timer => clearTimeout(timer));
    this.warningTimers = [];

    const remaining = (times.expiresAt - Date.now()) / 60_000;
    if (remaining <= 0) return;
    if (remaining <= EXPIRY_WARNING_MINUTES[0]) this.expiryWarningSignal.set(Math.max(1, Math.round(remaining)));

    for (const minutes of EXPIRY_WARNING_MINUTES) {
      if (remaining > minutes) {
        this.warningTimers.push(setTimeout(
          () => this.expiryWarningSignal.set(minutes),
          Math.min((remaining - minutes) * 60_000, MAX_TIMER_MS),
        ));
      }
    }
  }
}
