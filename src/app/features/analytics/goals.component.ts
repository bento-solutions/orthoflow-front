import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AnalyticsApi, GoalInputs, GoalPlan, GoalTracking } from '../../core/services/analytics-api.service';
import { ApiErrors } from '../../core/services/api-error.service';
import { LanguageService } from '../../core/services/language.service';
import { PermissionService } from '../../core/services/permission.service';
import { ToastService } from '../../core/services/toast.service';
import { formState } from '../../core/utils/form-state';
import { loadable } from '../../core/utils/loadable';
import { MoneyPipe, PctPipe } from '../../shared/pipes/money.pipe';

export const BLANK_INPUTS: GoalInputs = { fixedCosts: 0, personalNeeds: 0, variableCostPercent: 0, workingDaysPerMonth: 22 };

/** Progress toward a target, capped at 100 for a bar: beating the target is shown in the figure, not by an overflowing bar. */
export function barWidth(progressPercent: number): number {
  return Math.max(0, Math.min(100, progressPercent));
}

/**
 * A revenue target for the year, worked out from what the owner needs: the fixed costs to cover,
 * what they want to take home, the share of each fee that goes on variable costs and the days
 * worked in a month. The plan updates as the numbers change; saving it starts the monthly
 * tracking against what was actually collected.
 */
@Component({
  selector: 'app-goals',
  standalone: true,
  imports: [FormsModule, TranslateModule, MoneyPipe, PctPipe],
  template: `
    <div class="mb-4 flex flex-wrap items-end gap-3">
      <label class="field w-auto"><span class="label">{{ 'ANA.GOALS.YEAR' | translate }}</span>
        <select class="select w-auto" [ngModel]="year()" (ngModelChange)="year.set(+$event)">
          @for (y of years; track y) { <option [ngValue]="y">{{ y }}</option> }
        </select></label>
    </div>

    <div class="grid gap-5 xl:grid-cols-2">
      <section class="card">
        <div class="card-head"><h2 class="card-title">{{ 'ANA.GOALS.WIZARD' | translate }}</h2>
          <button type="button" class="btn btn-ghost btn-sm" [disabled]="!suggestions()" (click)="useSuggestions()">{{ 'ANA.GOALS.USE_SUGGESTIONS' | translate }}</button></div>
        <form class="space-y-4 p-4" (ngSubmit)="save()">
          @if (suggestions(); as s) { <p class="text-xs text-ink-500">{{ 'ANA.GOALS.SUGGESTION_HINT' | translate: { from: s.basedOnFrom, to: s.basedOnTo } }}</p> }
          <fieldset [disabled]="!canSave()" class="space-y-4">
            <label class="field"><span class="label">{{ 'ANA.GOALS.FIXED' | translate }}</span><input class="input" type="number" min="0" step="0.01" name="fixed" [ngModel]="inputs.value().fixedCosts" (ngModelChange)="inputs.set('fixedCosts', +$event || 0)" /><span class="hint">{{ 'ANA.GOALS.FIXED_HINT' | translate }}</span></label>
            <label class="field"><span class="label">{{ 'ANA.GOALS.PERSONAL' | translate }}</span><input class="input" type="number" min="0" step="0.01" name="personal" [ngModel]="inputs.value().personalNeeds" (ngModelChange)="inputs.set('personalNeeds', +$event || 0)" /><span class="hint">{{ 'ANA.GOALS.PERSONAL_HINT' | translate }}</span></label>
            <label class="field"><span class="label">{{ 'ANA.GOALS.VARIABLE' | translate }}</span><input class="input" type="number" min="0" max="99" step="0.1" name="variable" [ngModel]="inputs.value().variableCostPercent" (ngModelChange)="inputs.set('variableCostPercent', +$event || 0)" /><span class="hint">{{ 'ANA.GOALS.VARIABLE_HINT' | translate }}</span></label>
            <label class="field"><span class="label">{{ 'ANA.GOALS.DAYS' | translate }}</span><input class="input" type="number" min="1" max="31" step="0.5" name="days" [ngModel]="inputs.value().workingDaysPerMonth" (ngModelChange)="inputs.set('workingDaysPerMonth', +$event || 0)" /></label>
          </fieldset>
          @if (canSave()) { <button type="submit" class="btn btn-primary" [disabled]="busy()">{{ 'ANA.GOALS.SAVE' | translate }}</button> }
        </form>
      </section>

      <section class="card" [attr.aria-busy]="planBusy()">
        <div class="card-head"><h2 class="card-title">{{ 'ANA.GOALS.PLAN' | translate }}</h2></div>
        @if (plan(); as p) {
          <dl class="grid grid-cols-2 gap-4 p-4">
            <div class="tile p-4"><dt class="kpi-label">{{ 'ANA.GOALS.BREAK_EVEN' | translate }}</dt><dd class="kpi-value">{{ p.breakEvenMonthly | money }}</dd><dd class="kpi-hint">{{ 'ANA.GOALS.PER_MONTH' | translate }}</dd></div>
            <div class="tile p-4"><dt class="kpi-label">{{ 'ANA.GOALS.TARGET' | translate }}</dt><dd class="kpi-value text-petrol-700">{{ p.monthlyTarget | money }}</dd><dd class="kpi-hint">{{ 'ANA.GOALS.PER_MONTH' | translate }}</dd></div>
            <div class="tile p-4"><dt class="kpi-label">{{ 'ANA.GOALS.DAILY' | translate }}</dt><dd class="kpi-value">{{ p.dailyTarget | money }}</dd><dd class="kpi-hint">{{ 'ANA.GOALS.PER_DAY' | translate }}</dd></div>
            <div class="tile p-4"><dt class="kpi-label">{{ 'ANA.GOALS.YEARLY' | translate }}</dt><dd class="kpi-value">{{ p.yearlyTarget | money }}</dd><dd class="kpi-hint">{{ 'ANA.GOALS.PER_YEAR' | translate }}</dd></div>
          </dl>
        }
      </section>
    </div>

    @if (tracking.data(); as t) {
      @if (t.saved) {
        <section class="card mt-5">
          <div class="card-head"><h2 class="card-title">{{ 'ANA.GOALS.TRACKING' | translate: { year: t.year } }}</h2>
            <span class="text-sm text-ink-600">{{ 'ANA.GOALS.YTD' | translate: { actual: money(t.yearToDateActual), target: money(t.yearToDateTarget) } }}</span></div>
          <div class="table-scroll">
            <table class="data-table">
              <thead><tr><th scope="col">{{ 'ANA.GOALS.MONTH' | translate }}</th><th scope="col" class="cell-num">{{ 'ANA.GOALS.TARGET_COL' | translate }}</th><th scope="col" class="cell-num">{{ 'ANA.GOALS.ACTUAL' | translate }}</th>
                <th scope="col">{{ 'ANA.GOALS.PROGRESS' | translate }}</th><th scope="col" class="cell-num">{{ 'ANA.GOALS.VARIANCE' | translate }}</th><th scope="col" class="cell-num">{{ 'ANA.GOALS.PROJECTED' | translate }}</th></tr></thead>
              <tbody>
                @for (m of t.months; track m.month) {
                  <tr>
                    <th scope="row" class="text-start font-semibold">{{ monthName(m.month) }}</th>
                    <td class="cell-num">{{ m.target | money }}</td><td class="cell-num">{{ m.actual | money }}</td>
                    <td><span class="flex items-center gap-2"><span class="h-1.5 w-24 overflow-hidden rounded-full bg-ink-100" aria-hidden="true"><span class="block h-full rounded-full" [class.bg-positive-500]="m.progressPercent >= 100" [class.bg-petrol-500]="m.progressPercent < 100" [style.width.%]="bar(m.progressPercent)"></span></span><span class="text-xs tabular-nums text-ink-600">{{ m.progressPercent | pct }}</span></span></td>
                    <td class="cell-num" [class.text-critical-700]="m.variance < 0" [class.text-positive-700]="m.variance > 0">{{ m.variance | money }}</td>
                    <td class="cell-num text-ink-500">{{ m.projected | money }}</td>
                  </tr>
                }
              </tbody>
              <tfoot><tr class="font-bold"><th scope="row" class="text-start">{{ 'COMMON.TOTAL' | translate }}</th><td class="cell-num">{{ t.yearTarget | money }}</td><td class="cell-num">{{ t.yearActual | money }}</td><td colspan="3"></td></tr></tfoot>
            </table>
          </div>
        </section>
      } @else {
        <p class="mt-5 rounded-md bg-ink-50 p-3 text-sm text-ink-600">{{ 'ANA.GOALS.NOT_SAVED' | translate }}</p>
      }
    }
  `,
  styles: [`
    .card-title { font-size: var(--text-md); font-weight: 700; color: var(--text); }
    .kpi-label { font-size: var(--text-2xs); font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-muted); }
    .kpi-value { margin-top: 0.25rem; font-size: var(--text-lg); font-weight: 800; color: var(--text); font-variant-numeric: tabular-nums; }
    .kpi-hint { font-size: var(--text-xs); color: var(--text-muted); }
  `],
})
export class GoalsComponent {
  private readonly api = inject(AnalyticsApi);
  private readonly errors = inject(ApiErrors);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  private readonly permissions = inject(PermissionService);
  private readonly moneyPipe = new MoneyPipe();

  protected readonly bar = barWidth;
  protected readonly years = [new Date().getFullYear() - 1, new Date().getFullYear(), new Date().getFullYear() + 1];
  protected readonly year = signal(new Date().getFullYear());
  protected readonly inputs = formState<GoalInputs>({ ...BLANK_INPUTS });
  protected readonly plan = signal<GoalPlan | null>(null);
  protected readonly planBusy = signal(false);
  protected readonly suggestions = signal<Awaited<ReturnType<AnalyticsApi['goalSuggestions']>> | null>(null);
  protected readonly tracking = loadable<GoalTracking | null>(null);
  protected readonly busy = signal(false);
  protected readonly canSave = computed(() => this.permissions.can('FINANCE_MANAGE'));

  constructor() {
    this.api.goalSuggestions().then(s => this.suggestions.set(s)).catch(() => undefined);
    effect(() => {
      const year = this.year();
      untracked(() => void this.loadYear(year));
    });
    // The plan follows the numbers, a moment after the person stops typing.
    let pause: ReturnType<typeof setTimeout> | undefined;
    effect(onCleanup => {
      const inputs = this.inputs.value();
      pause = setTimeout(() => untracked(() => void this.refreshPlan(inputs)), 250);
      onCleanup(() => clearTimeout(pause));
    });
  }

  protected money(amount: number): string {
    return this.moneyPipe.transform(amount);
  }

  protected monthName(month: number): string {
    return new Intl.DateTimeFormat(this.language.currentLang(), { month: 'long' }).format(new Date(2026, month - 1, 1));
  }

  private async loadYear(year: number): Promise<void> {
    if (await this.tracking.load(() => this.api.goalTracking(year))) {
      const saved = this.tracking.data()?.inputs;
      if (saved) {
        this.inputs.reset({ ...BLANK_INPUTS, ...saved });
      }
    }
  }

  private async refreshPlan(inputs: GoalInputs): Promise<void> {
    if (inputs.variableCostPercent >= 100) {
      return;
    }
    this.planBusy.set(true);
    try {
      this.plan.set(await this.api.goalPlan(inputs));
    } catch {
      // incomplete numbers are normal while typing; the last plan stays
    } finally {
      this.planBusy.set(false);
    }
  }

  protected useSuggestions(): void {
    const s = this.suggestions();
    if (s) {
      this.inputs.reset({ ...this.inputs.value(), fixedCosts: s.fixedCosts, variableCostPercent: s.variableCostPercent, workingDaysPerMonth: s.workingDaysPerMonth });
    }
  }

  protected async save(): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    try {
      const saved = await this.api.saveGoal(this.year(), { inputs: this.inputs.value() });
      this.tracking.data.set(saved);
      this.toast.success(this.translate.instant('ANA.GOALS.SAVED'));
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.busy.set(false);
    }
  }
}
