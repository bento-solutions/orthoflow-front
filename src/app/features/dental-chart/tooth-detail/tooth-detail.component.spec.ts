import '@angular/compiler';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToothFinding } from '../../../core/models/clinical-record.model';
import { ClinicalRecordService } from '../../../core/services/clinical-record.service';
import { DentalChartService } from '../../../core/services/dental-chart.service';
import { expectNoA11yViolations } from '../../../testing/axe';
import { screenMocks } from '../../../testing/screen-mocks';
import { ToothDetailComponent } from './tooth-detail.component';

const finding = (over: Partial<ToothFinding>): ToothFinding => ({
  id: crypto.randomUUID(), fdi: '16', findingCode: 'caries', kind: 'CONDITION', status: 'ACTIVE', source: 'manual',
  createdAt: '2026-10-10T09:00:00Z', origin: 'THIS_CLINIC', ...over,
} as ToothFinding);

describe('ToothDetailComponent', () => {
  let records: { history: ReturnType<typeof signal<ToothFinding[]>>; loadHistory: ReturnType<typeof vi.fn>; addFinding: ReturnType<typeof vi.fn>; changeFindingStatus: ReturnType<typeof vi.fn> };
  let charts: { reloadChart: ReturnType<typeof vi.fn> };
  let mocks: ReturnType<typeof screenMocks>;

  const mount = async (fdi: string, findings: ToothFinding[]) => {
    mocks = screenMocks();
    TestBed.configureTestingModule({
      imports: [ToothDetailComponent, TranslateModule.forRoot()],
      providers: [{ provide: ClinicalRecordService, useValue: records }, { provide: DentalChartService, useValue: charts }, ...mocks.providers],
    });
    const fixture = TestBed.createComponent(ToothDetailComponent);
    fixture.componentRef.setInput('patientId', 'p1');
    fixture.componentRef.setInput('fdi', fdi);
    fixture.componentRef.setInput('findings', findings);
    document.body.appendChild(fixture.nativeElement);
    await flush(fixture);
    return fixture;
  };
  const flush = async (fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) => {
    for (let i = 0; i < 2; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise(resolve => setTimeout(resolve));
    }
  };
  const choose = (value: string) => {
    const select = document.querySelector('select') as HTMLSelectElement;
    select.value = value;
    select.dispatchEvent(new Event('change'));
  };
  const button = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.includes(text)) as HTMLButtonElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    records = {
      history: signal<ToothFinding[]>([]),
      loadHistory: vi.fn(),
      addFinding: vi.fn(() => of({})),
      changeFindingStatus: vi.fn(() => of({})),
    };
    charts = { reloadChart: vi.fn() };
  });

  it('shows every state the tooth carries, each with its surface and where the work was done', async () => {
    await mount('16', [
      finding({ findingCode: 'caries', surface: 'distal' }),
      finding({ findingCode: 'existing_amalgam', kind: 'EXISTING', surface: 'occlusal', origin: 'EXTERNAL', providerName: 'Dr Benani', performedOn: '2019-04-02' }),
      finding({ fdi: '26', findingCode: 'existing_crown', kind: 'EXISTING' }),
    ]);

    const rows = [...document.querySelectorAll('.finding:not(.past)')].map(r => r.textContent!.replace(/\s+/g, ' '));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('Caries');
    expect(rows[0]).toContain('D');
    expect(rows[1]).toContain('Existing amalgam');
    expect(rows[1]).toContain('O');
    expect(rows[1]).toContain('TOOTH_DETAIL.ELSEWHERE');
    expect(rows[1]).toContain('Dr Benani');
  });

  it('asks where on the tooth only for findings that are about a part of it', async () => {
    const fixture = await mount('16', []);

    choose('caries');
    await flush(fixture);
    expect(document.querySelector('app-surface-picker')).not.toBeNull();

    choose('existing_crown');
    await flush(fixture);
    expect(document.querySelector('app-surface-picker')).toBeNull();
  });

  it('records caries on the mesial surface of an upper right molar by tapping the side toward the midline', async () => {
    const fixture = await mount('16', []);

    choose('caries');
    await flush(fixture);
    const zones = [...document.querySelectorAll('app-surface-picker .zone')] as SVGPathElement[];
    expect(zones).toHaveLength(5);
    // top, left, centre, right, bottom: for tooth 16 the midline is on the right.
    zones[3].dispatchEvent(new Event('click'));
    await flush(fixture);
    button('TOOTH_DETAIL.ADD_BUTTON').click();
    await flush(fixture);

    expect(records.addFinding).toHaveBeenCalledWith('p1', '16', { findingCode: 'caries', source: 'manual', surface: 'mesial' });
    expect(charts.reloadChart).toHaveBeenCalledWith('p1');
  });

  it('puts mesial on the left for a tooth of the other side of the mouth', async () => {
    const fixture = await mount('26', []);

    choose('caries');
    await flush(fixture);
    ([...document.querySelectorAll('app-surface-picker .zone')][1] as SVGPathElement).dispatchEvent(new Event('click'));
    await flush(fixture);
    button('TOOTH_DETAIL.ADD_BUTTON').click();
    await flush(fixture);

    expect(records.addFinding.mock.calls[0][2]).toMatchObject({ surface: 'mesial' });
  });

  it('keeps work done elsewhere as such, with who and when', async () => {
    const fixture = await mount('16', []);

    choose('existing_amalgam');
    await flush(fixture);
    button('TOOTH_DETAIL.ELSEWHERE').click();
    await flush(fixture);
    const provider = document.querySelector('input[type=text]') as HTMLInputElement;
    provider.value = 'Dr Benani, Casablanca';
    provider.dispatchEvent(new Event('input'));
    const date = document.querySelector('input[type=date]') as HTMLInputElement;
    date.value = '2019-04-02';
    date.dispatchEvent(new Event('input'));
    await flush(fixture);
    button('TOOTH_DETAIL.ADD_BUTTON').click();
    await flush(fixture);

    expect(records.addFinding).toHaveBeenCalledWith('p1', '16', {
      findingCode: 'existing_amalgam', source: 'manual', origin: 'EXTERNAL', providerName: 'Dr Benani, Casablanca', performedOn: '2019-04-02',
    });
  });

  it('cannot add before something is chosen', async () => {
    await mount('16', []);
    expect(button('TOOTH_DETAIL.ADD_BUTTON').disabled).toBe(true);
  });

  it('marks a state treated, or withdraws it as a mistake, and refreshes the chart either way', async () => {
    const caries = finding({ findingCode: 'caries', surface: 'mesial' });
    const fixture = await mount('16', [caries]);

    button('TOOTH_DETAIL.MARK_TREATED').click();
    await flush(fixture);
    expect(records.changeFindingStatus).toHaveBeenCalledWith('p1', caries.id, 'RESOLVED');

    button('TOOTH_DETAIL.REMOVE').click();
    await flush(fixture);
    expect(records.changeFindingStatus).toHaveBeenCalledWith('p1', caries.id, 'RETRACTED');
    expect(charts.reloadChart).toHaveBeenCalledTimes(2);
  });

  it('lists what was treated on this tooth', async () => {
    records.history.set([
      finding({ findingCode: 'caries', status: 'RESOLVED', updatedAt: '2025-02-03T10:00:00Z' } as Partial<ToothFinding>),
      finding({ fdi: '26', findingCode: 'caries', status: 'RESOLVED' }),
    ]);
    await mount('16', []);

    expect(document.querySelectorAll('.finding.past')).toHaveLength(1);
  });

  it('tells the doctor when a change could not be saved', async () => {
    records.addFinding.mockReturnValue(new (await import('rxjs')).Observable(sub => sub.error(new Error('down'))));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fixture = await mount('16', []);

    choose('caries');
    await flush(fixture);
    button('TOOTH_DETAIL.ADD_BUTTON').click();
    await flush(fixture);

    expect(mocks.toasts.map(t => t.kind)).toEqual(['error']);
    expect(button('TOOTH_DETAIL.ADD_BUTTON').disabled).toBe(false);
  });

  it('has no accessibility violations', async () => {
    await mount('16', [finding({ surface: 'distal' })]);
    choose('caries');
    await expectNoA11yViolations(document.body);
  });
});
