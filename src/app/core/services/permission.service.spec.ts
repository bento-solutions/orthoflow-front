import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { Router, provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { PERMISSIONS } from '../models/permission';
import { permissionGuard } from '../guards/permission.guard';
import { AuthService } from './auth.service';
import { PermissionService } from './permission.service';

const ME = { id: 'u-1', email: 'a@b.ma', role: 'DOCTOR', practiceId: 'p-1', permissions: ['PATIENT_READ', 'FINANCE_VIEW'], practitionerId: 'pr-1' };

describe('PermissionService', () => {
  const token = signal<string | null>(null);
  let http: HttpTestingController;

  beforeEach(() => {
    token.set(null);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: AuthService, useValue: { token } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  const signIn = async (answer: object | null = ME) => {
    const service = TestBed.inject(PermissionService);
    token.set('jwt');
    TestBed.tick();
    const req = http.expectOne(r => r.url.endsWith('/api/v1/me'));
    if (answer) {
      req.flush(answer);
    } else {
      req.flush('boom', { status: 500, statusText: 'Server Error' });
    }
    await service.ready();
    return service;
  };

  it('knows nothing until someone is signed in, and asks nothing before then', () => {
    const service = TestBed.inject(PermissionService);
    TestBed.tick();
    http.expectNone(r => r.url.endsWith('/api/v1/me'));
    expect(service.can('PATIENT_READ')).toBe(false);
    expect(service.loaded()).toBe(false);
  });

  it('loads what the server resolved when a session starts', async () => {
    const service = await signIn();
    expect(service.loaded()).toBe(true);
    expect(service.can('FINANCE_VIEW')).toBe(true);
    expect(service.can('FINANCE_MANAGE')).toBe(false);
    expect(service.practitionerId()).toBe('pr-1');
    expect(service.isAdmin()).toBe(false);
  });

  it('treats a list as any-of, and an empty list as no requirement', async () => {
    const service = await signIn();
    expect(service.can('FINANCE_MANAGE', 'PATIENT_READ')).toBe(true);
    expect(service.can('FINANCE_MANAGE', 'USERS_MANAGE')).toBe(false);
    expect(service.can()).toBe(true);
  });

  it('shows less, not more, when the answer cannot be read', async () => {
    const service = await signIn(null);
    expect(service.loaded()).toBe(true);
    expect(service.can('PATIENT_READ')).toBe(false);
  });

  it('forgets everything when the session ends', async () => {
    const service = await signIn();
    token.set(null);
    TestBed.tick();
    expect(service.can('PATIENT_READ')).toBe(false);
    expect(service.loaded()).toBe(false);
    expect(service.practitionerId()).toBeNull();
  });

  it('makes a guard wait for the answer instead of deciding on an empty set', async () => {
    const service = TestBed.inject(PermissionService);
    token.set('jwt');
    TestBed.tick();
    const pending = TestBed.runInInjectionContext(() => permissionGuard('FINANCE_VIEW')({} as never, {} as never));
    let settled = false;
    Promise.resolve(pending).then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);

    http.expectOne(r => r.url.endsWith('/api/v1/me')).flush(ME);
    expect(await pending).toBe(true);
    expect(service.can('FINANCE_VIEW')).toBe(true);
  });

  it('sends someone without the permission to the overview', async () => {
    await signIn();
    const result = await TestBed.runInInjectionContext(() => permissionGuard('USERS_MANAGE')({} as never, {} as never));
    expect(TestBed.inject(Router).serializeUrl(result as never)).toBe('/');
  });

  it('keeps the browser list in step with the permissions the server defines', () => {
    // The backend enum, copied here on purpose: when a permission is added there, this fails until the list above is updated.
    const server = [
      'PATIENT_READ', 'PATIENT_WRITE', 'PATIENT_DELETE', 'PATIENT_MERGE', 'CLINICAL_READ', 'CLINICAL_WRITE', 'AGENDA_VIEW', 'AGENDA_MANAGE',
      'WAITING_ROOM_MANAGE', 'BILLING_READ', 'BILLING_WRITE', 'FINANCE_VIEW', 'FINANCE_MANAGE', 'EXPENSES_MANAGE', 'RETROCESSION_VIEW',
      'RETROCESSION_MANAGE', 'STOCK_READ', 'STOCK_WRITE', 'LAB_ORDERS_MANAGE', 'TASKS_MANAGE', 'TASKS_ADMIN', 'MESSAGING_SEND', 'MESSAGING_VIEW',
      'BOOKING_REVIEW', 'SURVEYS_VIEW', 'ANALYTICS_VIEW', 'STERILIZATION_MANAGE', 'SETTINGS_MANAGE', 'USERS_MANAGE',
    ];
    expect([...PERMISSIONS]).toEqual(server);
  });
});
