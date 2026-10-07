import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AnalyticsApi, TaxBracket, TaxSchedule, TaxScheduleInput, TaxSimulation } from '../../core/services/analytics-api.service';
import { ApiErrors } from '../../core/services/api-error.service';
import { FinanceApi } from '../../core/services/finance-api.service';
import { PermissionService } from '../../core/services/permission.service';
import { ToastService } from '../../core/services/toast.service';
import { loadable } from '../../core/utils/loadable';
import { MoneyPipe, PctPipe } from '../../shared/pipes/money.pipe';

/** One band as typed: the open-ended top band has no upper limit. */
export interface BandRow {
  upTo: number | null;
  ratePercent: number;
}

export const BLANK_BANDS: BandRow[] = [{ upTo: null, ratePercent: 0 }];

/** The bands as the server takes them: the last one is always open-ended, whatever was typed in it. */
export function bandsToSend(rows: BandRow[]): TaxBracket[] {
  return rows.map((row, i) => ({ upTo: i === rows.length - 1 ? undefined : (row.upTo ?? undefined), ratePercent: Number(row.ratePercent) || 0 }));
}

/** The first thing wrong with the bands, or null: each limit climbs, and every band has a rate between 0 and 100. */
export function bandProblem(rows: BandRow[]): 'EMPTY' | 'ORDER' | 'RATE' | null {
  if (rows.length === 0) return 'EMPTY';
  let previous = 0;
  for (let i = 0; i < rows.length; i++) {
    const rate = Number(rows[i].ratePercent);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) return 'RATE';
    if (i < rows.length - 1) {
      const limit = rows[i].upTo;
      if (limit == null || !Number.isFinite(Number(limit)) || Number(limit) <= previous) return 'ORDER';
      previous = Number(limit);
    }
  }
  return null;
}

/**
 * What a taxable income would owe under a schedule the clinic entered. No rates are built in: they
 * differ by year and taxpayer, so the clinic types the bands from the law for the year and says
 * where they come from; that source is shown beside every result. A simulation, not tax advice.
 */
@Component({
  selector: 'app-tax-simulation',
  standalone: true,
  imports: [FormsModule, TranslateModule, MoneyPipe, PctPipe],
  template: `
    <p class="mb-4 rounded-lg border border-caution-300 bg-caution-50 px-4 py-3 text-sm text-caution-900" role="note">{{ 'ANA.TAX.DISCLAIMER' | translate }}</p>

    <div class="mb-4 flex flex-wrap items-end gap-3">
      <label class="field w-auto"><span class="label">{{ 'ANA.TAX.YEAR' | translate }}</span>
        <select class="select w-auto" name="year" [ngModel]="year()" (ngModelChange)="year.set(+$event)">
          @for (y of years; track y) { <option [ngValue]="y">{{ y }}</option> }
        </select></label>
    </div>

    <div class="grid gap-5 xl:grid-cols-2">
      <section class="card" [attr.aria-busy]="schedule.loading()">
        <div class="card-head"><h2 class="card-title">{{ 'ANA.TAX.SCHEDULE' | translate: { year: year() } }}</h2>
          @if (configured() && !editing() && canManage()) { <button type="button" class="btn btn-ghost btn-sm" (click)="startEditing()">{{ 'COMMON.EDIT' | translate }}</button> }
        </div>

        @if (configured() && !editing()) {
          @let s = schedule.data()!;
          <div class="space-y-3 p-4">
            <p class="text-sm text-ink-700"><span class="font-semibold">{{ 'ANA.TAX.SOURCE' | translate }}:</span> {{ s.source }}</p>
            <table class="table">
              <thead><tr><th>{{ 'ANA.TAX.BAND' | translate }}</th><th class="text-end">{{ 'ANA.TAX.RATE' | translate }}</th></tr></thead>
              <tbody>
                @for (b of s.brackets; track $index; let i = $index) {
                  <tr><td>{{ bandLabel(s.brackets, i) }}</td><td class="text-end tabular-nums">{{ b.ratePercent }} %</td></tr>
                }
              </tbody>
            </table>
            @if ((s.dependentDeduction ?? 0) > 0) {
              <p class="text-xs text-ink-500">{{ 'ANA.TAX.DEPENDENT_LINE' | translate: { amount: money(s.dependentDeduction ?? 0), max: s.maxDependents } }}</p>
            }
          </div>
        } @else if (editing() || canManage()) {
          <form class="space-y-4 p-4" (ngSubmit)="save()">
            <p class="text-xs text-ink-500">{{ 'ANA.TAX.NO_RATES_BUILT_IN' | translate }}</p>
            <label class="field"><span class="label">{{ 'ANA.TAX.SOURCE' | translate }} *</span>
              <input class="input" type="text" name="source" maxlength="500" [ngModel]="source()" (ngModelChange)="source.set($event)" required />
              <span class="hint">{{ 'ANA.TAX.SOURCE_HINT' | translate }}</span></label>

            <fieldset class="space-y-2">
              <legend class="label">{{ 'ANA.TAX.BANDS' | translate }}</legend>
              @for (row of rows(); track $index; let i = $index; let last = $last) {
                <div class="flex items-end gap-2">
                  <label class="field flex-1"><span class="hint">{{ (last ? 'ANA.TAX.ABOVE' : 'ANA.TAX.UP_TO') | translate }}</span>
                    @if (last) {
                      <input class="input" type="text" [name]="'upTo' + i" [attr.name]="'upTo' + i" [value]="'ANA.TAX.NO_LIMIT' | translate" disabled />
                    } @else {
                      <input class="input" type="number" min="0" step="any" [name]="'upTo' + i" [attr.name]="'upTo' + i" [ngModel]="row.upTo" (ngModelChange)="setBand(i, 'upTo', $event === '' ? null : +$event)" />
                    }
                  </label>
                  <label class="field w-28"><span class="hint">{{ 'ANA.TAX.RATE' | translate }} %</span>
                    <input class="input" type="number" min="0" max="100" step="any" [name]="'rate' + i" [attr.name]="'rate' + i" [ngModel]="row.ratePercent" (ngModelChange)="setBand(i, 'ratePercent', +$event || 0)" /></label>
                  <button type="button" class="btn btn-ghost btn-sm" [disabled]="rows().length < 2" [attr.aria-label]="'ANA.TAX.REMOVE_BAND' | translate" (click)="removeBand(i)">✕</button>
                </div>
              }
              <button type="button" class="btn btn-ghost btn-sm" [disabled]="rows().length >= 12" (click)="addBand()">+ {{ 'ANA.TAX.ADD_BAND' | translate }}</button>
              @if (problem(); as p) { <p class="text-xs text-critical-700" role="alert">{{ 'ANA.TAX.PROBLEM.' + p | translate }}</p> }
            </fieldset>

            <div class="grid grid-cols-2 gap-3">
              <label class="field"><span class="label">{{ 'ANA.TAX.DEPENDENT_DEDUCTION' | translate }}</span><input class="input" type="number" min="0" step="any" name="deduction" [ngModel]="deduction()" (ngModelChange)="deduction.set(+$event || 0)" /></label>
              <label class="field"><span class="label">{{ 'ANA.TAX.MAX_DEPENDENTS' | translate }}</span><input class="input" type="number" min="0" max="20" step="1" name="maxDependents" [ngModel]="maxDependents()" (ngModelChange)="maxDependents.set(+$event || 0)" /></label>
            </div>

            <div class="flex gap-2">
              <button type="submit" class="btn btn-primary" [disabled]="busy() || !canSave()">{{ 'ANA.TAX.SAVE' | translate }}</button>
              @if (editing()) { <button type="button" class="btn btn-ghost" (click)="editing.set(false)">{{ 'COMMON.CANCEL' | translate }}</button> }
            </div>
          </form>
        } @else {
          <p class="p-4 text-sm text-ink-500">{{ 'ANA.TAX.NOT_ENTERED' | translate: { year: year() } }}</p>
        }
      </section>

      <section class="card">
        <div class="card-head"><h2 class="card-title">{{ 'ANA.TAX.SIMULATION' | translate }}</h2></div>
        @if (configured()) {
          <div class="space-y-4 p-4">
            <label class="field"><span class="label">{{ 'ANA.TAX.INCOME' | translate }}</span>
              <input class="input" type="number" step="any" name="income" [ngModel]="income()" (ngModelChange)="income.set($event === '' || $event === null ? null : +$event)" />
              <span class="hint">{{ 'ANA.TAX.INCOME_HINT' | translate }}</span></label>
            <button type="button" class="btn btn-ghost btn-sm" [disabled]="resultBusy()" (click)="startFromYearResult()">{{ 'ANA.TAX.START_FROM_RESULT' | translate: { year: year() } }}</button>
            <label class="field"><span class="label">{{ 'ANA.TAX.DEPENDENTS' | translate }}</span>
              <input class="input" type="number" min="0" max="50" step="1" name="dependents" [ngModel]="dependents()" (ngModelChange)="dependents.set(+$event || 0)" /></label>
          </div>
        } @else {
          <p class="p-4 text-sm text-ink-500">{{ 'ANA.TAX.ENTER_FIRST' | translate }}</p>
        }
      </section>
    </div>

    @if (result(); as r) {
      <section class="card mt-5" [attr.aria-busy]="resultBusy()">
        <div class="card-head"><h2 class="card-title">{{ 'ANA.TAX.RESULT' | translate: { year: r.year } }}</h2></div>
        <dl class="grid grid-cols-2 gap-4 p-4 xl:grid-cols-4">
          <div class="tile p-4"><dt class="kpi-label">{{ 'ANA.TAX.GROSS' | translate }}</dt><dd class="kpi-value">{{ r.grossTax | money }}</dd></div>
          <div class="tile p-4"><dt class="kpi-label">{{ 'ANA.TAX.RELIEF' | translate }}</dt><dd class="kpi-value">{{ r.dependentRelief | money }}</dd></div>
          <div class="tile p-4"><dt class="kpi-label">{{ 'ANA.TAX.TAX' | translate }}</dt><dd class="kpi-value text-petrol-700">{{ r.tax | money }}</dd><dd class="kpi-hint">{{ 'ANA.TAX.EFFECTIVE' | translate }}: {{ r.effectiveRatePercent | pct }}</dd></div>
          <div class="tile p-4"><dt class="kpi-label">{{ 'ANA.TAX.AFTER_TAX' | translate }}</dt><dd class="kpi-value">{{ r.incomeAfterTax | money }}</dd></div>
        </dl>
        <div class="overflow-x-auto px-4 pb-4">
          <table class="table">
            <thead><tr><th>{{ 'ANA.TAX.BAND' | translate }}</th><th class="text-end">{{ 'ANA.TAX.RATE' | translate }}</th><th class="text-end">{{ 'ANA.TAX.IN_BAND' | translate }}</th><th class="text-end">{{ 'ANA.TAX.TAX' | translate }}</th></tr></thead>
            <tbody>
              @for (b of r.bands; track $index) {
                <tr><td>{{ bandRange(b.from ?? 0, b.upTo) }}</td><td class="text-end tabular-nums">{{ b.ratePercent }} %</td><td class="text-end tabular-nums">{{ b.amountInBand | money }}</td><td class="text-end tabular-nums">{{ b.tax | money }}</td></tr>
              }
            </tbody>
          </table>
        </div>
        <p class="border-t border-ink-100 px-4 py-3 text-xs text-ink-500">{{ 'ANA.TAX.SOURCE' | translate }}: {{ r.source }}. {{ 'ANA.TAX.DISCLAIMER_SHORT' | translate }}</p>
      </section>
    }
  `,
})
export class TaxSimulationComponent {
  private readonly api = inject(AnalyticsApi);
  private readonly finance = inject(FinanceApi);
  private readonly errors = inject(ApiErrors);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private readonly permissions = inject(PermissionService);
  private readonly moneyPipe = new MoneyPipe();

  protected readonly years = [new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1];
  protected readonly year = signal(new Date().getFullYear());
  protected readonly schedule = loadable<TaxSchedule | null>(null);
  protected readonly editing = signal(false);
  protected readonly busy = signal(false);

  // The schedule form.
  protected readonly source = signal('');
  protected readonly rows = signal<BandRow[]>(BLANK_BANDS.map(b => ({ ...b })));
  protected readonly deduction = signal(0);
  protected readonly maxDependents = signal(0);

  // The simulation.
  protected readonly income = signal<number | null>(null);
  protected readonly dependents = signal(0);
  protected readonly result = signal<TaxSimulation | null>(null);
  protected readonly resultBusy = signal(false);

  protected readonly configured = computed(() => this.schedule.data()?.configured === true);
  protected readonly canManage = computed(() => this.permissions.can('FINANCE_MANAGE'));
  protected readonly problem = computed(() => bandProblem(this.rows()));
  protected readonly canSave = computed(() => this.source().trim().length > 0 && this.problem() === null);

  constructor() {
    effect(() => {
      const year = this.year();
      untracked(() => void this.loadYear(year));
    });
    // The result follows the numbers, a moment after the person stops typing.
    let pause: ReturnType<typeof setTimeout> | undefined;
    effect(onCleanup => {
      const income = this.income();
      const dependents = this.dependents();
      const year = this.year();
      const configured = this.configured();
      pause = setTimeout(() => untracked(() => void this.simulate(configured, year, income, dependents)), 250);
      onCleanup(() => clearTimeout(pause));
    });
  }

  protected money(amount: number): string {
    return this.moneyPipe.transform(amount);
  }

  protected bandLabel(brackets: TaxBracket[], i: number): string {
    const from = i === 0 ? 0 : (brackets[i - 1].upTo ?? 0);
    return this.bandRange(from, brackets[i].upTo);
  }

  protected bandRange(from: number, upTo: number | null | undefined): string {
    return upTo == null
      ? this.translate.instant('ANA.TAX.ABOVE_AMOUNT', { from: this.money(from) })
      : this.translate.instant('ANA.TAX.BETWEEN', { from: this.money(from), to: this.money(upTo) });
  }

  protected setBand(index: number, key: keyof BandRow, value: number | null): void {
    this.rows.update(rows => rows.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
  }

  protected addBand(): void {
    // The open-ended band stays last; a new band goes just above the last limit.
    this.rows.update(rows => [...rows.slice(0, -1), { upTo: null, ratePercent: 0 }, rows[rows.length - 1]]);
  }

  protected removeBand(index: number): void {
    this.rows.update(rows => (rows.length < 2 ? rows : rows.filter((_, i) => i !== index)));
  }

  protected startEditing(): void {
    this.fillForm(this.schedule.data());
    this.editing.set(true);
  }

  private fillForm(s: TaxSchedule | null | undefined): void {
    this.source.set(s?.source ?? '');
    this.rows.set(s && s.configured && s.brackets.length
      ? s.brackets.map(b => ({ upTo: b.upTo ?? null, ratePercent: b.ratePercent }))
      : BLANK_BANDS.map(b => ({ ...b })));
    this.deduction.set(s?.dependentDeduction ?? 0);
    this.maxDependents.set(s?.maxDependents ?? 0);
  }

  private async loadYear(year: number): Promise<void> {
    this.editing.set(false);
    this.result.set(null);
    if (await this.schedule.load(() => this.api.taxSchedule(year))) {
      this.fillForm(this.schedule.data());
    }
  }

  private async simulate(configured: boolean, year: number, income: number | null, dependents: number): Promise<void> {
    if (!configured || income === null) {
      this.result.set(null);
      return;
    }
    this.resultBusy.set(true);
    try {
      const result = await this.api.taxSimulation(year, income, dependents);
      // A slow answer for an income typed a moment ago is not shown over a newer one.
      if (year === this.year() && income === this.income()) this.result.set(result);
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.resultBusy.set(false);
    }
  }

  /** What the practice made in the year (collections less expenses and retrocessions): a starting point to adjust to the taxable income, not the taxable income itself. */
  protected async startFromYearResult(): Promise<void> {
    const year = this.year();
    this.resultBusy.set(true);
    try {
      const dashboard = await this.finance.dashboard(`${year}-01-01`, `${year}-12-31`);
      this.income.set(Math.round(dashboard.result * 100) / 100);
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.resultBusy.set(false);
    }
  }

  protected async save(): Promise<void> {
    if (this.busy() || !this.canSave()) {
      return;
    }
    this.busy.set(true);
    try {
      const body: TaxScheduleInput = {
        source: this.source().trim(),
        brackets: bandsToSend(this.rows()),
        dependentDeduction: this.deduction(),
        maxDependents: this.maxDependents(),
      };
      const saved = await this.api.saveTaxSchedule(this.year(), body);
      this.schedule.data.set(saved);
      this.editing.set(false);
      this.toast.success(this.translate.instant('ANA.TAX.SAVED'));
      // The figures changed under any result already shown.
      void this.simulate(true, this.year(), this.income(), this.dependents());
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.busy.set(false);
    }
  }
}
