import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ApiErrors } from '../../../core/services/api-error.service';
import { ConfirmDialogService } from '../../../core/services/confirm-dialog.service';
import { Account, FinanceApi, PAYMENT_METHODS, PLAN_FREQUENCIES, PaymentMethod, PaymentPlan, Receipt } from '../../../core/services/finance-api.service';
import { refreshOnLive } from '../../../core/services/live-refresh';
import { PractitionerService } from '../../../core/services/practitioner.service';
import { ToastService } from '../../../core/services/toast.service';
import { formState } from '../../../core/utils/form-state';
import { isoDate } from '../../../core/utils/format';
import { loadable } from '../../../core/utils/loadable';
import { CanDirective } from '../../../shared/directives/can.directive';
import { MoneyPipe } from '../../../shared/pipes/money.pipe';
import { IconComponent } from '../../../shared/ui/icon.component';
import { ModalComponent } from '../../../shared/ui/modal.component';
import { StatusPillComponent } from '../../../shared/ui/status-pill.component';
import { ReceiptForm, SettleMode, openInvoices, planRequest, planSchedule, receiptRequest, settle } from './account-logic';

const emptyReceipt = (): ReceiptForm => ({
  amount: 0, method: 'CASH', date: isoDate(new Date()), practitionerId: '', reference: '', notes: '', mode: 'AUTO',
  chequeNumber: '', chequeBank: '', chequeDrawer: '', chequeDue: '',
});

const emptyPlan = () => ({ total: 0, down: 0, count: 6, frequency: 'MONTHLY' as (typeof PLAN_FREQUENCIES)[number], start: isoDate(new Date()), invoiceId: '', notes: '' });

/**
 * What a patient owes and has paid: the invoices with their balances, the payments received (and
 * how each was spread over the invoices), the credit left over, and the payment plans.
 *
 * A payment is a receipt. It can settle several invoices, or none, in which case it stays with the
 * patient as credit that a later invoice can use. A receipt is never edited or deleted: a mistake
 * is voided, with a reason, and stays in the history.
 */
@Component({
  selector: 'app-patient-account',
  standalone: true,
  imports: [DatePipe, FormsModule, RouterLink, TranslateModule, MoneyPipe, IconComponent, ModalComponent, StatusPillComponent, CanDirective],
  template: `
    <div class="space-y-6" [attr.aria-busy]="account.loading()">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="text-lg font-bold text-ink-900">{{ 'ACC.TITLE' | translate }}</h2>
        <div class="flex flex-wrap gap-2">
          <button *appCan="'BILLING_WRITE'" type="button" class="btn btn-primary btn-sm" (click)="openReceipt()"><app-icon name="wallet" [size]="15" /> {{ 'ACC.RECORD' | translate }}</button>
          @if (hasCredit() && open().length > 0) {
            <button *appCan="'BILLING_WRITE'" type="button" class="btn btn-secondary btn-sm" (click)="openCredit()">{{ 'ACC.APPLY_CREDIT' | translate }}</button>
          }
          <a *appCan="'BILLING_WRITE'" class="btn btn-secondary btn-sm" routerLink="/billing/invoices/create" [queryParams]="{ patientId: patientId() }"><app-icon name="plus" [size]="15" /> {{ 'ACC.NEW_INVOICE' | translate }}</a>
        </div>
      </div>

      @if (account.data(); as a) {
        <section class="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div class="tile p-4"><p class="kpi-label">{{ 'ACC.INVOICED' | translate }}</p><p class="kpi-value">{{ a.totalInvoiced | money }}</p></div>
          <div class="tile p-4"><p class="kpi-label">{{ 'ACC.PAID' | translate }}</p><p class="kpi-value">{{ a.totalPaid | money }}</p></div>
          <div class="tile p-4"><p class="kpi-label">{{ 'ACC.BALANCE' | translate }}</p><p class="kpi-value" [class.text-critical-700]="a.balanceDue > 0">{{ a.balanceDue | money }}</p></div>
          <div class="tile p-4"><p class="kpi-label">{{ 'ACC.CREDIT' | translate }}</p><p class="kpi-value" [class.text-positive-700]="a.creditAvailable > 0">{{ a.creditAvailable | money }}</p></div>
        </section>

        <section>
          <h3 class="section-title">{{ 'ACC.INVOICES' | translate }}</h3>
          <div class="table-wrap"><div class="table-scroll">
            <table class="data-table">
              <thead><tr>
                <th scope="col">{{ 'ACC.COL.NUMBER' | translate }}</th><th scope="col">{{ 'ACC.COL.DATE' | translate }}</th><th scope="col">{{ 'COMMON.STATUS' | translate }}</th>
                <th scope="col" class="cell-num">{{ 'ACC.COL.TOTAL' | translate }}</th><th scope="col" class="cell-num">{{ 'ACC.COL.PAID' | translate }}</th><th scope="col" class="cell-num">{{ 'ACC.COL.BALANCE' | translate }}</th>
                <th scope="col" class="cell-actions"><span class="sr-only">{{ 'COMMON.ACTIONS' | translate }}</span></th>
              </tr></thead>
              <tbody>
                @for (i of a.invoices; track i.id) {
                  <tr>
                    <td><a class="font-bold text-ink-900 no-underline hover:text-petrol-700" [routerLink]="['/billing/invoices', i.id]">{{ i.invoiceNumber }}</a></td>
                    <td>{{ i.issueDate | date: 'mediumDate' }}</td>
                    <td><app-status-pill [status]="i.status" /></td>
                    <td class="cell-num">{{ i.total | money }}</td>
                    <td class="cell-num">{{ i.paid | money }}</td>
                    <td class="cell-num" [class.font-bold]="i.balance > 0">{{ i.balance | money }}</td>
                    <td class="cell-actions">
                      @if (i.balance > 0 && i.status !== 'CANCELLED') {
                        <button *appCan="'BILLING_WRITE'" type="button" class="btn btn-secondary btn-sm" (click)="openReceipt(i.id, i.balance)" [attr.aria-label]="'ACC.PAY_INVOICE' | translate: { number: i.invoiceNumber }">{{ 'ACC.RECORD' | translate }}</button>
                      }
                    </td>
                  </tr>
                } @empty {
                  <tr><td colspan="7" class="py-6 text-center text-ink-500">{{ 'ACC.NO_INVOICES' | translate }}</td></tr>
                }
              </tbody>
            </table>
          </div></div>
        </section>

        <section>
          <h3 class="section-title">{{ 'ACC.RECEIPTS' | translate }}</h3>
          <div class="table-wrap"><div class="table-scroll">
            <table class="data-table">
              <thead><tr>
                <th scope="col">{{ 'ACC.COL.DATE' | translate }}</th><th scope="col">{{ 'ACC.COL.METHOD' | translate }}</th><th scope="col">{{ 'ACC.COL.REFERENCE' | translate }}</th>
                <th scope="col" class="cell-num">{{ 'ACC.COL.AMOUNT' | translate }}</th><th scope="col" class="cell-num">{{ 'ACC.COL.USED' | translate }}</th><th scope="col" class="cell-num">{{ 'ACC.COL.AVAILABLE' | translate }}</th>
                <th scope="col" class="cell-actions"><span class="sr-only">{{ 'COMMON.ACTIONS' | translate }}</span></th>
              </tr></thead>
              <tbody>
                @for (r of a.receipts; track r.id) {
                  <tr [class.opacity-60]="r.voided">
                    <td>{{ r.receiptDate | date: 'mediumDate' }}</td>
                    <td>{{ 'BILLING.METHODS.' + r.method | translate }}</td>
                    <td>
                      {{ r.reference || '—' }}
                      @if (r.allocations.length) { <span class="block text-xs text-ink-500">{{ allocationText(r) }}</span> }
                      @if (r.voided) { <span class="block text-xs text-critical-700">{{ 'ACC.VOIDED' | translate }}@if (r.voidReason) { : {{ r.voidReason }} }</span> }
                    </td>
                    <td class="cell-num" [class.line-through]="r.voided">{{ r.amount | money }}</td>
                    <td class="cell-num">{{ r.allocated | money }}</td>
                    <td class="cell-num">{{ r.voided ? '—' : (r.unallocated | money) }}</td>
                    <td class="cell-actions">
                      @if (!r.voided) {
                        <button *appCan="'FINANCE_MANAGE'" type="button" class="btn btn-ghost btn-sm" (click)="openVoid(r)">{{ 'ACC.VOID' | translate }}</button>
                      }
                    </td>
                  </tr>
                } @empty {
                  <tr><td colspan="7" class="py-6 text-center text-ink-500">{{ 'ACC.NO_RECEIPTS' | translate }}</td></tr>
                }
              </tbody>
            </table>
          </div></div>
        </section>
      }

      <section>
        <div class="mb-2 flex items-center justify-between">
          <h3 class="section-title !mb-0">{{ 'ACC.PLANS' | translate }}</h3>
          <button *appCan="'BILLING_WRITE'" type="button" class="btn btn-secondary btn-sm" (click)="openPlan()"><app-icon name="plus" [size]="14" /> {{ 'ACC.PLAN.NEW' | translate }}</button>
        </div>
        @for (p of plans.data(); track p.id) {
          <article class="card mb-3">
            <div class="card-head">
              <div>
                <p class="font-semibold text-ink-900">{{ p.total | money }} · {{ 'ACC.PLAN.FREQUENCIES.' + p.frequency | translate }}</p>
                <p class="text-xs text-ink-500">{{ 'ACC.PLAN.PROGRESS' | translate: { paid: money(p.paid), remaining: money(p.remaining) } }}</p>
              </div>
              <div class="flex items-center gap-2">
                <app-status-pill [status]="p.status" />
                @if (p.status === 'ACTIVE') {
                  <button *appCan="'FINANCE_MANAGE'" type="button" class="btn btn-ghost btn-sm" (click)="cancelPlan(p)">{{ 'ACC.PLAN.CANCEL' | translate }}</button>
                }
              </div>
            </div>
            <div class="table-scroll">
              <table class="data-table">
                <thead><tr>
                  <th scope="col">{{ 'ACC.PLAN.COL.SEQ' | translate }}</th><th scope="col">{{ 'ACC.PLAN.COL.DUE' | translate }}</th>
                  <th scope="col" class="cell-num">{{ 'ACC.PLAN.COL.AMOUNT' | translate }}</th><th scope="col" class="cell-num">{{ 'ACC.PLAN.COL.PAID' | translate }}</th>
                  <th scope="col">{{ 'COMMON.STATUS' | translate }}</th><th scope="col" class="cell-actions"><span class="sr-only">{{ 'COMMON.ACTIONS' | translate }}</span></th>
                </tr></thead>
                <tbody>
                  @for (i of p.instalments; track i.id) {
                    <tr>
                      <td>{{ i.seq === 0 ? ('ACC.PLAN.DOWN' | translate) : i.seq }}</td>
                      <td>{{ i.dueDate | date: 'mediumDate' }}@if (i.overdue) { <span class="pill pill-critical pill-nodot ms-2">{{ 'ACC.PLAN.OVERDUE' | translate }}</span> }</td>
                      <td class="cell-num">{{ i.amount | money }}</td>
                      <td class="cell-num">{{ i.paidAmount | money }}</td>
                      <td><app-status-pill [status]="i.status" /></td>
                      <td class="cell-actions">
                        @if (p.status === 'ACTIVE' && i.status === 'PENDING') {
                          <button *appCan="'BILLING_WRITE'" type="button" class="btn btn-secondary btn-sm" (click)="openInstalment(p, i)">{{ 'ACC.PLAN.PAY' | translate }}</button>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </article>
        } @empty {
          @if (!plans.loading()) { <p class="text-sm text-ink-500">{{ 'ACC.NO_PLANS' | translate }}</p> }
        }
      </section>
    </div>

    <!-- Take a payment -->
    <app-modal [open]="receiptOpen()" [title]="'ACC.FORM.TITLE' | translate" size="lg" [dismissable]="!busy()" (closed)="receiptOpen.set(false)">
      <form id="receipt-form" class="space-y-4" (ngSubmit)="submitReceipt()">
        <div class="grid gap-4 sm:grid-cols-3">
          <label class="field"><span class="label label-required">{{ 'ACC.FORM.AMOUNT' | translate }}</span>
            <input class="input" type="number" min="0.01" step="0.01" name="amount" required [ngModel]="receipt.value().amount || null" (ngModelChange)="receipt.set('amount', +$event || 0)" /></label>
          <label class="field"><span class="label">{{ 'ACC.FORM.METHOD' | translate }}</span>
            <select class="select" name="method" [ngModel]="receipt.value().method" (ngModelChange)="receipt.set('method', $event)">
              @for (m of methods; track m) { <option [value]="m">{{ 'BILLING.METHODS.' + m | translate }}</option> }
            </select></label>
          <label class="field"><span class="label">{{ 'ACC.FORM.DATE' | translate }}</span>
            <input class="input" type="date" name="date" required [max]="today" [ngModel]="receipt.value().date" (ngModelChange)="receipt.set('date', $event)" /></label>
        </div>
        @if (receipt.value().method === 'CHEQUE') {
          <div class="grid gap-4 sm:grid-cols-4">
            <label class="field"><span class="label">{{ 'ACC.FORM.CHEQUE_NUMBER' | translate }}</span><input class="input" name="chequeNumber" [ngModel]="receipt.value().chequeNumber" (ngModelChange)="receipt.set('chequeNumber', $event)" /></label>
            <label class="field"><span class="label">{{ 'ACC.FORM.CHEQUE_BANK' | translate }}</span><input class="input" name="chequeBank" [ngModel]="receipt.value().chequeBank" (ngModelChange)="receipt.set('chequeBank', $event)" /></label>
            <label class="field"><span class="label">{{ 'ACC.FORM.CHEQUE_DRAWER' | translate }}</span><input class="input" name="chequeDrawer" [ngModel]="receipt.value().chequeDrawer" (ngModelChange)="receipt.set('chequeDrawer', $event)" /></label>
            <label class="field"><span class="label">{{ 'ACC.FORM.CHEQUE_DUE' | translate }}</span><input class="input" type="date" name="chequeDue" [ngModel]="receipt.value().chequeDue" (ngModelChange)="receipt.set('chequeDue', $event)" /></label>
          </div>
        }
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="field"><span class="label">{{ 'ACC.FORM.PRACTITIONER' | translate }}</span>
            <select class="select" name="practitioner" [ngModel]="receipt.value().practitionerId" (ngModelChange)="receipt.set('practitionerId', $event)">
              <option value="">—</option>@for (p of practitioners.active(); track p.id) { <option [value]="p.id">{{ p.displayName }}</option> }
            </select></label>
          <label class="field"><span class="label">{{ 'ACC.FORM.REFERENCE' | translate }}</span><input class="input" name="reference" [ngModel]="receipt.value().reference" (ngModelChange)="receipt.set('reference', $event)" /></label>
        </div>

        <fieldset class="field">
          <legend class="label">{{ 'ACC.FORM.SETTLE' | translate }}</legend>
          <div class="flex flex-wrap gap-4 text-sm">
            @for (m of modes; track m) {
              <label class="inline-flex items-center gap-2"><input type="radio" name="mode" [checked]="receipt.value().mode === m" [disabled]="m !== 'ADVANCE' && open().length === 0" (change)="receipt.set('mode', m)" /> {{ 'ACC.FORM.' + m | translate }}</label>
            }
          </div>
          @if (open().length === 0) { <span class="hint">{{ 'ACC.FORM.NO_OPEN' | translate }}</span> }
        </fieldset>

        @if (receipt.value().mode === 'CHOOSE') {
          <div class="table-wrap"><div class="table-scroll">
            <table class="data-table">
              <tbody>
                @for (i of open(); track i.id) {
                  <tr>
                    <td class="font-semibold">{{ i.invoiceNumber }}</td>
                    <td class="cell-num">{{ i.balance | money }}</td>
                    <td class="w-40"><input class="input" type="number" min="0" [max]="i.balance" step="0.01" [name]="'alloc-' + i.id" [attr.aria-label]="i.invoiceNumber"
                      [ngModel]="chosen()[i.id] || null" (ngModelChange)="choose(i.id, +$event || 0)" /></td>
                    <td class="cell-actions"><button type="button" class="btn btn-ghost btn-sm" (click)="choose(i.id, i.balance)">{{ 'ACC.FORM.FILL' | translate }}</button></td>
                  </tr>
                }
              </tbody>
            </table>
          </div></div>
        }

        @if (receipt.value().amount > 0) {
          <p class="text-sm" [class.text-critical-700]="settlement().over" [class.text-ink-600]="!settlement().over" role="status">
            @if (settlement().over) { {{ 'ACC.FORM.OVER' | translate }} }
            @else {
              {{ 'ACC.FORM.ALLOCATED' | translate: { allocated: money(settlement().allocated), amount: money(receipt.value().amount) } }}
              @if (settlement().leftover > 0) { {{ 'ACC.FORM.LEFTOVER' | translate: { amount: money(settlement().leftover) } }} }
            }
          </p>
        }
        <label class="field"><span class="label">{{ 'ACC.FORM.NOTES' | translate }}</span><textarea class="textarea" rows="2" name="notes" [ngModel]="receipt.value().notes" (ngModelChange)="receipt.set('notes', $event)"></textarea></label>
      </form>
      <div modal-footer>
        <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="receiptOpen.set(false)">{{ 'COMMON.CANCEL' | translate }}</button>
        <button type="submit" form="receipt-form" class="btn btn-primary" [disabled]="busy() || receipt.value().amount <= 0 || settlement().over">{{ 'ACC.FORM.SUBMIT' | translate }}</button>
      </div>
    </app-modal>

    <!-- Void a payment -->
    <app-modal [open]="voiding() !== null" [title]="'ACC.VOID_TITLE' | translate" size="sm" [dismissable]="!busy()" (closed)="voiding.set(null)">
      <form id="void-form" class="space-y-3" (ngSubmit)="submitVoid()">
        <p class="text-sm text-ink-600">{{ 'ACC.VOID_HINT' | translate }}</p>
        <label class="field"><span class="label label-required">{{ 'ACC.VOID_REASON' | translate }}</span>
          <textarea class="textarea" rows="3" name="reason" required minlength="3" [ngModel]="voidReason()" (ngModelChange)="voidReason.set($event)"></textarea></label>
      </form>
      <div modal-footer>
        <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="voiding.set(null)">{{ 'COMMON.CANCEL' | translate }}</button>
        <button type="submit" form="void-form" class="btn btn-danger" [disabled]="busy() || voidReason().trim().length < 3">{{ 'ACC.VOID_CONFIRM' | translate }}</button>
      </div>
    </app-modal>

    <!-- Use the credit -->
    <app-modal [open]="creditOpen()" [title]="'ACC.CREDIT_FORM.TITLE' | translate" size="sm" [dismissable]="!busy()" (closed)="creditOpen.set(false)">
      <form id="credit-form" class="space-y-4" (ngSubmit)="submitCredit()">
        <label class="field"><span class="label">{{ 'ACC.CREDIT_FORM.INVOICE' | translate }}</span>
          <select class="select" name="invoice" [ngModel]="credit.value().invoiceId" (ngModelChange)="pickCreditInvoice($event)">
            @for (i of open(); track i.id) { <option [value]="i.id">{{ i.invoiceNumber }} — {{ i.balance | money }}</option> }
          </select></label>
        <label class="field"><span class="label">{{ 'ACC.CREDIT_FORM.AMOUNT' | translate: { max: money(creditMax()) } }}</span>
          <input class="input" type="number" min="0.01" [max]="creditMax()" step="0.01" name="amount" required [ngModel]="credit.value().amount || null" (ngModelChange)="credit.set('amount', +$event || 0)" /></label>
      </form>
      <div modal-footer>
        <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="creditOpen.set(false)">{{ 'COMMON.CANCEL' | translate }}</button>
        <button type="submit" form="credit-form" class="btn btn-primary" [disabled]="busy() || credit.value().amount <= 0 || credit.value().amount > creditMax()">{{ 'ACC.CREDIT_FORM.SUBMIT' | translate }}</button>
      </div>
    </app-modal>

    <!-- New payment plan -->
    <app-modal [open]="planOpen()" [title]="'ACC.PLAN.NEW' | translate" size="lg" [dismissable]="!busy()" (closed)="planOpen.set(false)">
      <form id="plan-form" class="space-y-4" (ngSubmit)="submitPlan()">
        <div class="grid gap-4 sm:grid-cols-3">
          <label class="field"><span class="label label-required">{{ 'ACC.PLAN.TOTAL' | translate }}</span><input class="input" type="number" min="0.01" step="0.01" name="total" required [ngModel]="plan.value().total || null" (ngModelChange)="plan.set('total', +$event || 0)" /></label>
          <label class="field"><span class="label">{{ 'ACC.PLAN.DOWN' | translate }}</span><input class="input" type="number" min="0" step="0.01" name="down" [ngModel]="plan.value().down || null" (ngModelChange)="plan.set('down', +$event || 0)" /></label>
          <label class="field"><span class="label label-required">{{ 'ACC.PLAN.COUNT' | translate }}</span><input class="input" type="number" min="1" max="120" step="1" name="count" required [ngModel]="plan.value().count" (ngModelChange)="plan.set('count', +$event || 0)" /></label>
          <label class="field"><span class="label">{{ 'ACC.PLAN.FREQUENCY' | translate }}</span>
            <select class="select" name="frequency" [ngModel]="plan.value().frequency" (ngModelChange)="plan.set('frequency', $event)">
              @for (f of frequencies; track f) { <option [value]="f">{{ 'ACC.PLAN.FREQUENCIES.' + f | translate }}</option> }
            </select></label>
          <label class="field"><span class="label label-required">{{ 'ACC.PLAN.START' | translate }}</span><input class="input" type="date" name="start" required [ngModel]="plan.value().start" (ngModelChange)="plan.set('start', $event)" /></label>
          <label class="field"><span class="label">{{ 'ACC.PLAN.INVOICE' | translate }}</span>
            <select class="select" name="planInvoice" [ngModel]="plan.value().invoiceId" (ngModelChange)="plan.set('invoiceId', $event)">
              <option value="">—</option>@for (i of open(); track i.id) { <option [value]="i.id">{{ i.invoiceNumber }}</option> }
            </select></label>
        </div>
        @if (schedule().length) {
          <p class="text-sm text-ink-600" role="status">{{ 'ACC.PLAN.PREVIEW' | translate: { count: plan.value().count, amount: money(instalmentAmount()) } }}</p>
        }
        <label class="field"><span class="label">{{ 'ACC.PLAN.NOTES' | translate }}</span><textarea class="textarea" rows="2" name="planNotes" [ngModel]="plan.value().notes" (ngModelChange)="plan.set('notes', $event)"></textarea></label>
      </form>
      <div modal-footer>
        <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="planOpen.set(false)">{{ 'COMMON.CANCEL' | translate }}</button>
        <button type="submit" form="plan-form" class="btn btn-primary" [disabled]="busy() || schedule().length === 0">{{ 'ACC.PLAN.SUBMIT' | translate }}</button>
      </div>
    </app-modal>

    <!-- Take an instalment -->
    <app-modal [open]="paying() !== null" [title]="'ACC.PLAN.PAY_TITLE' | translate: { seq: paying()?.seq ?? '' }" size="sm" [dismissable]="!busy()" (closed)="paying.set(null)">
      <form id="inst-form" class="space-y-4" (ngSubmit)="submitInstalment()">
        <label class="field"><span class="label">{{ 'ACC.FORM.AMOUNT' | translate }}</span>
          <input class="input" type="number" min="0.01" [max]="paying()?.remaining" step="0.01" name="amount" required [ngModel]="instalment.value().amount || null" (ngModelChange)="instalment.set('amount', +$event || 0)" /></label>
        <label class="field"><span class="label">{{ 'ACC.FORM.METHOD' | translate }}</span>
          <select class="select" name="method" [ngModel]="instalment.value().method" (ngModelChange)="instalment.set('method', $event)">
            @for (m of methods; track m) { <option [value]="m">{{ 'BILLING.METHODS.' + m | translate }}</option> }
          </select></label>
      </form>
      <div modal-footer>
        <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="paying.set(null)">{{ 'COMMON.CANCEL' | translate }}</button>
        <button type="submit" form="inst-form" class="btn btn-primary" [disabled]="busy() || instalment.value().amount <= 0">{{ 'ACC.FORM.SUBMIT' | translate }}</button>
      </div>
    </app-modal>
  `,
  styles: [`
    .kpi-label { font-size: var(--text-2xs); font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-muted); }
    .kpi-value { margin-top: 0.25rem; font-size: var(--text-xl); font-weight: 800; color: var(--text); font-variant-numeric: tabular-nums; }
    .section-title { margin-bottom: .5rem; font-size: var(--text-2xs); font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--text-muted); }
  `],
})
export class PatientAccountComponent {
  readonly patientId = input.required<string>();

  private readonly api = inject(FinanceApi);
  private readonly errors = inject(ApiErrors);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly translate = inject(TranslateService);
  private readonly moneyPipe = new MoneyPipe();
  protected readonly practitioners = inject(PractitionerService);

  protected readonly methods = PAYMENT_METHODS;
  protected readonly modes: SettleMode[] = ['AUTO', 'CHOOSE', 'ADVANCE'];
  protected readonly frequencies = PLAN_FREQUENCIES;
  protected readonly today = isoDate(new Date());

  protected readonly account = loadable<Account | null>(null);
  protected readonly plans = loadable<PaymentPlan[]>([]);
  protected readonly open = computed(() => openInvoices(this.account.data()));
  protected readonly hasCredit = computed(() => (this.account.data()?.creditAvailable ?? 0) > 0);

  protected readonly busy = signal(false);
  protected readonly receiptOpen = signal(false);
  protected readonly receipt = formState<ReceiptForm>(emptyReceipt());
  protected readonly chosen = signal<Record<string, number>>({});
  protected readonly settlement = computed(() => settle(this.receipt.value().amount, this.receipt.value().mode, this.open(), this.chosen()));

  protected readonly voiding = signal<Receipt | null>(null);
  protected readonly voidReason = signal('');

  protected readonly creditOpen = signal(false);
  protected readonly credit = formState({ invoiceId: '', amount: 0 });
  protected readonly creditMax = computed(() => {
    const invoice = this.open().find(i => i.id === this.credit.value().invoiceId);
    return Math.max(Math.min(invoice?.balance ?? 0, this.account.data()?.creditAvailable ?? 0), 0);
  });

  protected readonly planOpen = signal(false);
  protected readonly plan = formState(emptyPlan());
  protected readonly schedule = computed(() => planSchedule(this.plan.value().total, this.plan.value().down, this.plan.value().count));
  protected readonly instalmentAmount = computed(() => this.schedule().find(s => s.seq === 1)?.amount ?? 0);

  protected readonly paying = signal<{ seq: number; remaining: number; id: string } | null>(null);
  protected readonly instalment = formState<{ amount: number; method: PaymentMethod }>({ amount: 0, method: 'CASH' });

  constructor() {
    effect(() => {
      const id = this.patientId();
      untracked(() => void this.reload(id));
    });
    // A payment taken at another desk, or a plan paid from the due list, changes what this screen shows.
    refreshOnLive(['finance'], () => void this.reload(this.patientId()));
  }

  protected money(amount: number): string {
    return this.moneyPipe.transform(amount);
  }

  private async reload(patientId: string): Promise<void> {
    await Promise.all([this.account.load(() => this.api.account(patientId)), this.plans.load(() => this.api.patientPlans(patientId))]);
  }

  /** "FA-2026-014 : 300,00 MAD" for each invoice the receipt settled. */
  protected allocationText(receipt: Receipt): string {
    return receipt.allocations.map(a => `${a.invoiceNumber} : ${this.money(a.amount)}`).join(' · ');
  }

  // ── take a payment ────────────────────────────────────────────────
  protected openReceipt(invoiceId?: string, balance?: number): void {
    this.receipt.reset({ ...emptyReceipt(), amount: balance ?? 0, mode: invoiceId ? 'CHOOSE' : this.open().length > 0 ? 'AUTO' : 'ADVANCE' });
    this.chosen.set(invoiceId && balance ? { [invoiceId]: balance } : {});
    this.receiptOpen.set(true);
  }

  protected choose(invoiceId: string, amount: number): void {
    this.chosen.update(c => ({ ...c, [invoiceId]: amount }));
  }

  protected async submitReceipt(): Promise<void> {
    const settlement = this.settlement();
    if (this.busy() || this.receipt.value().amount <= 0 || settlement.over) {
      return;
    }
    await this.run(async () => {
      await this.api.recordReceipt(this.patientId(), receiptRequest(this.receipt.value(), settlement));
      this.receiptOpen.set(false);
      this.toast.success(this.translate.instant('ACC.FORM.DONE'));
    });
  }

  // ── void ──────────────────────────────────────────────────────────
  protected openVoid(receipt: Receipt): void {
    this.voidReason.set('');
    this.voiding.set(receipt);
  }

  protected async submitVoid(): Promise<void> {
    const receipt = this.voiding();
    if (!receipt || this.busy() || this.voidReason().trim().length < 3) {
      return;
    }
    await this.run(async () => {
      await this.api.voidReceipt(receipt.id, this.voidReason().trim());
      this.voiding.set(null);
      this.toast.success(this.translate.instant('ACC.VOID_DONE'));
    });
  }

  // ── credit ────────────────────────────────────────────────────────
  protected openCredit(): void {
    const first = this.open()[0];
    this.credit.reset({ invoiceId: first?.id ?? '', amount: 0 });
    this.credit.set('amount', this.creditMax());
    this.creditOpen.set(true);
  }

  protected pickCreditInvoice(invoiceId: string): void {
    this.credit.set('invoiceId', invoiceId);
    this.credit.set('amount', this.creditMax());
  }

  protected async submitCredit(): Promise<void> {
    const { invoiceId, amount } = this.credit.value();
    if (this.busy() || !invoiceId || amount <= 0 || amount > this.creditMax()) {
      return;
    }
    await this.run(async () => {
      await this.api.applyCredit(this.patientId(), invoiceId, amount);
      this.creditOpen.set(false);
      this.toast.success(this.translate.instant('ACC.CREDIT_FORM.DONE'));
    });
  }

  // ── plans ─────────────────────────────────────────────────────────
  protected openPlan(): void {
    const owed = this.account.data()?.balanceDue ?? 0;
    this.plan.reset({ ...emptyPlan(), total: owed > 0 ? owed : 0 });
    this.planOpen.set(true);
  }

  protected async submitPlan(): Promise<void> {
    if (this.busy() || this.schedule().length === 0) {
      return;
    }
    const f = this.plan.value();
    await this.run(async () => {
      await this.api.createPlan(this.patientId(), planRequest(f));
      this.planOpen.set(false);
      this.toast.success(this.translate.instant('ACC.PLAN.DONE'));
    });
  }

  protected async cancelPlan(plan: PaymentPlan): Promise<void> {
    if (!(await this.confirm.confirm(this.translate.instant('ACC.PLAN.CANCEL_CONFIRM'), { danger: true }))) {
      return;
    }
    await this.run(async () => {
      await this.api.cancelPlan(plan.id);
      this.toast.success(this.translate.instant('ACC.PLAN.CANCELLED'));
    });
  }

  protected openInstalment(plan: PaymentPlan, instalment: PaymentPlan['instalments'][number]): void {
    const remaining = Math.round((instalment.amount - instalment.paidAmount) * 100) / 100;
    this.instalment.reset({ amount: remaining, method: 'CASH' });
    this.paying.set({ id: instalment.id, seq: instalment.seq, remaining });
  }

  protected async submitInstalment(): Promise<void> {
    const target = this.paying();
    const { amount, method } = this.instalment.value();
    if (!target || this.busy() || amount <= 0 || amount > target.remaining) {
      return;
    }
    await this.run(async () => {
      await this.api.payInstalment(target.id, { amount, method });
      this.paying.set(null);
      this.toast.success(this.translate.instant('ACC.PLAN.PAY_DONE'));
    });
  }

  /** One request at a time; a failure is shown and leaves the dialog open, a success refreshes the screen. */
  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    try {
      await action();
      await this.reload(this.patientId());
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.busy.set(false);
    }
  }
}
