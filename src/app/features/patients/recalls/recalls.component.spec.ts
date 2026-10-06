import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screenMocks } from '../../../testing/screen-mocks';
import { PatientDirectoryApi, RecallRow } from '../patient-directory-api.service';
import { RecallsComponent, isRecallKind, reminderOutcome } from './recalls.component';

const row = (id: string, last: string, over: Partial<RecallRow> = {}): RecallRow => ({
  patientId: id, patientCode: `P-${id}`, firstName: 'Sara', lastName: last, phone: '0600000000', email: '', primaryPractitionerId: 'd1',
  primaryPractitionerName: 'Dr Idrissi', lastVisit: '2026-03-01T09:00:00Z', nextAppointment: null as unknown as string, progress: 40, remaining: 60,
  dueSince: null as unknown as string, note: '', ...over,
});

describe('recall helpers', () => {
  it('recognises only the eight kinds the server has', () => {
    expect(isRecallKind('NO_VISIT_3M')).toBe(true);
    expect(isRecallKind('NO_VISIT_9M')).toBe(false);
    expect(isRecallKind(null)).toBe(false);
  });

  it('counts the reminders that were not queued as skipped, never below zero', () => {
    expect(reminderOutcome(5, 3)).toEqual({ queued: 3, skipped: 2 });
    expect(reminderOutcome(2, 4)).toEqual({ queued: 4, skipped: 0 });
  });
});

describe('RecallsComponent', () => {
  let api: { recalls: ReturnType<typeof vi.fn>; sendRecallReminders: ReturnType<typeof vi.fn> };
  let mocks: ReturnType<typeof screenMocks>;

  const setup = (can: Parameters<typeof screenMocks>[0] = {}, kind: string | null = null) => {
    mocks = screenMocks(can);
    TestBed.configureTestingModule({
      imports: [RecallsComponent, TranslateModule.forRoot()],
      providers: [
        { provide: PatientDirectoryApi, useValue: api },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => kind } } } },
        { provide: Router, useValue: { navigate: vi.fn(async () => true) } },
        ...mocks.providers,
      ],
    });
  };
  const mount = async () => {
    const fixture = TestBed.createComponent(RecallsComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  };

  beforeEach(() => {
    api = {
      recalls: vi.fn(async () => [row('1', 'Alami'), row('2', 'Bennani', { lastVisit: null as unknown as string })]),
      sendRecallReminders: vi.fn(async () => ({ queued: 1 })),
    };
  });

  it('opens on the kind named in the link and asks the server for it', async () => {
    setup({}, 'RETENTION_DUE_6M');
    await mount();
    expect(api.recalls).toHaveBeenCalledWith('RETENTION_DUE_6M', expect.objectContaining({ excludeNeverVisited: true, sort: 'last' }));
  });

  it('ignores a kind it does not know', async () => {
    setup({}, 'SOMETHING_ELSE');
    await mount();
    expect(api.recalls.mock.calls[0][0]).toBe('NO_VISIT_6M');
  });

  it('shows a patient who never came as such, not as a missing date', async () => {
    setup();
    const fixture = await mount();
    expect(fixture.nativeElement.textContent).toContain('REC.NEVER');
  });

  it('sends reminders to the ticked patients only and reports queued and skipped', async () => {
    setup();
    const fixture = await mount();
    const boxes = fixture.nativeElement.querySelectorAll('tbody input[type=checkbox]') as NodeListOf<HTMLInputElement>;
    boxes[0].click();
    boxes[1].click();
    fixture.detectChanges();
    const send = [...(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)].find(b => b.textContent?.includes('REC.SEND'))!;
    expect(send.disabled).toBe(false);
    send.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(api.sendRecallReminders).toHaveBeenCalledWith(['1', '2']);
    expect(mocks.toasts).toHaveLength(1);
    expect(mocks.toasts[0].kind).toBe('success');
    // the selection is cleared once the reminders went out
    expect([...(fixture.nativeElement.querySelectorAll('tbody input[type=checkbox]') as NodeListOf<HTMLInputElement>)].some(b => b.checked)).toBe(false);
  });

  it('offers no send button to someone who may not message patients', async () => {
    setup({ can: ['AGENDA_VIEW'] });
    const fixture = await mount();
    const labels = [...(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>)].map(b => b.textContent);
    expect(labels.some(t => t?.includes('REC.SEND'))).toBe(false);
  });

  it('keeps the list and reports the error when the load fails', async () => {
    setup();
    api.recalls.mockRejectedValueOnce(new Error('down'));
    const fixture = await mount();
    expect(mocks.errors).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('table')).not.toBeNull();
  });
});
