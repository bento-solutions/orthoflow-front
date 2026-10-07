import '@angular/compiler';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsApi } from '../../core/services/analytics-api.service';
import { FinanceApi } from '../../core/services/finance-api.service';
import { LanguageService } from '../../core/services/language.service';
import { PracticeProfileService } from '../../core/services/practice-profile.service';
import { screenMocks } from '../../testing/screen-mocks';
import { ANALYTICS_TABS } from './analytics-tabs';
import { TaxSimulationComponent, bandProblem, bandsToSend } from './tax-simulation.component';

describe('tax schedule helpers', () => {
  it('sends the last band as open-ended whatever was typed in it, and rates as numbers', () => {
    expect(bandsToSend([{ upTo: 10000, ratePercent: 0 }, { upTo: 99999, ratePercent: '12.5' as unknown as number }]))
      .toEqual([{ upTo: 10000, ratePercent: 0 }, { upTo: undefined, ratePercent: 12.5 }]);
  });

  it('names the first thing wrong with the bands', () => {
    expect(bandProblem([])).toBe('EMPTY');
    expect(bandProblem([{ upTo: null, ratePercent: 10 }])).toBeNull();
    expect(bandProblem([{ upTo: 20000, ratePercent: 10 }, { upTo: 10000, ratePercent: 20 }, { upTo: null, ratePercent: 30 }])).toBe('ORDER');
    expect(bandProblem([{ upTo: null, ratePercent: 10 }, { upTo: null, ratePercent: 20 }])).toBe('ORDER');
    expect(bandProblem([{ upTo: 10000, ratePercent: 10 }, { upTo: null, ratePercent: 101 }])).toBe('RATE');
    expect(bandProblem([{ upTo: 10000, ratePercent: -1 }, { upTo: null, ratePercent: 5 }])).toBe('RATE');
  });

  it('shows the simulator to those who may see finance', () => {
    expect(ANALYTICS_TABS.find(t => t.path === 'tax')?.permission).toEqual(['FINANCE_VIEW']);
  });
});

describe('TaxSimulationComponent', () => {
  const YEAR = new Date().getFullYear();
  // Invented figures, not any year's real schedule.
  const configured = { year: YEAR, configured: true, source: 'Invented, for a test', dependentDeduction: 100, maxDependents: 2,
    brackets: [{ upTo: 10000, ratePercent: 0 }, { upTo: 20000, ratePercent: 10 }, { ratePercent: 20 }] };
  const none = { year: YEAR, configured: false, brackets: [], dependentDeduction: 0, maxDependents: 0 };
  const simulation = { year: YEAR, source: 'Invented, for a test', taxableIncome: 30000, dependents: 0, grossTax: 3000, dependentRelief: 0, tax: 3000,
    effectiveRatePercent: 10, incomeAfterTax: 27000,
    bands: [{ from: 0, upTo: 10000, ratePercent: 0, amountInBand: 10000, tax: 0 }, { from: 10000, upTo: 20000, ratePercent: 10, amountInBand: 10000, tax: 1000 }, { from: 20000, ratePercent: 20, amountInBand: 10000, tax: 2000 }] };

  let api: Record<string, ReturnType<typeof vi.fn>>;
  let finance: Record<string, ReturnType<typeof vi.fn>>;
  let mocks: ReturnType<typeof screenMocks>;

  const setup = (schedule: unknown, can: Parameters<typeof screenMocks>[0] = {}) => {
    api = {
      taxSchedule: vi.fn(async () => schedule),
      saveTaxSchedule: vi.fn(async () => configured),
      taxSimulation: vi.fn(async () => simulation),
    };
    finance = { dashboard: vi.fn(async () => ({ result: 41234.567 })) };
    mocks = screenMocks(can);
    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot()],
      providers: [
        { provide: AnalyticsApi, useValue: api },
        { provide: FinanceApi, useValue: finance },
        { provide: LanguageService, useValue: { currentLang: () => 'fr' } },
        { provide: PracticeProfileService, useValue: { currency: signal('MAD') } },
        ...mocks.providers,
      ],
    });
  };
  const settle = async (fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) => {
    for (let i = 0; i < 2; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise(resolve => setTimeout(resolve));
    }
    fixture.detectChanges();
  };
  const mount = async () => {
    const fixture = TestBed.createComponent(TaxSimulationComponent);
    document.body.appendChild(fixture.nativeElement);
    await settle(fixture);
    await settle(fixture);
    return fixture;
  };
  const type = (selector: string, value: string) => {
    const input = document.querySelector(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('says that nothing is built in, and opens on the form when no schedule has been entered', async () => {
    setup(none);
    await mount();

    expect(document.body.textContent).toContain('ANA.TAX.DISCLAIMER');
    expect(document.body.textContent).toContain('ANA.TAX.NO_RATES_BUILT_IN');
    expect(document.querySelector('input[name=source]')).not.toBeNull();
    expect(document.body.textContent).toContain('ANA.TAX.ENTER_FIRST');
  });

  it('will not save without a source, and sends the schedule as typed once it has one', async () => {
    setup(none);
    const fixture = await mount();
    const save = () => document.querySelector('form button[type=submit]') as HTMLButtonElement;
    expect(save().disabled).toBe(true);

    type('input[name=source]', '  Loi de finances, article 73  ');
    type('input[name=upTo0]', '10000');
    await settle(fixture);
    // one band only so far, and it is the open one: add a band above, then give both a rate
    (document.querySelectorAll('button[type=button]') as NodeListOf<HTMLButtonElement>).forEach(b => { if (b.textContent?.includes('ANA.TAX.ADD_BAND')) b.click(); });
    await settle(fixture);
    type('input[name=upTo0]', '10000');
    type('input[name=rate0]', '0');
    type('input[name=rate1]', '15');
    type('input[name=deduction]', '100');
    type('input[name=maxDependents]', '2');
    await settle(fixture);
    expect(save().disabled).toBe(false);

    (document.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle(fixture);

    expect(api['saveTaxSchedule']).toHaveBeenCalledWith(YEAR, {
      source: 'Loi de finances, article 73',
      brackets: [{ upTo: 10000, ratePercent: 0 }, { upTo: undefined, ratePercent: 15 }],
      dependentDeduction: 100,
      maxDependents: 2,
    });
    expect(mocks.toasts.map(t => t.kind)).toEqual(['success']);
  });

  it('refuses bands that do not climb', async () => {
    setup(none);
    const fixture = await mount();
    type('input[name=source]', 'x');
    (document.querySelectorAll('button[type=button]') as NodeListOf<HTMLButtonElement>).forEach(b => { if (b.textContent?.includes('ANA.TAX.ADD_BAND')) b.click(); });
    (document.querySelectorAll('button[type=button]') as NodeListOf<HTMLButtonElement>).forEach(b => { if (b.textContent?.includes('ANA.TAX.ADD_BAND')) b.click(); });
    await settle(fixture);
    type('input[name=upTo0]', '20000');
    type('input[name=upTo1]', '10000');
    await settle(fixture);

    expect(document.body.textContent).toContain('ANA.TAX.PROBLEM.ORDER');
    expect((document.querySelector('form button[type=submit]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows a saved schedule with its source, and edits it only for someone who may manage finance', async () => {
    setup(configured);
    await mount();
    expect(document.body.textContent).toContain('Invented, for a test');
    expect(document.querySelector('form')).toBeNull();
    expect([...document.querySelectorAll('button')].some(b => b.textContent?.includes('COMMON.EDIT'))).toBe(true);

    document.body.innerHTML = '';
    TestBed.resetTestingModule();
    setup(configured, { can: ['FINANCE_VIEW'] });
    await mount();
    expect(document.body.textContent).toContain('Invented, for a test');
    expect([...document.querySelectorAll('button')].some(b => b.textContent?.includes('COMMON.EDIT'))).toBe(false);
  });

  it('only says no schedule has been entered to someone who cannot enter one', async () => {
    setup(none, { can: ['FINANCE_VIEW'] });
    await mount();

    expect(document.querySelector('form')).toBeNull();
    expect(document.body.textContent).toContain('ANA.TAX.NOT_ENTERED');
  });

  it('simulates a moment after the income is typed and shows the source beside the result', async () => {
    setup(configured);
    const fixture = await mount();
    expect(api['taxSimulation']).not.toHaveBeenCalled();

    type('input[name=income]', '30000');
    await new Promise(resolve => setTimeout(resolve, 320));
    await settle(fixture);

    expect(api['taxSimulation']).toHaveBeenLastCalledWith(YEAR, 30000, 0);
    const text = document.body.textContent!.replace(/\s/g, '');
    expect(text).toContain('3000,00MAD');
    expect(text).toContain('27000,00MAD');
    expect(document.body.textContent).toContain('ANA.TAX.DISCLAIMER_SHORT');
    expect(document.body.textContent).toContain('Invented, for a test');
  });

  it('starts from the practice\'s result for the year, rounded to the centime, and leaves it editable', async () => {
    setup(configured);
    const fixture = await mount();

    (([...document.querySelectorAll('button')].find(b => b.textContent?.includes('ANA.TAX.START_FROM_RESULT'))) as HTMLButtonElement).click();
    await settle(fixture);

    expect(finance['dashboard']).toHaveBeenCalledWith(`${YEAR}-01-01`, `${YEAR}-12-31`);
    expect((document.querySelector('input[name=income]') as HTMLInputElement).value).toBe('41234.57');
  });
});
