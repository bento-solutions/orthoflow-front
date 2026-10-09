import '@angular/compiler';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../services/auth.service';
import { authInterceptor, isPublicRequest } from './auth.interceptor';

describe('authInterceptor', () => {
  let http: HttpClient;
  let controller: HttpTestingController;
  let logout: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;
  const session = signal<string | null>('staff-jwt');

  beforeEach(() => {
    logout = vi.fn();
    navigate = vi.fn();
    session.set('staff-jwt');
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { token: session, logout } },
        { provide: Router, useValue: { navigate } },
      ],
    });
    http = TestBed.inject(HttpClient);
    controller = TestBed.inject(HttpTestingController);
  });

  it('recognises the public endpoints', () => {
    expect(isPublicRequest('http://localhost:8080/api/v1/public/book/abc')).toBe(true);
    expect(isPublicRequest('http://localhost:8080/api/v1/patients')).toBe(false);
    expect(isPublicRequest('http://localhost:8080/api/v1/public-links/shared/BOOKING')).toBe(false);
  });

  it('sends the session with an ordinary request', () => {
    http.get('http://localhost:8080/api/v1/patients').subscribe();
    expect(controller.expectOne('http://localhost:8080/api/v1/patients').request.headers.get('Authorization')).toBe('Bearer staff-jwt');
  });

  it('keeps the session off a public form request', () => {
    http.post('http://localhost:8080/api/v1/public/book/abc/requests', {}).subscribe();
    expect(controller.expectOne('http://localhost:8080/api/v1/public/book/abc/requests').request.headers.has('Authorization')).toBe(false);
  });

  it('signs out on an expired session, but never because a public form said 401', () => {
    http.get('http://localhost:8080/api/v1/patients').subscribe({ error: () => undefined });
    controller.expectOne('http://localhost:8080/api/v1/patients').flush('', { status: 401, statusText: 'Unauthorized' });
    expect(logout).toHaveBeenCalledWith('expired');
    expect(navigate).toHaveBeenCalledWith(['/login']);

    logout.mockClear();
    http.get('http://localhost:8080/api/v1/public/survey/x').subscribe({ error: () => undefined });
    controller.expectOne('http://localhost:8080/api/v1/public/survey/x').flush('', { status: 401, statusText: 'Unauthorized' });
    expect(logout).not.toHaveBeenCalled();
  });

  it('leaves a signed-out visitor on the page they opened, e.g. a reset-password link', () => {
    session.set(null);
    http.get('http://localhost:8080/api/v1/voice/lexicon').subscribe({ error: () => undefined });
    controller.expectOne('http://localhost:8080/api/v1/voice/lexicon').flush('', { status: 401, statusText: 'Unauthorized' });
    expect(logout).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
