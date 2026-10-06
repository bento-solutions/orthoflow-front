import '@angular/compiler';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DownloadService } from '../../core/services/download.service';
import { LanguageService } from '../../core/services/language.service';
import { LabOrder, OperationsApi } from '../../core/services/operations-api.service';
import { PracticeProfileService } from '../../core/services/practice-profile.service';
import { screenMocks } from '../../testing/screen-mocks';
import { EMPTY_LAB_FILTER, LabOrdersComponent, filterFromParams, filterToParams, filterToQuery, labTone, nextStatuses } from './lab-orders.component';

const order = (over: Partial<LabOrder> = {}): LabOrder => ({
  id: 'o1', patientId: 'p1', patientName: 'Sara Alami', labId: 'l1', labName: 'Labo Atlas', practitionerId: 'd1', practitionerName: 'Dr Tazi', itemType: 'RETAINER', description: 'Contention haut',
  sentDate: '2026-10-01', dueDate: '2026-10-10', status: 'SENT', urgent: false, cost: 450, fittingAppointmentId: '', fittingAt: '', receivedDate: '', fittedDate: '', notes: '', warnings: [],
  createdAt: '2026-10-01T09:00:00Z', updatedAt: '2026-10-01T09:00:00Z', ...over,
});

describe('lab order helpers', () => {
  it('lets an order move only where the lab workflow goes', () => {
    expect(nextStatuses('SENT')).toEqual(['IN_PROGRESS', 'RECEIVED']);
    expect(nextStatuses('IN_PROGRESS')).toEqual(['RECEIVED']);
    expect(nextStatuses('RECEIVED')).toEqual(['FITTED', 'REMAKE']);
    expect(nextStatuses('FITTED')).toEqual(['REMAKE']);
    expect(nextStatuses('REMAKE')).toEqual(['SENT', 'IN_PROGRESS']);
  });

  it('colours a remake as a problem and a fitted piece as settled', () => {
    expect(labTone('REMAKE')).toBe('pill-critical');
    expect(labTone('FITTED')).toBe('pill-done');
    expect(labTone('SENT')).toBe('pill-attention');
  });

  it('keeps the filters in the address and reads them back the same', () => {
    const filter = { ...EMPTY_LAB_FILTER, status: ['SENT', 'REMAKE'] as never, search: 'alami', urgentOnly: true, dueTo: '2026-10-31' };
    const params = filterToParams(filter);
    expect(params).toEqual(expect.objectContaining({ status: 'SENT,REMAKE', q: 'alami', urgent: '1', dueTo: '2026-10-31', overdue: null, lab: null }));
    expect(filterFromParams(key => (params as Record<string, string | null>)[key] ?? null)).toEqual(filter);
  });

  it('gives the unfiltered list an empty address and ignores unknown statuses in it', () => {
    expect(Object.values(filterToParams(EMPTY_LAB_FILTER)).every(v => v === null)).toBe(true);
    expect(filterFromParams(key => (key === 'status' ? 'SENT,BOGUS' : null)).status).toEqual(['SENT']);
  });

  it('sends only the filters that are set to the server', () => {
    expect(filterToQuery(EMPTY_LAB_FILTER)).toEqual({ status: [], search: undefined, labId: undefined, dueFrom: undefined, dueTo: undefined, updatedFrom: undefined, updatedTo: undefined, urgentOnly: undefined, overdueOnly: undefined });
  });
});

describe('LabOrdersComponent', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;
  let mocks: ReturnType<typeof screenMocks>;
  let navigate: ReturnType<typeof vi.fn>;

  const mount = async (params: Record<string, string> = {}) => {
    mocks = screenMocks();
    navigate = vi.fn(async () => true);
    TestBed.configureTestingModule({
      imports: [LabOrdersComponent, TranslateModule.forRoot()],
      providers: [
        { provide: OperationsApi, useValue: api },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: (k: string) => params[k] ?? null } } } },
        { provide: Router, useValue: { navigate } },
        { provide: LanguageService, useValue: { currentLang: () => 'fr' } },
        { provide: PracticeProfileService, useValue: { currency: signal('MAD') } },
        { provide: DownloadService, useValue: { open: vi.fn(async () => undefined) } },
        ...mocks.providers,
      ],
    });
    const fixture = TestBed.createComponent(LabOrdersComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  };
  const settleUi = async (fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const receivedButton = () => [...[...document.querySelectorAll('tbody tr')][0].querySelectorAll('button')].find(b => b.textContent?.includes('LAB.MOVE.RECEIVED')) as HTMLButtonElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    api = {
      labOrders: vi.fn(async () => [order(), order({ id: 'o2', patientName: 'Karim Alaoui', status: 'RECEIVED', warnings: ['OVERDUE'], urgent: true })]),
      labs: vi.fn(async () => [{ id: 'l1', name: 'Labo Atlas', phone: '', email: '' }]),
      createLab: vi.fn(async () => ({})),
      createLabOrder: vi.fn(async () => order()),
      updateLabOrder: vi.fn(async () => order()),
      transitionLabOrder: vi.fn(async () => order()),
      upcomingAppointments: vi.fn(async () => []),
    };
  });

  it('opens with the filters that were in the address and asks the server for exactly those', async () => {
    await mount({ status: 'SENT,IN_PROGRESS', urgent: '1', q: 'alami' });
    expect(api['labOrders']).toHaveBeenCalledWith(expect.objectContaining({ status: ['SENT', 'IN_PROGRESS'], urgentOnly: true, search: 'alami' }));
  });

  it('writes a filter change back to the address', async () => {
    const fixture = await mount();
    const seg = [...document.querySelectorAll('.seg-item')].find(b => b.textContent?.includes('LAB.STATUSES.SENT')) as HTMLButtonElement;
    seg.click();
    await settleUi(fixture);
    expect(navigate).toHaveBeenLastCalledWith([], { queryParams: expect.objectContaining({ status: 'SENT' }), replaceUrl: true });
    expect(api['labOrders']).toHaveBeenLastCalledWith(expect.objectContaining({ status: ['SENT'] }));
  });

  it('flags a late order and an urgent one', async () => {
    await mount();
    const text = document.body.textContent!;
    expect(text).toContain('LAB.WARNINGS.OVERDUE');
    expect(text).toContain('LAB.URGENT');
  });

  it('offers each order only the moves its status allows', async () => {
    await mount();
    const rows = [...document.querySelectorAll('tbody tr')];
    expect(rows[0].textContent).toContain('LAB.MOVE.IN_PROGRESS');
    expect(rows[0].textContent).toContain('LAB.MOVE.RECEIVED');
    expect(rows[0].textContent).not.toContain('LAB.MOVE.FITTED');
    expect(rows[1].textContent).toContain('LAB.MOVE.FITTED');
    expect(rows[1].textContent).toContain('LAB.MOVE.REMAKE');
  });

  it('moves an order with the chosen date and tells the person', async () => {
    const fixture = await mount();
    receivedButton().click();
    await settleUi(fixture);
    expect(document.body.textContent).toContain('LAB.RECEIVED_HINT');
    (document.querySelector('#move-form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settleUi(fixture);
    expect(api['transitionLabOrder']).toHaveBeenCalledWith('o1', 'RECEIVED', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    expect(mocks.toasts.map(t => t.kind)).toEqual(['success']);
  });

  it('reports a refused move and keeps the dialog open', async () => {
    api['transitionLabOrder'].mockRejectedValueOnce(new Error('409'));
    const fixture = await mount();
    receivedButton().click();
    await settleUi(fixture);
    (document.querySelector('#move-form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settleUi(fixture);
    expect(mocks.errors).toHaveLength(1);
    expect(document.querySelector('[role=dialog]')).not.toBeNull();
  });
});
