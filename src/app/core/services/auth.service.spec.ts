import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthApiService } from './auth-api.service';
import { AuthService } from './auth.service';

/**
 * A session that outlasts one token. What matters here is what a dentist
 * mid-examination sees: nothing, while it is renewed; a spoken warning when it
 * cannot be; and a clear reason when it ends.
 */

const HOUR = 3_600_000;
const MINUTE = 60_000;
const USER = { id: 'u-1', email: 'doc@clinic.test', firstName: 'A', lastName: 'B', role: 'DOCTOR', active: true } as never;

/** A token carrying just the times the client reads. */
function tokenFor(issuedAt: number, lifetimeMs: number): string {
  const encode = (value: object) => btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${encode({ alg: 'none' })}.${encode({ iat: Math.floor(issuedAt / 1000), exp: Math.floor((issuedAt + lifetimeMs) / 1000) })}.sig`;
}

describe('AuthService — keeping the session alive', () => {
  let refreshes: Array<() => unknown>;
  let refresh: ReturnType<typeof vi.fn>;
  const start = new Date('2026-09-30T08:00:00Z').getTime();

  const create = () => {
    TestBed.configureTestingModule({
      providers: [{ provide: AuthApiService, useValue: { refresh, login: () => of({ token: tokenFor(Date.now(), 4 * HOUR), user: USER }) } }],
    });
    return TestBed.inject(AuthService);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(start);
    localStorage.clear();
    refreshes = [];
    refresh = vi.fn(() => of({ token: tokenFor(Date.now(), 4 * HOUR), user: USER }));
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('renews the token with an hour left, without anyone being asked', async () => {
    localStorage.setItem('orthoflow_auth_token', tokenFor(start, 4 * HOUR));
    localStorage.setItem('orthoflow_auth_user', JSON.stringify(USER));
    const auth = create();
    const original = auth.token();

    await vi.advanceTimersByTimeAsync(3 * HOUR - MINUTE);
    expect(refresh).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2 * MINUTE);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(auth.token()).not.toBe(original);
    expect(auth.isAuthenticated()).toBe(true);
    expect(auth.expiryWarning()).toBeNull();
  });

  it('keeps renewing, hour after hour, for as long as the server allows', async () => {
    localStorage.setItem('orthoflow_auth_token', tokenFor(start, 4 * HOUR));
    const auth = create();

    await vi.advanceTimersByTimeAsync(9 * HOUR);

    // 3h, then 3h after each renewal: at 3, 6 and 9 hours.
    expect(refresh).toHaveBeenCalledTimes(3);
    expect(auth.isAuthenticated()).toBe(true);
  });

  it('renews at once a token that is already close to the end when the page opens', async () => {
    localStorage.setItem('orthoflow_auth_token', tokenFor(start - 3.5 * HOUR, 4 * HOUR));
    create();

    await vi.advanceTimersByTimeAsync(0);

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('tries again in a minute when the server cannot be reached', async () => {
    localStorage.setItem('orthoflow_auth_token', tokenFor(start - 3.5 * HOUR, 4 * HOUR));
    refresh.mockReturnValueOnce(throwError(() => ({ status: 0 })));
    const auth = create();

    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(auth.isAuthenticated()).toBe(true);

    await vi.advanceTimersByTimeAsync(MINUTE + 1);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('warns 30, 10 and 5 minutes out when the session cannot be extended any further', async () => {
    localStorage.setItem('orthoflow_auth_token', tokenFor(start, 4 * HOUR));
    refresh.mockReturnValue(throwError(() => ({ status: 401 })));
    const auth = create();

    await vi.advanceTimersByTimeAsync(3 * HOUR + MINUTE);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(auth.expiryWarning()).toBeNull();

    // 4h token: 30 minutes left is 3h30 in.
    await vi.advanceTimersByTimeAsync(29 * MINUTE + 1);
    expect(auth.expiryWarning()).toBe(30);
    await vi.advanceTimersByTimeAsync(20 * MINUTE);
    expect(auth.expiryWarning()).toBe(10);
    await vi.advanceTimersByTimeAsync(5 * MINUTE);
    expect(auth.expiryWarning()).toBe(5);
    // Renewal was refused, so it is not retried in a loop.
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('warns straight away when the last token is already inside the final half hour', async () => {
    localStorage.setItem('orthoflow_auth_token', tokenFor(start - 3.7 * HOUR, 4 * HOUR));
    refresh.mockReturnValue(throwError(() => ({ status: 401 })));
    const auth = create();

    await vi.advanceTimersByTimeAsync(0);

    expect(auth.expiryWarning()).toBe(18);
  });

  it('treats a shorter renewed token as the last, and warns as it runs out', async () => {
    const auth = create();
    await new Promise<void>(resolve => auth.login('a', 'b').subscribe(() => resolve()));
    // The server caps the next one: only two hours left of the sign-in.
    refresh.mockReturnValueOnce(of({ token: tokenFor(Date.now() + 3 * HOUR, 2 * HOUR), user: USER }));
    // And the renewal after that is refused: the sign-in has reached its maximum.
    refresh.mockReturnValue(throwError(() => ({ status: 401 })));

    await vi.advanceTimersByTimeAsync(3 * HOUR + MINUTE);
    expect(auth.expiryWarning()).toBeNull();

    // 2h token issued at 3h: 30 minutes left at 4h30.
    await vi.advanceTimersByTimeAsync(90 * MINUTE);
    expect(auth.expiryWarning()).toBe(30);
  });

  it('does nothing for a token it cannot read', async () => {
    localStorage.setItem('orthoflow_auth_token', 'not-a-jwt');
    create();

    await vi.advanceTimersByTimeAsync(10 * HOUR);

    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('AuthService — signing out', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('orthoflow_auth_token', tokenFor(Date.now(), 4 * HOUR));
    localStorage.setItem('orthoflow_auth_user', JSON.stringify(USER));
    TestBed.configureTestingModule({
      providers: [{ provide: AuthApiService, useValue: { refresh: () => of({ token: 'x', user: USER }) } }],
    });
  });

  afterEach(() => localStorage.clear());

  it('tells a listener why, before the token is cleared', () => {
    const auth = TestBed.inject(AuthService);
    const seen: Array<{ reason: string; stillSignedIn: boolean }> = [];
    auth.onSignOut(reason => seen.push({ reason, stillSignedIn: auth.isAuthenticated() }));

    auth.logout('expired');

    expect(seen).toEqual([{ reason: 'expired', stillSignedIn: true }]);
    expect(auth.isAuthenticated()).toBe(false);
    expect(localStorage.getItem('orthoflow_auth_token')).toBeNull();
  });

  it('is a user\'s own choice unless told otherwise', () => {
    const auth = TestBed.inject(AuthService);
    const reasons: string[] = [];
    auth.onSignOut(reason => reasons.push(reason));

    auth.logout();

    expect(reasons).toEqual(['user']);
  });

  it('signs out even when a listener throws', () => {
    const auth = TestBed.inject(AuthService);
    auth.onSignOut(() => { throw new Error('listener failed'); });

    auth.logout('expired');

    expect(auth.isAuthenticated()).toBe(false);
  });

  it('stops renewing once signed out', async () => {
    vi.useFakeTimers();
    try {
      const refresh = vi.fn(() => of({ token: 'x', user: USER }));
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [{ provide: AuthApiService, useValue: { refresh } }] });
      const auth = TestBed.inject(AuthService);

      auth.logout();
      await vi.advanceTimersByTimeAsync(10 * HOUR);

      expect(refresh).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
