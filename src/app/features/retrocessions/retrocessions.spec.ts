import '@angular/compiler';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsApi, RetroRule, RetroSimulation, Statement, StatementSummary } from '../../core/services/analytics-api.service';
import { ConfirmDialogService } from '../../core/services/confirm-dialog.service';
import { DownloadService } from '../../core/services/download.service';
import { LanguageService } from '../../core/services/language.service';
import { PracticeProfileService } from '../../core/services/practice-profile.service';
import { screenMocks } from '../../testing/screen-mocks';
import { RetroAdvancesComponent } from './retro-advances.component';
import { RetroRulesComponent, blankRule, overridesMap, ruleProblem, ruleRequest } from './retro-rules.component';
import { RetroSimulationComponent, toggled } from './retro-simulation.component';
import { RetroStatementsComponent, remaining, statementTone } from './retro-statements.component';

const figures = (over: Record<string, unknown> = {}) => ({
  practitionerId: 'd1', practitionerName: 'Dr Tazi', base: 10000, labDeduction: 1000, variable: 2700, fixed: 0, adjustment: 0, gross: 2700, advancesOutstanding: 500, advancesApplied: 500,
  net: 2200, settlements: [], lines: [{ kind: 'ITEM', date: '2026-09-10', invoiceId: 'i1', invoiceNumber: 'FA-1', patientCode: 'P-1', category: 'Ortho', label: 'Activation', base: 1500, ratePercent: 30, amount: 450 }], ...over,
});
const simulation = (over: Partial<RetroSimulation> = {}): RetroSimulation => ({
  from: '2026-09-01', to: '2026-09-30', filters: { methods: [], statuses: [] }, practitioners: [figures() as never], totalGross: 2700, totalNet: 2200,
  unattributed: { amount: 800, invoiceCount: 1, invoices: [{ invoiceId: 'u1', invoiceNumber: 'FA-9', date: '2026-09-12', amount: 800 }] }, ...over,
});
const statement = (over: Partial<Statement> = {}): Statement => ({
  id: 's1', number: 'RT-2026-001', practitionerId: 'd1', practitionerName: 'Dr Tazi', from: '2026-09-01', to: '2026-09-30', base: 10000, labDeduction: 1000, variable: 2700, fixed: 0, adjustment: 0,
  gross: 2700, advancesDeducted: 500, net: 2200, paid: 0, status: 'UNPAID', filters: { methods: [], statuses: [] }, notes: '', validatedAt: '2026-10-01T09:00:00Z', voidedAt: '' as never, voidReason: '',
  lines: [], settlements: [], payouts: [], ...over,
});

describe('retrocession helpers', () => {
  it('toggles a choice and keeps the list in its fixed order', () => {
    const all = ['CASH', 'CARD', 'CHEQUE'] as const;
    expect(toggled([], 'CHEQUE', all)).toEqual(['CHEQUE']);
    expect(toggled(['CHEQUE'], 'CASH', all)).toEqual(['CASH', 'CHEQUE']);
    expect(toggled(['CASH', 'CHEQUE'], 'CASH', all)).toEqual(['CHEQUE']);
  });

  it('colours a statement by how paid it is', () => {
    expect(statementTone('UNPAID')).toBe('pill-attention');
    expect(statementTone('PAID')).toBe('pill-done');
    expect(statementTone('VOID')).toBe('pill-idle');
  });

  it('works out what is still owed on a statement, never below zero, nothing on a void one', () => {
    expect(remaining({ net: 2200, paid: 700, status: 'PARTIAL' })).toBe(1500);
    expect(remaining({ net: 100.1, paid: 0.2, status: 'PARTIAL' })).toBe(99.9);
    expect(remaining({ net: 100, paid: 150, status: 'PAID' })).toBe(0);
    expect(remaining({ net: 2200, paid: 0, status: 'VOID' })).toBe(0);
  });

  it('turns override rows into the map the server takes, skipping blanks and keeping the last rate for a repeat', () => {
    expect(overridesMap([{ category: ' Implants ', rate: 40 }, { category: '', rate: 10 }, { category: 'Implants', rate: 45 }])).toEqual({ Implants: 45 });
  });

  it('says what is wrong with a rule before it is sent', () => {
    const ok = { ...blankRule(), practitionerId: 'd1', ratePercent: 30 };
    expect(ruleProblem(ok)).toBeNull();
    expect(ruleProblem({ ...ok, practitionerId: '' })).toBe('RETRO.RULES.PROBLEM.DOCTOR');
    expect(ruleProblem({ ...ok, effectiveFrom: '' })).toBe('RETRO.RULES.PROBLEM.START');
    expect(ruleProblem({ ...ok, ratePercent: 120 })).toBe('RETRO.RULES.PROBLEM.RATE');
    expect(ruleProblem({ ...ok, effectiveTo: '2000-01-01' })).toBe('RETRO.RULES.PROBLEM.END');
    expect(ruleProblem({ ...ok, overrides: [{ category: 'X', rate: -1 }] })).toBe('RETRO.RULES.PROBLEM.OVERRIDE');
  });

  it('builds the rule request without blanks', () => {
    const request = ruleRequest({ ...blankRule(), practitionerId: 'd1', ratePercent: 30, fixedMonthlyAmount: 0, effectiveTo: '', notes: ' ', overrides: [{ category: 'Ortho', rate: 35 }] });
    expect(request).toMatchObject({ practitionerId: 'd1', basis: 'COLLECTED', ratePercent: 30, fixedMonthlyAmount: undefined, effectiveTo: undefined, notes: undefined, overrides: { Ortho: 35 } });
  });
});

describe('retrocession screens', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;
  let mocks: ReturnType<typeof screenMocks>;
  let confirmAnswer = true;

  const setup = (component: unknown, can: Parameters<typeof screenMocks>[0] = {}) => {
    mocks = screenMocks({ ...can, practitioners: [{ id: 'd1', displayName: 'Dr Tazi' }] });
    TestBed.configureTestingModule({
      imports: [component as never, TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        { provide: AnalyticsApi, useValue: api },
        { provide: ConfirmDialogService, useValue: { confirm: async () => confirmAnswer } },
        { provide: LanguageService, useValue: { currentLang: () => 'fr' } },
        { provide: PracticeProfileService, useValue: { currency: signal('MAD') } },
        { provide: DownloadService, useValue: { open: vi.fn(async () => undefined), download: vi.fn(async () => undefined) } },
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
  const buttonWith = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.includes(text)) as HTMLButtonElement | undefined;
  const type = (el: Element | null, value: string) => {
    (el as HTMLInputElement).value = value;
    el!.dispatchEvent(new Event('input', { bubbles: true }));
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    confirmAnswer = true;
    api = {};
  });

  describe('simulation', () => {
    beforeEach(() => {
      api['simulation'] = vi.fn(async () => simulation());
      api['validateStatement'] = vi.fn(async () => statement());
      setup(RetroSimulationComponent);
    });

    it('shows each doctor\'s figures and warns about invoices nobody owns', async () => {
      await mount(RetroSimulationComponent);
      const text = document.body.textContent!;
      expect(text).toContain('Dr Tazi');
      expect(text).toContain('RETRO.SIM.UNATTRIBUTED');
      expect(text).toContain('FA-9');
    });

    it('narrows the calculation by payment method and sends only what was ticked', async () => {
      const fixture = await mount(RetroSimulationComponent);
      (document.querySelector('details input[type=checkbox]') as HTMLInputElement).click();
      await settleUi(fixture);
      expect(api['simulation']).toHaveBeenLastCalledWith(expect.objectContaining({ method: ['CASH'] }));
    });

    it('validates a statement for one doctor over the period shown, carrying the filters', async () => {
      const fixture = await mount(RetroSimulationComponent);
      buttonWith('RETRO.SIM.VALIDATE')!.click();
      await settleUi(fixture);
      type(document.querySelector('textarea[name=notes]'), 'Septembre');
      await settleUi(fixture);
      (document.querySelector('#validate-form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      await settleUi(fixture);
      expect(api['validateStatement']).toHaveBeenCalledWith(expect.objectContaining({ practitionerId: 'd1', notes: 'Septembre', methods: undefined }));
      expect(mocks.toasts.map(t => t.kind)).toEqual(['success']);
    });

    it('offers no validate button to someone who may only look', async () => {
      TestBed.resetTestingModule();
      setup(RetroSimulationComponent, { can: ['RETROCESSION_VIEW'] });
      await mount(RetroSimulationComponent);
      expect(buttonWith('RETRO.SIM.VALIDATE')).toBeUndefined();
    });
  });

  describe('statements', () => {
    const summary = (over: Partial<StatementSummary> = {}): StatementSummary => ({
      id: 's1', number: 'RT-2026-001', practitionerId: 'd1', practitionerName: 'Dr Tazi', from: '2026-09-01', to: '2026-09-30', gross: 2700, advancesDeducted: 500, net: 2200, paid: 0, status: 'UNPAID', validatedAt: '2026-10-01T09:00:00Z', ...over,
    });

    beforeEach(() => {
      api['statements'] = vi.fn(async () => [summary()]);
      api['statement'] = vi.fn(async () => statement());
      api['payout'] = vi.fn(async () => statement({ paid: 1000, status: 'PARTIAL', payouts: [{ id: 'p1', amount: 1000, paidDate: '2026-10-06', method: 'CASH', reference: '', notes: '', recordedAt: '2026-10-06T10:00:00Z' }] }));
      api['voidStatement'] = vi.fn(async () => statement({ status: 'VOID', voidReason: 'erreur' }));
      setup(RetroStatementsComponent);
    });

    it('hides voided statements unless asked, and opens one with its remaining balance ready', async () => {
      const fixture = await mount(RetroStatementsComponent);
      expect(api['statements']).toHaveBeenCalledWith({ practitionerId: undefined, includeVoided: undefined });
      buttonWith('RT-2026-001')!.click();
      await settleUi(fixture);
      expect((document.querySelector('input[name=amount]') as HTMLInputElement).value).toBe('2200');
    });

    it('records a payout and shows the new balance', async () => {
      const fixture = await mount(RetroStatementsComponent);
      buttonWith('RT-2026-001')!.click();
      await settleUi(fixture);
      type(document.querySelector('input[name=amount]'), '1000');
      await settleUi(fixture);
      (document.querySelector('#payout-form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      await settleUi(fixture);
      expect(api['payout']).toHaveBeenCalledWith('s1', expect.objectContaining({ amount: 1000, method: 'CASH' }));
      expect(document.querySelector('[role=dialog]')!.textContent).toContain('RETRO.ST.STATUSES.PARTIAL');
    });

    it('will not take more than what is left', async () => {
      const fixture = await mount(RetroStatementsComponent);
      buttonWith('RT-2026-001')!.click();
      await settleUi(fixture);
      type(document.querySelector('input[name=amount]'), '5000');
      await settleUi(fixture);
      expect((document.querySelector('#payout-form button[type=submit]') as HTMLButtonElement).disabled).toBe(true);
    });

    it('voids with a reason of at least three characters', async () => {
      const fixture = await mount(RetroStatementsComponent);
      buttonWith('RT-2026-001')!.click();
      await settleUi(fixture);
      buttonWith('RETRO.ST.VOID')!.click();
      await settleUi(fixture);
      const submit = document.querySelector('button[form=void-form]') as HTMLButtonElement;
      expect(submit.disabled).toBe(true);
      type(document.querySelector('textarea[name=reason]'), 'erreur');
      await settleUi(fixture);
      expect(submit.disabled).toBe(false);
      (document.querySelector('#void-form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      await settleUi(fixture);
      expect(api['voidStatement']).toHaveBeenCalledWith('s1', 'erreur');
    });
  });

  describe('rules', () => {
    const rule = (over: Partial<RetroRule> = {}): RetroRule => ({
      id: 'r1', practitionerId: 'd1', practitionerName: 'Dr Tazi', basis: 'COLLECTED', ratePercent: 30, deductLabFees: true, fixedMonthlyAmount: 0, effectiveFrom: '2026-01-01', effectiveTo: '' as never, notes: '', overrides: { Implants: 40 }, ...over,
    });

    beforeEach(() => {
      api['rules'] = vi.fn(async () => [rule()]);
      api['createRule'] = vi.fn(async () => rule());
      api['updateRule'] = vi.fn(async () => rule());
      api['deleteRule'] = vi.fn(async () => undefined);
      setup(RetroRulesComponent);
    });

    it('lists the rules with their category overrides', async () => {
      await mount(RetroRulesComponent);
      expect(document.body.textContent).toContain('Implants 40%');
      expect(document.body.textContent).toContain('RETRO.RULES.DEDUCT_LAB');
    });

    it('creates a rule with an override row', async () => {
      const fixture = await mount(RetroRulesComponent);
      buttonWith('RETRO.RULES.NEW')!.click();
      await settleUi(fixture);
      const doctor = document.querySelector('select[name=doctor]') as HTMLSelectElement;
      doctor.value = 'd1';
      doctor.dispatchEvent(new Event('change', { bubbles: true }));
      type(document.querySelector('input[name=rate]'), '35');
      buttonWith('RETRO.RULES.ADD_OVERRIDE')!.click();
      await settleUi(fixture);
      type(document.querySelector('input[placeholder="RETRO.RULES.CATEGORY"]'), 'Ortho');
      await settleUi(fixture);
      (document.querySelector('#rule-form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      await settleUi(fixture);
      expect(api['createRule']).toHaveBeenCalledWith(expect.objectContaining({ practitionerId: 'd1', ratePercent: 35, overrides: { Ortho: 35 } }));
    });

    it('does not let a rule through with a rate over 100', async () => {
      const fixture = await mount(RetroRulesComponent);
      buttonWith('RETRO.RULES.NEW')!.click();
      await settleUi(fixture);
      const doctor = document.querySelector('select[name=doctor]') as HTMLSelectElement;
      doctor.value = 'd1';
      doctor.dispatchEvent(new Event('change', { bubbles: true }));
      type(document.querySelector('input[name=rate]'), '150');
      await settleUi(fixture);
      expect((document.querySelector('button[form=rule-form]') as HTMLButtonElement).disabled).toBe(true);
      expect(document.querySelector('[role=alert]')!.textContent).toContain('RETRO.RULES.PROBLEM.RATE');
    });

    it('deletes only after confirmation', async () => {
      confirmAnswer = false;
      const fixture = await mount(RetroRulesComponent);
      (document.querySelector('button[aria-label^="COMMON.DELETE"]') as HTMLButtonElement).click();
      await settleUi(fixture);
      expect(api['deleteRule']).not.toHaveBeenCalled();
    });
  });

  describe('advances', () => {
    beforeEach(() => {
      api['advances'] = vi.fn(async () => [
        { id: 'a1', practitionerId: 'd1', practitionerName: 'Dr Tazi', advanceDate: '2026-09-01', amount: 1000, outstanding: 1000, method: 'CASH', notes: '' },
        { id: 'a2', practitionerId: 'd1', practitionerName: 'Dr Tazi', advanceDate: '2026-08-01', amount: 500, outstanding: 200, method: '', notes: '' },
      ]);
      api['createAdvance'] = vi.fn(async () => ({}));
      api['deleteAdvance'] = vi.fn(async () => undefined);
      setup(RetroAdvancesComponent);
    });

    it('lets only an untouched advance be deleted: one already deducted is part of a statement', async () => {
      const fixture = await mount(RetroAdvancesComponent);
      const deletes = document.querySelectorAll('button[aria-label^="COMMON.DELETE"]');
      expect(deletes).toHaveLength(1);
      (deletes[0] as HTMLButtonElement).click();
      await settleUi(fixture);
      expect(api['deleteAdvance']).toHaveBeenCalledWith('a1');
    });

    it('records an advance for a doctor', async () => {
      const fixture = await mount(RetroAdvancesComponent);
      buttonWith('RETRO.ADV.NEW')!.click();
      await settleUi(fixture);
      const doctor = document.querySelector('select[name=doctor]') as HTMLSelectElement;
      doctor.value = 'd1';
      doctor.dispatchEvent(new Event('change', { bubbles: true }));
      type(document.querySelector('input[name=amount]'), '800');
      await settleUi(fixture);
      (document.querySelector('#adv-form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      await settleUi(fixture);
      expect(api['createAdvance']).toHaveBeenCalledWith(expect.objectContaining({ practitionerId: 'd1', amount: 800 }));
    });
  });
});
