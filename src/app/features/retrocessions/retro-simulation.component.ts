import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AnalyticsApi, INVOICE_STATUSES, InvoiceStatus, RetroFigures, RetroSimulation } from '../../core/services/analytics-api.service';
import { ApiErrors } from '../../core/services/api-error.service';
import { PAYMENT_METHODS, PaymentMethod } from '../../core/services/finance-api.service';
import { PractitionerService } from '../../core/services/practitioner.service';
import { ToastService } from '../../core/services/toast.service';
import { Period, periodFor } from '../../core/utils/format';
import { loadable } from '../../core/utils/loadable';
import { CanDirective } from '../../shared/directives/can.directive';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { ExportMenuComponent } from '../../shared/ui/export-menu.component';
import { ModalComponent } from '../../shared/ui/modal.component';
import { PeriodPickerComponent } from '../../shared/ui/period-picker.component';

/** Toggles `value` in a list, keeping the order of {@code all} so the same choices always produce the same request. */
export function toggled<T>(selected: readonly T[], value: T, all: readonly T[]): T[] {
  const next = new Set(selected);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return all.filter(v => next.has(v));
}

/**
 * What each doctor would be owed for a period, line by line, before anything is written. The same
 * calculator produces the statement when it is validated, so the figures here are the figures
 * there. The filters narrow what counts (which payment methods, which invoice states); an empty
 * choice means everything. Invoices with no doctor on them are listed apart and never guessed at.
 */
@Component({
  selector: 'app-retro-simulation',
  standalone: true,
  imports: [DatePipe, FormsModule, RouterLink, TranslateModule, MoneyPipe, ExportMenuComponent, ModalComponent, PeriodPickerComponent, CanDirective],
  template: `
    <div class="mb-4 flex flex-wrap items-end gap-3">
      <app-period-picker [value]="period()" (valueChange)="period.set($event)" [presets]="presets" />
      <label class="field w-auto"><span class="label">{{ 'COMMON.PRACTITIONER' | translate }}</span>
        <select class="select w-auto" [ngModel]="practitionerId()" (ngModelChange)="practitionerId.set($event)">
          <option value="">{{ 'COMMON.ALL_PRACTITIONERS' | translate }}</option>
          @for (p of practitioners.active(); track p.id) { <option [value]="p.id">{{ p.displayName }}</option> }
        </select></label>
      <app-export-menu class="ms-auto" path="/retrocessions/simulation/export" [query]="exportQuery()" fallbackName="retrocessions" />
    </div>
    <details class="mb-4 text-sm">
      <summary class="cursor-pointer font-semibold text-ink-700">{{ 'RETRO.SIM.FILTERS' | translate }}@if (methods().length || statuses().length) { <span class="ms-2 pill pill-active pill-nodot">{{ methods().length + statuses().length }}</span> }</summary>
      <div class="mt-3 grid gap-4 sm:grid-cols-2">
        <fieldset><legend class="label">{{ 'RETRO.SIM.METHODS' | translate }}</legend>
          <div class="flex flex-wrap gap-3">@for (m of allMethods; track m) { <label class="flex items-center gap-1.5"><input type="checkbox" [checked]="methods().includes(m)" (change)="methods.set(toggle(methods(), m, allMethods))" /> {{ 'BILLING.METHODS.' + m | translate }}</label> }</div></fieldset>
        <fieldset><legend class="label">{{ 'RETRO.SIM.STATUSES' | translate }}</legend>
          <div class="flex flex-wrap gap-3">@for (s of allStatuses; track s) { <label class="flex items-center gap-1.5"><input type="checkbox" [checked]="statuses().includes(s)" (change)="statuses.set(toggle(statuses(), s, allStatuses))" /> {{ 'BILLING.STATUS.' + s | translate }}</label> }</div></fieldset>
      </div>
      <p class="mt-2 text-xs text-ink-500">{{ 'RETRO.SIM.FILTERS_HINT' | translate }}</p>
    </details>

    @if (sim.data(); as s) {
      <section class="mb-5 grid grid-cols-2 gap-3" [attr.aria-busy]="sim.loading()">
        <div class="tile p-4"><p class="kpi-label">{{ 'RETRO.GROSS' | translate }}</p><p class="kpi-value">{{ s.totalGross | money }}</p></div>
        <div class="tile p-4"><p class="kpi-label">{{ 'RETRO.NET' | translate }}</p><p class="kpi-value">{{ s.totalNet | money }}</p></div>
      </section>

      @if (s.unattributed.invoiceCount > 0) {
        <section class="mb-5 rounded-lg border border-caution-200 bg-caution-50 p-4" role="note">
          <p class="font-semibold text-caution-800">{{ 'RETRO.SIM.UNATTRIBUTED' | translate: { count: s.unattributed.invoiceCount, amount: money(s.unattributed.amount) } }}</p>
          <p class="text-sm text-caution-800">{{ 'RETRO.SIM.UNATTRIBUTED_HINT' | translate }}</p>
          <ul class="mt-2 flex flex-wrap gap-2 text-sm">@for (i of s.unattributed.invoices; track i.invoiceId) { <li><a class="rounded border border-caution-300 bg-surface px-2 py-0.5 text-ink-800 no-underline hover:bg-caution-100" [routerLink]="['/billing/invoices', i.invoiceId]">{{ i.invoiceNumber }} · {{ i.amount | money }}</a></li> }</ul>
        </section>
      }

      @for (f of s.practitioners; track f.practitionerId) {
        <article class="card mb-4">
          <div class="card-head">
            <h2 class="text-lg font-bold text-ink-900">{{ f.practitionerName }}</h2>
            <button *appCan="'RETROCESSION_MANAGE'" type="button" class="btn btn-primary btn-sm" (click)="openValidate(f)">{{ 'RETRO.SIM.VALIDATE' | translate }}</button>
          </div>
          <dl class="grid grid-cols-2 gap-x-6 gap-y-2 px-4 py-3 text-sm sm:grid-cols-4">
            <div><dt class="text-ink-500">{{ 'RETRO.BASE' | translate }}</dt><dd class="font-semibold tabular-nums">{{ f.base | money }}</dd></div>
            <div><dt class="text-ink-500">{{ 'RETRO.LAB' | translate }}</dt><dd class="font-semibold tabular-nums">−{{ f.labDeduction | money }}</dd></div>
            <div><dt class="text-ink-500">{{ 'RETRO.VARIABLE' | translate }}</dt><dd class="font-semibold tabular-nums">{{ f.variable | money }}</dd></div>
            <div><dt class="text-ink-500">{{ 'RETRO.FIXED' | translate }}</dt><dd class="font-semibold tabular-nums">{{ f.fixed | money }}</dd></div>
            <div><dt class="text-ink-500">{{ 'RETRO.ADJUSTMENT' | translate }}</dt><dd class="font-semibold tabular-nums">{{ f.adjustment | money }}</dd></div>
            <div><dt class="text-ink-500">{{ 'RETRO.GROSS' | translate }}</dt><dd class="font-bold tabular-nums">{{ f.gross | money }}</dd></div>
            <div><dt class="text-ink-500">{{ 'RETRO.ADVANCES_APPLIED' | translate }}</dt><dd class="font-semibold tabular-nums">−{{ f.advancesApplied | money }}</dd></div>
            <div><dt class="text-ink-500">{{ 'RETRO.NET' | translate }}</dt><dd class="text-base font-extrabold tabular-nums text-petrol-700">{{ f.net | money }}</dd></div>
          </dl>
          @if (f.advancesOutstanding > 0) { <p class="px-4 pb-2 text-xs text-ink-500">{{ 'RETRO.SIM.ADVANCES_LEFT' | translate: { amount: money(f.advancesOutstanding - f.advancesApplied) } }}</p> }
          <details class="border-t border-ink-100">
            <summary class="cursor-pointer px-4 py-2 text-sm font-semibold text-ink-700">{{ 'RETRO.SIM.LINES' | translate: { count: f.lines.length } }}</summary>
            <div class="table-scroll">
              <table class="data-table">
                <thead><tr><th scope="col">{{ 'ACC.COL.DATE' | translate }}</th><th scope="col">{{ 'RETRO.LINE.INVOICE' | translate }}</th><th scope="col">{{ 'RETRO.LINE.LABEL' | translate }}</th><th scope="col" class="cell-num">{{ 'RETRO.LINE.BASE' | translate }}</th><th scope="col" class="cell-num">%</th><th scope="col" class="cell-num">{{ 'ACC.COL.AMOUNT' | translate }}</th></tr></thead>
                <tbody>
                  @for (l of f.lines; track $index) {
                    <tr>
                      <td>{{ l.date | date: 'shortDate' }}</td>
                      <td>@if (l.invoiceId) { <a class="no-underline hover:text-petrol-700" [routerLink]="['/billing/invoices', l.invoiceId]">{{ l.invoiceNumber }}</a> }<span class="block text-xs text-ink-500 mono">{{ l.patientCode }}</span></td>
                      <td>{{ l.label }}@if (l.category) { <span class="block text-xs text-ink-500">{{ l.category }}</span> }<span class="block text-2xs uppercase tracking-wider text-ink-400">{{ 'RETRO.LINE.KINDS.' + l.kind | translate }}</span></td>
                      <td class="cell-num">{{ l.base | money }}</td>
                      <td class="cell-num">{{ l.ratePercent ?? '—' }}</td>
                      <td class="cell-num font-semibold" [class.text-critical-700]="l.amount < 0">{{ l.amount | money }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </details>
        </article>
      } @empty {
        <p class="py-8 text-center text-ink-500">{{ 'RETRO.SIM.EMPTY' | translate }}</p>
      }
    }

    <app-modal [open]="validating() !== null" [title]="'RETRO.SIM.VALIDATE_TITLE' | translate" size="sm" [dismissable]="!busy()" (closed)="validating.set(null)">
      @if (validating(); as f) {
        <form id="validate-form" class="space-y-3" (ngSubmit)="validate()">
          <p class="text-sm text-ink-700"><strong>{{ f.practitionerName }}</strong> · {{ period().from | date: 'mediumDate' }} → {{ period().to | date: 'mediumDate' }}</p>
          <p class="rounded-md bg-ink-50 p-3 text-sm text-ink-700">{{ 'RETRO.SIM.VALIDATE_HINT' | translate: { amount: money(f.net) } }}</p>
          <label class="field"><span class="label">{{ 'COMMON.NOTES' | translate }}</span><textarea class="textarea" rows="2" name="notes" [ngModel]="notes()" (ngModelChange)="notes.set($event)"></textarea></label>
        </form>
      }
      <div modal-footer>
        <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="validating.set(null)">{{ 'COMMON.CANCEL' | translate }}</button>
        <button type="submit" form="validate-form" class="btn btn-primary" [disabled]="busy()">{{ 'RETRO.SIM.VALIDATE' | translate }}</button>
      </div>
    </app-modal>
  `,
  styles: [`
    .kpi-label { font-size: var(--text-2xs); font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-muted); }
    .kpi-value { margin-top: 0.25rem; font-size: var(--text-xl); font-weight: 800; color: var(--text); font-variant-numeric: tabular-nums; }
  `],
})
export class RetroSimulationComponent {
  private readonly api = inject(AnalyticsApi);
  private readonly errors = inject(ApiErrors);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private readonly moneyPipe = new MoneyPipe();
  protected readonly practitioners = inject(PractitionerService);

  protected readonly presets: ('month' | 'lastMonth' | 'quarter' | 'year' | 'lastYear')[] = ['month', 'lastMonth', 'quarter', 'year', 'lastYear'];
  protected readonly allMethods = PAYMENT_METHODS;
  protected readonly allStatuses = INVOICE_STATUSES;
  protected readonly toggle = toggled;
  protected readonly period = signal<Period>(periodFor('lastMonth'));
  protected readonly practitionerId = signal('');
  protected readonly methods = signal<PaymentMethod[]>([]);
  protected readonly statuses = signal<InvoiceStatus[]>([]);
  protected readonly sim = loadable<RetroSimulation | null>(null);

  protected readonly busy = signal(false);
  protected readonly validating = signal<RetroFigures | null>(null);
  protected readonly notes = signal('');

  private readonly query = computed(() => ({
    ...this.period(), practitionerId: this.practitionerId() || undefined, method: this.methods().length ? this.methods() : undefined, status: this.statuses().length ? this.statuses() : undefined,
  }));
  protected readonly exportQuery = computed(() => ({ ...this.query() }) as Record<string, string | readonly string[] | undefined>);

  constructor() {
    effect(() => {
      const query = this.query();
      untracked(() => void this.sim.load(() => this.api.simulation(query)));
    });
  }

  protected money(amount: number): string {
    return this.moneyPipe.transform(amount);
  }

  protected openValidate(f: RetroFigures): void {
    this.notes.set('');
    this.validating.set(f);
  }

  protected async validate(): Promise<void> {
    const f = this.validating();
    if (!f || this.busy()) {
      return;
    }
    this.busy.set(true);
    try {
      const statement = await this.api.validateStatement({
        practitionerId: f.practitionerId, from: this.period().from, to: this.period().to,
        methods: this.methods().length ? this.methods() : undefined, statuses: this.statuses().length ? this.statuses() : undefined, notes: this.notes().trim() || undefined,
      });
      this.validating.set(null);
      this.toast.success(this.translate.instant('RETRO.SIM.VALIDATED', { number: statement.number }));
      await this.sim.load(() => this.api.simulation(this.query()));
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.busy.set(false);
    }
  }
}
