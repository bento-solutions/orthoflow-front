import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ApiErrors } from '../../../core/services/api-error.service';
import { ConfirmDialogService } from '../../../core/services/confirm-dialog.service';
import { CashClosing, FinanceApi, PaymentMethod } from '../../../core/services/finance-api.service';
import { refreshOnLive } from '../../../core/services/live-refresh';
import { ToastService } from '../../../core/services/toast.service';
import { isoDate } from '../../../core/utils/format';
import { loadable } from '../../../core/utils/loadable';
import { CanDirective } from '../../../shared/directives/can.directive';
import { MoneyPipe } from '../../../shared/pipes/money.pipe';
import { IconComponent } from '../../../shared/ui/icon.component';

/** The difference between what was counted and what the receipts say, in whole cents. */
export function difference(counted: number | null | undefined, expected: number): number {
  // `|| 0` keeps a rounding residue from becoming -0, which would print as "-0,00".
  return Math.round(((counted ?? 0) - expected) * 100) / 100 || 0;
}

/** The date `days` before or after `date` (as `yyyy-MM-dd`), by calendar day rather than 24 hours, so a clock change does not skip one. */
export function shiftDay(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

/**
 * The daily cash close: for each payment method, what the receipts say should be there against
 * what was counted. The expected amounts come from the server, never from this form. A closed
 * day is final: it is shown as a record, with its differences, and cannot be reopened.
 */
@Component({
  selector: 'app-cash-closing',
  standalone: true,
  imports: [DatePipe, FormsModule, TranslateModule, MoneyPipe, IconComponent, CanDirective],
  template: `
    <div class="mb-5 flex flex-wrap items-center gap-2">
      <button type="button" class="btn btn-secondary btn-icon" (click)="go(-1)" [attr.aria-label]="'FIN.CASH.PREVIOUS_DAY' | translate"><app-icon name="chevron-left" [size]="16" /></button>
      <input class="input w-auto" type="date" [max]="today" [ngModel]="date()" (ngModelChange)="date.set($event || today)" [attr.aria-label]="'ACC.COL.DATE' | translate" />
      <button type="button" class="btn btn-secondary btn-icon" (click)="go(1)" [disabled]="date() >= today" [attr.aria-label]="'FIN.CASH.NEXT_DAY' | translate"><app-icon name="chevron-right" [size]="16" /></button>
      @if (date() !== today) { <button type="button" class="btn btn-ghost btn-sm" (click)="date.set(today)">{{ 'COMMON.TODAY' | translate }}</button> }
    </div>

    @if (closing.data(); as c) {
      <section class="card max-w-3xl" [attr.aria-busy]="closing.loading()">
        <div class="card-head">
          <div>
            <h2 class="text-lg font-bold text-ink-900">{{ c.date | date: 'fullDate' }}</h2>
            <p class="text-sm text-ink-500">{{ (c.closed ? 'FIN.CASH.CLOSED_AT' : 'FIN.CASH.OPEN_HINT') | translate: { at: (c.closedAt | date: 'short') } }}</p>
          </div>
          <span class="pill" [class.pill-done]="c.closed" [class.pill-attention]="!c.closed">{{ (c.closed ? 'FIN.CASH.CLOSED' : 'FIN.CASH.OPEN') | translate }}</span>
        </div>
        <div class="table-scroll">
          <table class="data-table">
            <thead><tr>
              <th scope="col">{{ 'ACC.COL.METHOD' | translate }}</th><th scope="col" class="cell-num">{{ 'FIN.CASH.EXPECTED' | translate }}</th>
              <th scope="col" class="cell-num">{{ 'FIN.CASH.COUNTED' | translate }}</th><th scope="col" class="cell-num">{{ 'FIN.CASH.DIFFERENCE' | translate }}</th>
            </tr></thead>
            <tbody>
              @for (line of c.lines; track line.method) {
                <tr>
                  <th scope="row" class="text-start font-semibold">{{ 'BILLING.METHODS.' + line.method | translate }}</th>
                  <td class="cell-num">{{ line.expected | money }}</td>
                  <td class="cell-num">
                    @if (c.closed) { {{ line.counted | money }} }
                    @else {
                      <input class="input w-36 text-end" type="number" min="0" step="0.01" [name]="'count-' + line.method" [attr.aria-label]="('BILLING.METHODS.' + line.method) | translate"
                        [ngModel]="counts()[line.method]" (ngModelChange)="setCount(line.method, $event)" />
                    }
                  </td>
                  <td class="cell-num font-semibold" [class.text-critical-700]="diff(line.method, line.expected, line.counted, c.closed) !== 0">
                    {{ diff(line.method, line.expected, line.counted, c.closed) | money }}
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="4" class="py-6 text-center text-ink-500">{{ 'FIN.CASH.NO_TAKINGS' | translate }}</td></tr>
              }
            </tbody>
            @if (c.lines.length) {
              <tfoot><tr class="font-bold">
                <th scope="row" class="text-start">{{ 'COMMON.TOTAL' | translate }}</th>
                <td class="cell-num">{{ totalExpected() | money }}</td><td class="cell-num">{{ totalCounted() | money }}</td>
                <td class="cell-num" [class.text-critical-700]="totalDifference() !== 0">{{ totalDifference() | money }}</td>
              </tr></tfoot>
            }
          </table>
        </div>
        <div class="space-y-3 border-t border-ink-100 p-4">
          @if (c.closed) {
            @if (c.notes) { <p class="text-sm text-ink-700"><span class="font-semibold">{{ 'COMMON.NOTES' | translate }} :</span> {{ c.notes }}</p> }
          } @else {
            <label class="field"><span class="label">{{ 'COMMON.NOTES' | translate }}</span><textarea class="textarea" rows="2" [ngModel]="notes()" (ngModelChange)="notes.set($event)"></textarea></label>
            <div class="flex items-center justify-between gap-3">
              <p class="text-sm" [class.text-critical-700]="totalDifference() !== 0" [class.text-ink-500]="totalDifference() === 0">{{ (totalDifference() === 0 ? 'FIN.CASH.BALANCED' : 'FIN.CASH.OFF') | translate: { amount: money(totalDifference()) } }}</p>
              <button *appCan="'FINANCE_MANAGE'" type="button" class="btn btn-primary" [disabled]="busy()" (click)="close()">{{ 'FIN.CASH.CLOSE' | translate }}</button>
            </div>
          }
        </div>
      </section>
    }
  `,
})
export class CashClosingComponent {
  private readonly api = inject(FinanceApi);
  private readonly errors = inject(ApiErrors);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly translate = inject(TranslateService);
  private readonly moneyPipe = new MoneyPipe();

  protected readonly today = isoDate(new Date());
  protected readonly date = signal(this.today);
  protected readonly closing = loadable<CashClosing | null>(null);
  protected readonly counts = signal<Partial<Record<PaymentMethod, number>>>({});
  protected readonly notes = signal('');
  protected readonly busy = signal(false);

  protected readonly totalExpected = computed(() => (this.closing.data()?.lines ?? []).reduce((s, l) => s + l.expected, 0));
  protected readonly totalCounted = computed(() => {
    const c = this.closing.data();
    return !c ? 0 : c.closed ? c.lines.reduce((s, l) => s + l.counted, 0) : c.lines.reduce((s, l) => s + (this.counts()[l.method] ?? 0), 0);
  });
  protected readonly totalDifference = computed(() => difference(this.totalCounted(), this.totalExpected()));

  constructor() {
    effect(() => {
      const date = this.date();
      untracked(() => void this.load(date));
    });
    refreshOnLive(['finance'], () => void this.load(this.date()));
  }

  protected money(amount: number): string {
    return this.moneyPipe.transform(amount);
  }

  private async load(date: string): Promise<void> {
    const ok = await this.closing.load(() => this.api.cashClosing(date));
    const c = this.closing.data();
    if (ok && c && c.date === date && !c.closed) {
      // Start from what the receipts say, which is right when nothing is off; the cashier changes what is.
      this.counts.update(existing => Object.fromEntries(c.lines.map(l => [l.method, existing[l.method] ?? l.expected])));
      this.notes.set('');
    }
  }

  protected go(days: number): void {
    const next = shiftDay(this.date(), days);
    if (next <= this.today) {
      this.date.set(next);
    }
  }

  protected setCount(method: PaymentMethod, value: number | null): void {
    this.counts.update(c => ({ ...c, [method]: value ?? 0 }));
  }

  protected diff(method: PaymentMethod, expected: number, counted: number, closed: boolean): number {
    return difference(closed ? counted : this.counts()[method], expected);
  }

  protected async close(): Promise<void> {
    const c = this.closing.data();
    if (!c || c.closed || this.busy()) {
      return;
    }
    const off = this.totalDifference() !== 0;
    const message = this.translate.instant(off ? 'FIN.CASH.CONFIRM_OFF' : 'FIN.CASH.CONFIRM', { amount: this.money(this.totalDifference()) });
    if (!(await this.confirm.confirm(message, { danger: off }))) {
      return;
    }
    this.busy.set(true);
    try {
      await this.api.closeCash({
        date: c.date,
        counts: c.lines.map(l => ({ method: l.method, counted: this.counts()[l.method] ?? 0 })),
        notes: this.notes().trim() || undefined,
      });
      this.toast.success(this.translate.instant('FIN.CASH.DONE'));
      await this.load(c.date);
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.busy.set(false);
    }
  }
}
