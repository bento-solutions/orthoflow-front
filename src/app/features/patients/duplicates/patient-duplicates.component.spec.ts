import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screenMocks } from '../../../testing/screen-mocks';
import { DuplicatePair, MergePreview, PatientDirectoryApi } from '../patient-directory-api.service';
import { PatientDuplicatesComponent, defaultChoices, isBlank, preferSourceFields } from './patient-duplicates.component';

const person = (id: string, firstName: string, lastName: string) => ({
  id, patientCode: `P-${id}`, firstName, lastName, dateOfBirth: '1990-01-01', phone: '0600000000', cin: 'AB123', email: `${id}@x.ma`, createdAt: '2026-01-01T09:00:00Z',
});

const pair: DuplicatePair = { first: person('a', 'Sara', 'Alami'), second: person('b', 'Sarah', 'Alami'), reason: 'CIN', score: 1 };

const preview = (over: Partial<MergePreview> = {}): MergePreview => ({
  sourceId: 'b', targetId: 'a', recordsToMove: { appointments: 3, invoices: 1 }, bothHaveDentalCharts: false,
  fieldDifferences: { phone: ['0611111111', '0622222222'], address: [null as unknown as string, '12 rue des Fleurs'] }, ...over,
});

describe('merge choices', () => {
  it('treats absent and whitespace-only values as blank', () => {
    expect(isBlank(null)).toBe(true);
    expect(isBlank('  ')).toBe(true);
    expect(isBlank('0600')).toBe(false);
  });

  it('keeps the kept record\'s value, and fills a gap from the other one', () => {
    expect(defaultChoices({ phone: ['0611', '0622'], address: [null as unknown as string, 'rue X'] })).toEqual({ phone: 'TARGET', address: 'SOURCE' });
  });

  it('asks the server to prefer the other record only where the kept one has a value that was replaced', () => {
    const differences = { phone: ['0611', '0622'], address: ['', 'rue X'], email: ['a@x.ma', 'b@x.ma'] };
    // address is filled by the server whatever is asked, so it is not sent as a preference
    expect(preferSourceFields({ phone: 'SOURCE', address: 'SOURCE', email: 'TARGET' }, differences)).toEqual(['phone']);
  });
});

describe('PatientDuplicatesComponent', () => {
  let api: { duplicates: ReturnType<typeof vi.fn>; mergePreview: ReturnType<typeof vi.fn>; merge: ReturnType<typeof vi.fn>; insurers: ReturnType<typeof vi.fn> };
  let mocks: ReturnType<typeof screenMocks>;

  const mount = async () => {
    const fixture = TestBed.createComponent(PatientDuplicatesComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  };
  const click = async (fixture: { detectChanges(): void; whenStable(): Promise<unknown> }, el: Element | null) => {
    (el as HTMLElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(() => {
    api = {
      duplicates: vi.fn(async () => [pair]),
      mergePreview: vi.fn(async () => preview()),
      merge: vi.fn(async () => ({ targetId: 'a', sourceId: 'b', moved: { appointments: 3 } })),
      insurers: vi.fn(async () => []),
    };
    mocks = screenMocks();
    TestBed.configureTestingModule({
      imports: [PatientDuplicatesComponent, TranslateModule.forRoot()],
      providers: [provideRouter([]), { provide: PatientDirectoryApi, useValue: api }, ...mocks.providers],
    });
  });

  it('shows each pair with the reason it was flagged', async () => {
    const fixture = await mount();
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('PAT.DUP.REASONS.CIN');
    expect(text).toContain('Sara Alami');
    expect(text).toContain('Sarah Alami');
  });

  it('says so when there is nothing to merge', async () => {
    api.duplicates.mockResolvedValue([]);
    const fixture = await mount();
    expect(fixture.nativeElement.textContent).toContain('PAT.DUP.EMPTY_TITLE');
  });

  it('keeps the merge button locked until the permanent change is acknowledged', async () => {
    const fixture = await mount();
    await click(fixture, fixture.nativeElement.querySelector('article button'));
    const submit = () => [...document.querySelectorAll('button.btn-danger')].find(b => b.textContent?.includes('PAT.DUP.MERGE.SUBMIT')) as HTMLButtonElement;
    expect(api.mergePreview).toHaveBeenCalledWith('a', 'b');
    expect(submit().disabled).toBe(true);

    await click(fixture, document.querySelector('[role=dialog] input[type=checkbox]'));
    expect(submit().disabled).toBe(false);
  });

  it('sends the chosen side for each field and merges into the kept patient', async () => {
    const fixture = await mount();
    await click(fixture, fixture.nativeElement.querySelector('article button'));

    const phoneSource = document.querySelector('input[name="pick-phone"]:not(:checked)') as HTMLInputElement;
    await click(fixture, phoneSource);
    await click(fixture, document.querySelector('[role=dialog] input[type=checkbox]'));
    await click(fixture, [...document.querySelectorAll('button.btn-danger')].find(b => b.textContent?.includes('SUBMIT')) ?? null);

    expect(api.merge).toHaveBeenCalledWith('a', { sourceId: 'b', dentalChartFrom: undefined, preferSourceFields: ['phone'] });
    expect(mocks.toasts.map(t => t.kind)).toEqual(['success']);
    expect(api.duplicates).toHaveBeenCalledTimes(2);
  });

  it('asks which dental chart to keep when both patients have one', async () => {
    api.mergePreview.mockResolvedValue(preview({ bothHaveDentalCharts: true }));
    const fixture = await mount();
    await click(fixture, fixture.nativeElement.querySelector('article button'));
    expect(document.body.textContent).toContain('PAT.DUP.MERGE.CHARTS_HINT');

    await click(fixture, document.querySelector('input[name="chart"]:not(:checked)'));
    await click(fixture, document.querySelector('[role=dialog] input[type=checkbox]'));
    await click(fixture, [...document.querySelectorAll('button.btn-danger')].find(b => b.textContent?.includes('SUBMIT')) ?? null);
    expect(api.merge.mock.calls[0][1].dentalChartFrom).toBe('SOURCE');
  });

  it('reports a failed merge and leaves the dialog open', async () => {
    api.merge.mockRejectedValue(new Error('conflict'));
    const fixture = await mount();
    await click(fixture, fixture.nativeElement.querySelector('article button'));
    await click(fixture, document.querySelector('[role=dialog] input[type=checkbox]'));
    await click(fixture, [...document.querySelectorAll('button.btn-danger')].find(b => b.textContent?.includes('SUBMIT')) ?? null);
    expect(mocks.errors).toHaveLength(1);
    expect(document.querySelector('[role=dialog]')).not.toBeNull();
  });
});
