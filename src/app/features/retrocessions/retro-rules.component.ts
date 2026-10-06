import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AnalyticsApi, RetroRule, RetroRuleInput } from '../../core/services/analytics-api.service';
import { ApiErrors } from '../../core/services/api-error.service';
import { ConfirmDialogService } from '../../core/services/confirm-dialog.service';
import { PractitionerService } from '../../core/services/practitioner.service';
import { ToastService } from '../../core/services/toast.service';
import { formState } from '../../core/utils/form-state';
import { isoDate } from '../../core/utils/format';
import { loadable } from '../../core/utils/loadable';
import { CanDirective } from '../../shared/directives/can.directive';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { IconComponent } from '../../shared/ui/icon.component';
import { ModalComponent } from '../../shared/ui/modal.component';

export interface RuleForm {
  practitionerId: string;
  basis: 'COLLECTED' | 'PRODUCED';
  ratePercent: number;
  deductLabFees: boolean;
  fixedMonthlyAmount: number;
  effectiveFrom: string;
  effectiveTo: string;
  notes: string;
  overrides: { category: string; rate: number }[];
}

export const blankRule = (): RuleForm => ({
  practitionerId: '', basis: 'COLLECTED', ratePercent: 0, deductLabFees: false, fixedMonthlyAmount: 0, effectiveFrom: isoDate(new Date()), effectiveTo: '', notes: '', overrides: [],
});

/** The category overrides as the server wants them (a map), dropping blank rows and keeping the last rate for a category typed twice. */
export function overridesMap(rows: readonly { category: string; rate: number }[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const row of rows) {
    const key = row.category.trim();
    if (key) {
      map[key] = row.rate;
    }
  }
  return map;
}

export function ruleRequest(f: RuleForm): RetroRuleInput {
  return {
    practitionerId: f.practitionerId, basis: f.basis, ratePercent: f.ratePercent, deductLabFees: f.deductLabFees, fixedMonthlyAmount: f.fixedMonthlyAmount || undefined,
    effectiveFrom: f.effectiveFrom, effectiveTo: f.effectiveTo || undefined, notes: f.notes.trim() || undefined, overrides: overridesMap(f.overrides),
  };
}

/** Whether the form can be sent: a doctor, a start date, a rate within 0-100 (also for each override), and an end that is not before the start. */
export function ruleProblem(f: RuleForm): string | null {
  if (!f.practitionerId) return 'RETRO.RULES.PROBLEM.DOCTOR';
  if (!f.effectiveFrom) return 'RETRO.RULES.PROBLEM.START';
  if (f.ratePercent < 0 || f.ratePercent > 100) return 'RETRO.RULES.PROBLEM.RATE';
  if (f.effectiveTo && f.effectiveTo < f.effectiveFrom) return 'RETRO.RULES.PROBLEM.END';
  if (f.overrides.some(o => o.category.trim() && (o.rate < 0 || o.rate > 100))) return 'RETRO.RULES.PROBLEM.OVERRIDE';
  return null;
}

/**
 * How each doctor is paid: a percentage of what is collected or produced, optionally different per
 * category of treatment, with the lab's fees taken off first if wanted, plus a fixed monthly
 * amount. A rule applies from a date; to change terms, end the old rule and add a new one, so
 * past statements can always be explained.
 */
@Component({
  selector: 'app-retro-rules',
  standalone: true,
  imports: [DatePipe, FormsModule, TranslateModule, MoneyPipe, IconComponent, ModalComponent, CanDirective],
  template: `
    <div class="mb-4 flex justify-end"><button *appCan="'RETROCESSION_MANAGE'" type="button" class="btn btn-primary btn-sm" (click)="openNew()"><app-icon name="plus" [size]="15" /> {{ 'RETRO.RULES.NEW' | translate }}</button></div>
    <div class="table-wrap" [attr.aria-busy]="rules.loading()"><div class="table-scroll">
      <table class="data-table">
        <thead><tr>
          <th scope="col">{{ 'COMMON.PRACTITIONER' | translate }}</th><th scope="col">{{ 'RETRO.RULES.BASIS' | translate }}</th><th scope="col" class="cell-num">%</th>
          <th scope="col">{{ 'RETRO.RULES.OVERRIDES' | translate }}</th><th scope="col" class="cell-num">{{ 'RETRO.FIXED' | translate }}</th><th scope="col">{{ 'RETRO.RULES.PERIOD' | translate }}</th>
          <th scope="col" class="cell-actions"><span class="sr-only">{{ 'COMMON.ACTIONS' | translate }}</span></th>
        </tr></thead>
        <tbody>
          @for (r of rules.data(); track r.id) {
            <tr>
              <td class="font-semibold">{{ r.practitionerName }}@if (r.deductLabFees) { <span class="block text-xs font-normal text-ink-500">{{ 'RETRO.RULES.DEDUCT_LAB' | translate }}</span> }</td>
              <td>{{ 'RETRO.RULES.BASES.' + r.basis | translate }}</td>
              <td class="cell-num">{{ r.ratePercent }}</td>
              <td class="text-sm">@for (o of overrideList(r); track o[0]) { <span class="me-2 inline-block whitespace-nowrap">{{ o[0] }} {{ o[1] }}%</span> } @empty { — }</td>
              <td class="cell-num">{{ r.fixedMonthlyAmount ? (r.fixedMonthlyAmount | money) : '—' }}</td>
              <td class="whitespace-nowrap">{{ r.effectiveFrom | date: 'shortDate' }} → {{ r.effectiveTo ? (r.effectiveTo | date: 'shortDate') : ('RETRO.RULES.OPEN_ENDED' | translate) }}</td>
              <td class="cell-actions">
                <span *appCan="'RETROCESSION_MANAGE'" class="inline-flex gap-1">
                  <button type="button" class="btn btn-ghost btn-icon" (click)="openEdit(r)" [attr.aria-label]="('COMMON.EDIT' | translate) + ' ' + r.practitionerName"><app-icon name="edit" [size]="16" /></button>
                  <button type="button" class="btn btn-ghost btn-icon" (click)="remove(r)" [attr.aria-label]="('COMMON.DELETE' | translate) + ' ' + r.practitionerName"><app-icon name="trash" [size]="16" /></button>
                </span>
              </td>
            </tr>
          } @empty {
            <tr><td colspan="7" class="py-8 text-center text-ink-500">{{ 'RETRO.RULES.EMPTY' | translate }}</td></tr>
          }
        </tbody>
      </table>
    </div></div>

    <app-modal [open]="editing() !== null" [title]="(editing()?.id ? 'RETRO.RULES.EDIT' : 'RETRO.RULES.NEW') | translate" size="lg" [dismissable]="!busy()" (closed)="editing.set(null)">
      <form id="rule-form" class="space-y-4" (ngSubmit)="save()">
        <div class="grid gap-4 sm:grid-cols-3">
          <label class="field"><span class="label label-required">{{ 'COMMON.PRACTITIONER' | translate }}</span>
            <select class="select" name="doctor" required [disabled]="!!editing()?.id" [ngModel]="form.value().practitionerId" (ngModelChange)="form.set('practitionerId', $event)">
              <option value="">—</option>@for (p of practitioners.active(); track p.id) { <option [value]="p.id">{{ p.displayName }}</option> }
            </select></label>
          <label class="field"><span class="label">{{ 'RETRO.RULES.BASIS' | translate }}</span>
            <select class="select" name="basis" [ngModel]="form.value().basis" (ngModelChange)="form.set('basis', $event)">
              <option value="COLLECTED">{{ 'RETRO.RULES.BASES.COLLECTED' | translate }}</option><option value="PRODUCED">{{ 'RETRO.RULES.BASES.PRODUCED' | translate }}</option>
            </select><span class="hint">{{ 'RETRO.RULES.BASIS_HINT.' + form.value().basis | translate }}</span></label>
          <label class="field"><span class="label label-required">{{ 'RETRO.RULES.RATE' | translate }}</span><input class="input" type="number" min="0" max="100" step="0.01" name="rate" required [ngModel]="form.value().ratePercent" (ngModelChange)="form.set('ratePercent', +$event || 0)" /></label>
          <label class="field"><span class="label">{{ 'RETRO.RULES.FIXED' | translate }}</span><input class="input" type="number" min="0" step="0.01" name="fixed" [ngModel]="form.value().fixedMonthlyAmount || null" (ngModelChange)="form.set('fixedMonthlyAmount', +$event || 0)" /></label>
          <label class="field"><span class="label label-required">{{ 'RETRO.RULES.FROM' | translate }}</span><input class="input" type="date" name="from" required [ngModel]="form.value().effectiveFrom" (ngModelChange)="form.set('effectiveFrom', $event)" /></label>
          <label class="field"><span class="label">{{ 'RETRO.RULES.TO' | translate }}</span><input class="input" type="date" name="to" [min]="form.value().effectiveFrom" [ngModel]="form.value().effectiveTo" (ngModelChange)="form.set('effectiveTo', $event)" /></label>
        </div>
        <label class="flex items-center gap-2 text-sm"><input type="checkbox" name="lab" [ngModel]="form.value().deductLabFees" (ngModelChange)="form.set('deductLabFees', $event)" /> {{ 'RETRO.RULES.DEDUCT_LAB' | translate }}</label>

        <fieldset class="rounded-lg border border-ink-200 p-3">
          <legend class="px-1 text-sm font-semibold text-ink-800">{{ 'RETRO.RULES.OVERRIDES' | translate }}</legend>
          <p class="mb-2 text-xs text-ink-500">{{ 'RETRO.RULES.OVERRIDES_HINT' | translate }}</p>
          @for (o of form.value().overrides; track $index) {
            <div class="mb-2 flex items-end gap-2">
              <label class="field flex-1"><span class="sr-only">{{ 'RETRO.RULES.CATEGORY' | translate }}</span><input class="input" [name]="'cat-' + $index" maxlength="50" [placeholder]="'RETRO.RULES.CATEGORY' | translate" [ngModel]="o.category" (ngModelChange)="setOverride($index, 'category', $event)" /></label>
              <label class="field w-28"><span class="sr-only">%</span><input class="input" type="number" min="0" max="100" step="0.01" [name]="'rate-' + $index" [ngModel]="o.rate" (ngModelChange)="setOverride($index, 'rate', +$event || 0)" /></label>
              <button type="button" class="btn btn-ghost btn-icon" (click)="removeOverride($index)" [attr.aria-label]="'COMMON.DELETE' | translate"><app-icon name="trash" [size]="16" /></button>
            </div>
          }
          <button type="button" class="btn btn-secondary btn-sm" (click)="addOverride()"><app-icon name="plus" [size]="14" /> {{ 'RETRO.RULES.ADD_OVERRIDE' | translate }}</button>
        </fieldset>

        <label class="field"><span class="label">{{ 'COMMON.NOTES' | translate }}</span><textarea class="textarea" rows="2" name="notes" [ngModel]="form.value().notes" (ngModelChange)="form.set('notes', $event)"></textarea></label>
        @if (problem()) { <p class="text-sm text-critical-700" role="alert">{{ problem()! | translate }}</p> }
      </form>
      <div modal-footer>
        <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="editing.set(null)">{{ 'COMMON.CANCEL' | translate }}</button>
        <button type="submit" form="rule-form" class="btn btn-primary" [disabled]="busy() || !!problem()">{{ 'COMMON.SAVE' | translate }}</button>
      </div>
    </app-modal>
  `,
})
export class RetroRulesComponent {
  private readonly api = inject(AnalyticsApi);
  private readonly errors = inject(ApiErrors);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly translate = inject(TranslateService);
  protected readonly practitioners = inject(PractitionerService);

  protected readonly rules = loadable<RetroRule[]>([]);
  protected readonly busy = signal(false);
  protected readonly editing = signal<{ id: string | null } | null>(null);
  protected readonly form = formState<RuleForm>(blankRule());
  protected readonly problem = computed(() => ruleProblem(this.form.value()));

  constructor() {
    effect(() => {
      untracked(() => void this.rules.load(() => this.api.rules()));
    });
  }

  protected overrideList(r: RetroRule): [string, number][] {
    return Object.entries(r.overrides ?? {});
  }

  protected openNew(): void {
    this.form.reset(blankRule());
    this.editing.set({ id: null });
  }

  protected openEdit(r: RetroRule): void {
    this.form.reset({
      practitionerId: r.practitionerId, basis: r.basis, ratePercent: r.ratePercent, deductLabFees: r.deductLabFees, fixedMonthlyAmount: r.fixedMonthlyAmount ?? 0,
      effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo ?? '', notes: r.notes ?? '', overrides: Object.entries(r.overrides ?? {}).map(([category, rate]) => ({ category, rate })),
    });
    this.editing.set({ id: r.id });
  }

  protected addOverride(): void {
    this.form.set('overrides', [...this.form.value().overrides, { category: '', rate: this.form.value().ratePercent }]);
  }

  protected removeOverride(index: number): void {
    this.form.set('overrides', this.form.value().overrides.filter((_, i) => i !== index));
  }

  protected setOverride(index: number, field: 'category' | 'rate', value: string | number): void {
    this.form.set('overrides', this.form.value().overrides.map((o, i) => (i === index ? { ...o, [field]: value } : o)));
  }

  protected async save(): Promise<void> {
    const target = this.editing();
    if (!target || this.busy() || this.problem()) {
      return;
    }
    const body = ruleRequest(this.form.value());
    await this.run(async () => {
      await (target.id ? this.api.updateRule(target.id, body) : this.api.createRule(body));
      this.editing.set(null);
      this.toast.success(this.translate.instant('RETRO.RULES.SAVED'));
    });
  }

  protected async remove(r: RetroRule): Promise<void> {
    if (!(await this.confirm.confirm(this.translate.instant('RETRO.RULES.DELETE_CONFIRM', { name: r.practitionerName }), { danger: true }))) {
      return;
    }
    await this.run(() => this.api.deleteRule(r.id));
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    try {
      await action();
      await this.rules.load(() => this.api.rules());
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.busy.set(false);
    }
  }
}
