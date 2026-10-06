import '@angular/compiler';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsApi } from '../../core/services/analytics-api.service';
import { LanguageService } from '../../core/services/language.service';
import { PermissionService } from '../../core/services/permission.service';
import { PracticeProfileService } from '../../core/services/practice-profile.service';
import { screenMocks } from '../../testing/screen-mocks';
import { ANALYTICS_TABS } from './analytics-tabs';
import { DoctorTimeComponent, usableShare } from './doctor-time.component';
import { BLANK_INPUTS, GoalsComponent, barWidth } from './goals.component';
import { IncomeStatementComponent, amountsOf, rowClass } from './income-statement.component';
import { ProceduresComponent, marginPercent } from './procedures.component';

describe('analytics helpers', () => {
  it('works out a margin as a share of revenue without dividing by zero', () => {
    expect(marginPercent(1000, 250)).toBe(25);
    expect(marginPercent(300, 100)).toBe(33.3);
    expect(marginPercent(0, 0)).toBe(0);
  });

  it('says how much of the time data was usable, and treats no data as fine', () => {
    expect(usableShare({ considered: 40, valid: 30 })).toBe(75);
    expect(usableShare({ considered: 0, valid: 0 })).toBe(100);
  });

  it('keeps a progress bar inside its track', () => {
    expect(barWidth(45)).toBe(45);
    expect(barWidth(180)).toBe(100);
    expect(barWidth(-5)).toBe(0);
  });

  it('styles each kind of statement row, and gives a heading no figures', () => {
    expect(rowClass({ kind: 'RESULT' })).toContain('font-extrabold');
    expect(rowClass({ kind: 'HEADING' })).toContain('font-bold');
    expect(amountsOf({ amounts: null })).toEqual([]);
    expect(amountsOf({ amounts: [1, 2] })).toEqual([1, 2]);
  });

  it('puts each report behind the permission its figures need', () => {
    const need = Object.fromEntries(ANALYTICS_TABS.map(t => [t.path, t.permission]));
    expect(need['procedures']).toEqual(['ANALYTICS_VIEW']);
    expect(need['time']).toEqual(['ANALYTICS_VIEW']);
    expect(need['income']).toEqual(['FINANCE_VIEW']);
    expect(need['goals']).toEqual(['FINANCE_VIEW']);
  });
});

describe('analytics screens', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;
  let mocks: ReturnType<typeof screenMocks>;

  const setup = (can: Parameters<typeof screenMocks>[0] = {}) => {
    mocks = screenMocks({ ...can, practitioners: [{ id: 'd1', displayName: 'Dr Tazi' }] });
    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot()],
      providers: [
        { provide: AnalyticsApi, useValue: api },
        { provide: LanguageService, useValue: { currentLang: () => 'fr' } },
        { provide: PracticeProfileService, useValue: { currency: signal('MAD') } },
        ...mocks.providers,
      ],
    });
  };
  const settleUi = async (fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) => {
    for (let i = 0; i < 2; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise(resolve => setTimeout(resolve));
    }
    fixture.detectChanges();
  };
  const mount = async <T>(type: new () => T) => {
    const fixture = TestBed.createComponent(type);
    document.body.appendChild(fixture.nativeElement);
    await settleUi(fixture);
    await settleUi(fixture);
    return fixture;
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    api = {};
  });

  it('procedures: asks only for finalised sessions by default and lists margins', async () => {
    api['procedures'] = vi.fn(async () => ({
      from: '2026-07-01', to: '2026-09-30',
      rows: [{ treatmentId: 't1', treatmentName: 'Collage attache', category: 'Ortho', practitionerId: 'd1', practitionerName: 'Dr Tazi', status: 'FINALIZED', sessions: 10, revenue: 5000, materialCost: 800, grossMargin: 4200, marginPercent: 84 }],
      total: { key: 'all', label: 'Total', sessions: 10, revenue: 5000, materialCost: 800, grossMargin: 4200 },
      byCategory: [{ key: 'Ortho', label: 'Ortho', sessions: 10, revenue: 5000, materialCost: 800, grossMargin: 4200 }], byPractitioner: [{ key: 'd1', label: 'Dr Tazi', sessions: 10, revenue: 5000, materialCost: 800, grossMargin: 4200 }],
    }));
    setup();
    const fixture = await mount(ProceduresComponent);
    expect(api['procedures']).toHaveBeenCalledWith(expect.objectContaining({ status: ['FINALIZED'] }));
    expect(document.body.textContent).toContain('Collage attache');
    (document.querySelectorAll('fieldset input[type=checkbox]')[1] as HTMLInputElement).click();
    await settleUi(fixture);
    expect(api['procedures']).toHaveBeenLastCalledWith(expect.objectContaining({ status: ['FINALIZED', 'DRAFT'] }));
  });

  it('doctor time: shows the data-quality counts next to the figures', async () => {
    api['doctorTime'] = vi.fn(async () => ({
      from: '2026-09-01', to: '2026-09-30', minMinutes: 5, maxMinutes: 240,
      byPractitioner: [{ practitionerId: 'd1', practitionerName: 'Dr Tazi', appointmentType: '', appointments: 12, activeMinutes: 360, averageMinutes: 30, medianMinutes: 28, plannedAverageMinutes: 25, averageWaitMinutes: 7 }],
      byProcedure: [],
      quality: { considered: 20, valid: 12, missingEnd: 5, missingStart: 1, tooShort: 1, tooLong: 0, invalidOrder: 1, completedWithoutTimes: 0, issues: [] },
    }));
    setup();
    await mount(DoctorTimeComponent);
    const text = document.body.textContent!;
    expect(text).toContain('Dr Tazi');
    expect(text).toContain('ANA.TIME.USABLE');
    expect(text).toContain('ANA.TIME.ISSUES.missingEnd');
  });

  it('income statement: renders headings without figures and sends the language and basis', async () => {
    api['incomeStatement'] = vi.fn(async () => ({
      from: '2026-01-01', to: '2026-12-31', group: 'MONTH', basis: 'COLLECTED', includeRetrocessions: true, notes: ['Honoraires encaissés'],
      periods: [{ key: '2026-09', label: '2026-09', from: '2026-09-01', to: '2026-09-30' }, { key: '2026-10', label: '2026-10', from: '2026-10-01', to: '2026-10-31' }],
      rows: [
        { code: 'I', label: 'I. PRODUITS', kind: 'HEADING', level: 0, amounts: null, total: null },
        { code: 'fees', label: 'Honoraires', kind: 'LINE', level: 1, amounts: [1000, 2000], total: 3000 },
        { code: 'RES', label: 'RÉSULTAT', kind: 'RESULT', level: 0, amounts: [400, 900], total: 1300 },
      ],
    }));
    setup();
    await mount(IncomeStatementComponent);
    expect(api['incomeStatement']).toHaveBeenCalledWith(expect.objectContaining({ group: 'MONTH', basis: 'COLLECTED', includeRetrocessions: true, lang: 'fr' }));
    const rows = [...document.querySelectorAll('tbody tr')];
    expect(rows).toHaveLength(3);
    expect(rows[0].querySelectorAll('td.cell-num')).toHaveLength(0);
    expect(rows[1].textContent!.replace(/\s/g, '')).toContain('3000,00MAD');
    expect(document.body.textContent).toContain('Honoraires encaissés');
  });

  describe('goals', () => {
    beforeEach(() => {
      api['goalSuggestions'] = vi.fn(async () => ({ fixedCosts: 18000, variableCostPercent: 20, workingDaysPerMonth: 24, basedOnFrom: '2026-07-01', basedOnTo: '2026-09-30' }));
      api['goalTracking'] = vi.fn(async () => ({ year: 2026, basis: 'COLLECTED', inputs: null, monthlyTarget: 0, months: [], yearTarget: 0, yearActual: 0, yearToDateTarget: 0, yearToDateActual: 0, saved: false }));
      api['goalPlan'] = vi.fn(async (i: { fixedCosts: number; personalNeeds: number }) => ({ inputs: i, breakEvenMonthly: i.fixedCosts, monthlyTarget: i.fixedCosts + i.personalNeeds, dailyTarget: 1000, yearlyTarget: (i.fixedCosts + i.personalNeeds) * 12 }));
      api['saveGoal'] = vi.fn(async (year: number, body: { inputs: unknown }) => ({ year, basis: 'COLLECTED', inputs: body.inputs, monthlyTarget: 30000, months: [{ month: 10, target: 30000, actual: 12000, progressPercent: 40, variance: -18000, projected: 28000 }], yearTarget: 360000, yearActual: 12000, yearToDateTarget: 30000, yearToDateActual: 12000, saved: true }));
    });

    it('fills the wizard from the practice\'s own figures, then follows the numbers with a plan', async () => {
      setup();
      const fixture = await mount(GoalsComponent);
      [...document.querySelectorAll('button')].find(b => b.textContent?.includes('ANA.GOALS.USE_SUGGESTIONS'))!.click();
      await settleUi(fixture);
      // the plan is asked for a moment after the numbers stop changing
      await new Promise(resolve => setTimeout(resolve, 320));
      await settleUi(fixture);
      expect(api['goalPlan']).toHaveBeenLastCalledWith({ ...BLANK_INPUTS, fixedCosts: 18000, variableCostPercent: 20, workingDaysPerMonth: 24 });
      expect(document.body.textContent!.replace(/\s/g, '')).toContain('18000,00MAD');
    });

    it('saves the goal and then shows the month by month tracking', async () => {
      setup();
      const fixture = await mount(GoalsComponent);
      expect(document.body.textContent).toContain('ANA.GOALS.NOT_SAVED');
      (document.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      await settleUi(fixture);
      expect(api['saveGoal']).toHaveBeenCalledWith(new Date().getFullYear(), { inputs: BLANK_INPUTS });
      expect(document.body.textContent).toContain('ANA.GOALS.TRACKING');
      expect(mocks.toasts.map(t => t.kind)).toEqual(['success']);
    });

    it('reopens the wizard on the numbers that were saved', async () => {
      api['goalTracking'].mockResolvedValue({ year: 2026, basis: 'COLLECTED', inputs: { fixedCosts: 20000, personalNeeds: 15000, variableCostPercent: 25, workingDaysPerMonth: 22 }, monthlyTarget: 46000, months: [], yearTarget: 0, yearActual: 0, yearToDateTarget: 0, yearToDateActual: 0, saved: true });
      setup();
      await mount(GoalsComponent);
      expect((document.querySelector('input[name=fixed]') as HTMLInputElement).value).toBe('20000');
      expect((document.querySelector('input[name=personal]') as HTMLInputElement).value).toBe('15000');
    });

    it('is read-only for someone who may only see finance', async () => {
      setup({ can: ['FINANCE_VIEW'] });
      await mount(GoalsComponent);
      expect(document.querySelector('form button[type=submit]')).toBeNull();
      expect((document.querySelector('input[name=fixed]') as HTMLInputElement).matches(':disabled')).toBe(true);
    });
  });
});
