import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ApiErrors } from '../../../core/services/api-error.service';
import { DueInstalment, FinanceApi, PAYMENT_METHODS, PaymentMethod } from '../../../core/services/finance-api.service';
import { refreshOnLive } from '../../../core/services/live-refresh';
import { ToastService } from '../../../core/services/toast.service';
import { formState } from '../../../core/utils/form-state';
import { isoDate } from '../../../core/utils/format';
import { loadable } from '../../../core/utils/loadable';
import { CanDirective } from '../../../shared/directives/can.directive';
import { MoneyPipe } from '../../../shared/pipes/money.pipe';
import { ModalComponent } from '../../../shared/ui/modal.component';

/**
 * Payment-plan instalments that are due, the overdue ones first: the list the desk works down to
 * ask patients for what they agreed to pay. Taking a payment here goes through the patient's
 * account like any other, so receipts, credit and balances stay in step.
 */
@Component({
  selector: 'app-instalments',
  standalone: true,
  imports: [DatePipe, FormsModule, RouterLink, TranslateModule, MoneyPipe, ModalComponent, CanDirective],
  template: `
    <div class="mb-4 flex flex-wrap items-end gap-3">
      <label class="field w-auto"><span class="label">{{ 'FIN.INST.UNTIL' | translate }}</span>
        <input class="input" type="date" [ngModel]="until()" (ngModelChange)="until.set($event)" /></label>
      <p class="pb-2 text-sm text-ink-600" role="status">{{ 'FIN.INST.SUMMARY' | translate: { count: due.data().length, overdue: overdueCount() } }}</p>
    </div>
    <div class="table-wrap" [attr.aria-busy]="due.loading()"><div class="table-scroll">
      <table class="data-table">
        <thead><tr>
          <th scope="col">{{ 'COMMON.PATIENT' | translate }}</th><th scope="col">{{ 'ACC.PLAN.COL.SEQ' | translate }}</th><th scope="col">{{ 'ACC.PLAN.COL.DUE' | translate }}</th>
          <th scope="col" class="cell-num">{{ 'ACC.COL.BALANCE' | translate }}</th><th scope="col" class="cell-actions"><span class="sr-only">{{ 'COMMON.ACTIONS' | translate }}</span></th>
        </tr></thead>
        <tbody>
          @for (d of due.data(); track d.instalmentId) {
            <tr>
              <td><a class="font-bold text-ink-900 no-underline hover:text-petrol-700" [routerLink]="['/patients', d.patientId]">{{ d.patientName }}</a>
                @if (d.patientPhone) { <a class="block text-xs text-ink-500" [href]="'tel:' + d.patientPhone">{{ d.patientPhone }}</a> }</td>
              <td>{{ d.seq === 0 ? ('ACC.PLAN.DOWN' | translate) : d.seq }}</td>
              <td>{{ d.dueDate | date: 'mediumDate' }}
                @if (d.daysOverdue > 0) { <span class="pill pill-critical pill-nodot ms-2">{{ 'FIN.INST.LATE' | translate: { days: d.daysOverdue } }}</span> }</td>
              <td class="cell-num font-semibold">{{ d.remaining | money }}</td>
              <td class="cell-actions"><button *appCan="'BILLING_WRITE'" type="button" class="btn btn-secondary btn-sm" (click)="open(d)">{{ 'ACC.PLAN.PAY' | translate }}</button></td>
            </tr>
          } @empty {
            <tr><td colspan="5" class="py-8 text-center text-ink-500">{{ 'FIN.INST.EMPTY' | translate }}</td></tr>
          }
        </tbody>
      </table>
    </div></div>

    <app-modal [open]="paying() !== null" [title]="'ACC.PLAN.PAY_TITLE' | translate: { seq: paying()?.seq ?? '' }" size="sm" [dismissable]="!busy()" (closed)="paying.set(null)">
      <form id="due-form" class="space-y-4" (ngSubmit)="submit()">
        <p class="text-sm text-ink-700"><strong>{{ paying()?.patientName }}</strong></p>
        <label class="field"><span class="label">{{ 'ACC.FORM.AMOUNT' | translate }}</span>
          <input class="input" type="number" min="0.01" [max]="paying()?.remaining" step="0.01" name="amount" required [ngModel]="form.value().amount || null" (ngModelChange)="form.set('amount', +$event || 0)" /></label>
        <label class="field"><span class="label">{{ 'ACC.FORM.METHOD' | translate }}</span>
          <select class="select" name="method" [ngModel]="form.value().method" (ngModelChange)="form.set('method', $event)">
            @for (m of methods; track m) { <option [value]="m">{{ 'BILLING.METHODS.' + m | translate }}</option> }
          </select></label>
      </form>
      <div modal-footer>
        <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="paying.set(null)">{{ 'COMMON.CANCEL' | translate }}</button>
        <button type="submit" form="due-form" class="btn btn-primary" [disabled]="busy() || form.value().amount <= 0 || form.value().amount > (paying()?.remaining ?? 0)">{{ 'ACC.FORM.SUBMIT' | translate }}</button>
      </div>
    </app-modal>
  `,
})
export class InstalmentsComponent {
  private readonly api = inject(FinanceApi);
  private readonly errors = inject(ApiErrors);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);

  protected readonly methods = PAYMENT_METHODS;
  protected readonly until = signal(isoDate(new Date(Date.now() + 7 * 86_400_000)));
  protected readonly due = loadable<DueInstalment[]>([]);
  protected readonly overdueCount = computed(() => this.due.data().filter(d => d.daysOverdue > 0).length);
  protected readonly paying = signal<DueInstalment | null>(null);
  protected readonly busy = signal(false);
  protected readonly form = formState<{ amount: number; method: PaymentMethod }>({ amount: 0, method: 'CASH' });

  constructor() {
    effect(() => {
      const until = this.until();
      untracked(() => void this.due.load(() => this.api.duePlans(until)));
    });
    refreshOnLive(['finance'], () => void this.due.load(() => this.api.duePlans(this.until())));
  }

  protected open(d: DueInstalment): void {
    this.form.reset({ amount: d.remaining, method: 'CASH' });
    this.paying.set(d);
  }

  protected async submit(): Promise<void> {
    const target = this.paying();
    const { amount, method } = this.form.value();
    if (!target || this.busy() || amount <= 0 || amount > target.remaining) {
      return;
    }
    this.busy.set(true);
    try {
      await this.api.payInstalment(target.instalmentId, { amount, method });
      this.paying.set(null);
      this.toast.success(this.translate.instant('ACC.PLAN.PAY_DONE'));
      await this.due.load(() => this.api.duePlans(this.until()));
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.busy.set(false);
    }
  }
}
