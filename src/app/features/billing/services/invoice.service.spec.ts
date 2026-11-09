import '@angular/compiler';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { AuthService } from '../../../core/services/auth.service';
import { PermissionService } from '../../../core/services/permission.service';
import { ToastService } from '../../../core/services/toast.service';
import { InvoiceService } from './invoice.service';

describe('InvoiceService', () => {
  let http: HttpTestingController;
  let error: ReturnType<typeof vi.fn>;

  const setUp = (held: string[]) => {
    error = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ defaultLanguage: 'fr' }),
        { provide: AuthService, useValue: { token: signal('jwt') } },
        { provide: PermissionService, useValue: { ready: () => Promise.resolve(), can: (p: string) => held.includes(p) } },
        { provide: ToastService, useValue: { error } },
      ],
    });
    const service = TestBed.inject(InvoiceService);
    http = TestBed.inject(HttpTestingController);
    TestBed.tick();
    return service;
  };

  const invoices = () => http.expectOne(r => r.url.endsWith('/api/v1/invoices'));

  beforeEach(() => TestBed.resetTestingModule());

  it('asks for the clinic\'s totals only from someone who may see them', async () => {
    const service = setUp([]);
    invoices().flush({ content: [] });
    await Promise.resolve();
    http.expectNone(r => r.url.endsWith('/invoices/summary'));
    expect(service.summary()).toBeNull();
    expect(error).not.toHaveBeenCalled();
  });

  it('loads them for someone with FINANCE_VIEW', async () => {
    const service = setUp(['FINANCE_VIEW']);
    invoices().flush({ content: [] });
    await new Promise(r => setTimeout(r));
    http.expectOne(r => r.url.endsWith('/invoices/summary')).flush({ totalInvoiced: 10, totalCollected: 5, outstandingAmount: 5 });
    expect(service.summary()?.totalInvoiced).toBe(10);
  });

  it('shows no error for a session that has just ended', () => {
    setUp(['FINANCE_VIEW']);
    invoices().flush('', { status: 401, statusText: 'Unauthorized' });
    expect(error).not.toHaveBeenCalled();
  });
});
