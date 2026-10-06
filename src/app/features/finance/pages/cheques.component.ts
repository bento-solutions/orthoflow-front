import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ApiErrors } from '../../../core/services/api-error.service';
import { ConfirmDialogService } from '../../../core/services/confirm-dialog.service';
import { Cheque, ChequeStatus, FinanceApi } from '../../../core/services/finance-api.service';
import { refreshOnLive } from '../../../core/services/live-refresh';
import { ToastService } from '../../../core/services/toast.service';
import { formState } from '../../../core/utils/form-state';
import { loadable } from '../../../core/utils/loadable';
import { CanDirective } from '../../../shared/directives/can.directive';
import { MoneyPipe } from '../../../shared/pipes/money.pipe';
import { IconComponent } from '../../../shared/ui/icon.component';
import { ModalComponent } from '../../../shared/ui/modal.component';
import { PatientPickerComponent, PickedPatient } from '../../../shared/ui/patient-picker.component';
import { StatusPillComponent } from '../../../shared/ui/status-pill.component';

const STATUSES: ChequeStatus[] = ['PENDING', 'DEPOSITED', 'CASHED', 'REJECTED'];

/** What can be done to a cheque from where it stands: a pending one is deposited, a deposited one is cashed, and a rejection is possible until it is cashed. */
export function chequeActions(cheque: Pick<Cheque, 'status' | 'guarantee'>): { deposit: boolean; cash: boolean; reject: boolean; release: boolean } {
  return {
    deposit: cheque.status === 'PENDING',
    cash: cheque.status === 'DEPOSITED',
    reject: cheque.status === 'PENDING' || cheque.status === 'DEPOSITED',
    release: cheque.guarantee && cheque.status === 'PENDING',
  };
}

/**
 * The cheque register: cheques received as payment (entered through a payment) and guarantee
 * cheques held for a patient, with where each one is in its life. A rejected cheque cancels the
 * payment it settled and warns the people who manage finance.
 */
@Component({
  selector: 'app-cheques',
  standalone: true,
  imports: [DatePipe, FormsModule, RouterLink, TranslateModule, MoneyPipe, IconComponent, ModalComponent, PatientPickerComponent, StatusPillComponent, CanDirective],
  template: `
    <div class="mb-4 flex flex-wrap items-end gap-3">
      <div class="seg" role="group" [attr.aria-label]="'COMMON.STATUS' | translate">
        <button type="button" class="seg-item" [class.is-active]="status() === ''" [attr.aria-pressed]="status() === ''" (click)="status.set('')">{{ 'COMMON.ALL' | translate }}</button>
        @for (s of statuses; track s) {
          <button type="button" class="seg-item" [class.is-active]="status() === s" [attr.aria-pressed]="status() === s" (click)="status.set(s)">{{ 'STATUS.' + s | translate }}</button>
        }
      </div>
      <label class="flex items-center gap-1.5 pb-2 text-sm font-semibold text-ink-700"><input type="checkbox" [ngModel]="guaranteeOnly()" (ngModelChange)="guaranteeOnly.set($event)" /> {{ 'FIN.CHQ.GUARANTEE_ONLY' | translate }}</label>
      <label class="field w-auto"><span class="label">{{ 'FIN.CHQ.DUE_BY' | translate }}</span><input class="input" type="date" [ngModel]="dueTo()" (ngModelChange)="dueTo.set($event)" /></label>
      <button *appCan="'FINANCE_MANAGE'" type="button" class="btn btn-primary btn-sm ms-auto" (click)="openNew()"><app-icon name="plus" [size]="15" /> {{ 'FIN.CHQ.NEW' | translate }}</button>
    </div>

    <div class="table-wrap" [attr.aria-busy]="cheques.loading()"><div class="table-scroll">
      <table class="data-table">
        <thead><tr>
          <th scope="col">{{ 'FIN.CHQ.NUMBER' | translate }}</th><th scope="col">{{ 'FIN.CHQ.DRAWER' | translate }}</th>
          <th scope="col" class="cell-num">{{ 'ACC.COL.AMOUNT' | translate }}</th><th scope="col">{{ 'ACC.PLAN.COL.DUE' | translate }}</th>
          <th scope="col">{{ 'COMMON.STATUS' | translate }}</th><th scope="col" class="cell-actions"><span class="sr-only">{{ 'COMMON.ACTIONS' | translate }}</span></th>
        </tr></thead>
        <tbody>
          @for (c of cheques.data(); track c.id) {
            <tr>
              <td class="font-semibold">{{ c.number }}<span class="block text-xs font-normal text-ink-500">{{ c.bank }}</span></td>
              <td>
                @if (c.patientId) { <a class="text-ink-900 no-underline hover:text-petrol-700" [routerLink]="['/patients', c.patientId]">{{ c.patientName }}</a> } @else { {{ c.drawerName || '—' }} }
                @if (c.patientId && c.drawerName) { <span class="block text-xs text-ink-500">{{ c.drawerName }}</span> }
              </td>
              <td class="cell-num font-semibold">{{ c.amount | money }}</td>
              <td>{{ c.dueDate ? (c.dueDate | date: 'mediumDate') : '—' }}@if (c.postDated) { <span class="pill pill-attention pill-nodot ms-2">{{ 'FIN.CHQ.POST_DATED' | translate }}</span> }</td>
              <td>
                <span class="flex flex-wrap items-center gap-1.5">
                  <app-status-pill [status]="c.status" />
                  @if (c.guarantee) { <span class="pill pill-idle pill-nodot">{{ 'FIN.CHQ.GUARANTEE' | translate }}</span> }
                </span>
                @if (c.status === 'DEPOSITED' && c.depositDate) { <span class="block text-xs text-ink-500">{{ c.depositDate | date: 'mediumDate' }}</span> }
                @if (c.status === 'CASHED' && c.cashedDate) { <span class="block text-xs text-ink-500">{{ c.cashedDate | date: 'mediumDate' }}</span> }
              </td>
              <td class="cell-actions">
                <span *appCan="'FINANCE_MANAGE'" class="inline-flex flex-wrap justify-end gap-1">
                  @if (actions(c).deposit) { <button type="button" class="btn btn-secondary btn-sm" (click)="act(c, 'deposit')">{{ 'FIN.CHQ.DEPOSIT' | translate }}</button> }
                  @if (actions(c).cash) { <button type="button" class="btn btn-secondary btn-sm" (click)="act(c, 'cash')">{{ 'FIN.CHQ.CASH' | translate }}</button> }
                  @if (actions(c).reject) { <button type="button" class="btn btn-danger-ghost btn-sm" (click)="openReject(c)">{{ 'FIN.CHQ.REJECT' | translate }}</button> }
                  @if (actions(c).release) { <button type="button" class="btn btn-ghost btn-sm" (click)="release(c)">{{ 'FIN.CHQ.RELEASE' | translate }}</button> }
                </span>
              </td>
            </tr>
          } @empty {
            <tr><td colspan="6" class="py-8 text-center text-ink-500">{{ 'FIN.CHQ.EMPTY' | translate }}</td></tr>
          }
        </tbody>
        @if (cheques.data().length) {
          <tfoot><tr class="font-bold"><th scope="row" colspan="2" class="text-start">{{ 'COMMON.TOTAL' | translate }}</th><td class="cell-num">{{ total() | money }}</td><td colspan="3"></td></tr></tfoot>
        }
      </table>
    </div></div>

    <app-modal [open]="creating()" [title]="'FIN.CHQ.NEW' | translate" size="md" [dismissable]="!busy()" (closed)="creating.set(false)">
      <form id="chq-form" class="space-y-4" (ngSubmit)="create()">
        <p class="text-sm text-ink-600">{{ 'FIN.CHQ.NEW_HINT' | translate }}</p>
        <div class="field"><span class="label">{{ 'COMMON.PATIENT' | translate }}</span><app-patient-picker [value]="patient()" (valueChange)="patient.set($event)" [label]="'COMMON.PATIENT' | translate" /></div>
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="field"><span class="label label-required">{{ 'FIN.CHQ.NUMBER' | translate }}</span><input class="input" name="number" required maxlength="40" [ngModel]="form.value().number" (ngModelChange)="form.set('number', $event)" /></label>
          <label class="field"><span class="label">{{ 'ACC.FORM.CHEQUE_BANK' | translate }}</span><input class="input" name="bank" maxlength="120" [ngModel]="form.value().bank" (ngModelChange)="form.set('bank', $event)" /></label>
          <label class="field"><span class="label label-required">{{ 'ACC.FORM.AMOUNT' | translate }}</span><input class="input" type="number" min="0.01" step="0.01" name="amount" required [ngModel]="form.value().amount || null" (ngModelChange)="form.set('amount', +$event || 0)" /></label>
          <label class="field"><span class="label">{{ 'ACC.FORM.CHEQUE_DUE' | translate }}</span><input class="input" type="date" name="due" [ngModel]="form.value().dueDate" (ngModelChange)="form.set('dueDate', $event)" /></label>
        </div>
        <label class="field"><span class="label">{{ 'ACC.FORM.CHEQUE_DRAWER' | translate }}</span><input class="input" name="drawer" maxlength="200" [ngModel]="form.value().drawerName" (ngModelChange)="form.set('drawerName', $event)" /></label>
        <label class="field"><span class="label">{{ 'COMMON.NOTES' | translate }}</span><textarea class="textarea" rows="2" name="notes" [ngModel]="form.value().notes" (ngModelChange)="form.set('notes', $event)"></textarea></label>
      </form>
      <div modal-footer>
        <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="creating.set(false)">{{ 'COMMON.CANCEL' | translate }}</button>
        <button type="submit" form="chq-form" class="btn btn-primary" [disabled]="busy() || !form.value().number.trim() || form.value().amount <= 0">{{ 'COMMON.SAVE' | translate }}</button>
      </div>
    </app-modal>

    <app-modal [open]="rejecting() !== null" [title]="'FIN.CHQ.REJECT_TITLE' | translate" size="sm" [dismissable]="!busy()" (closed)="rejecting.set(null)">
      <form id="rej-form" class="space-y-3" (ngSubmit)="reject()">
        <p class="text-sm text-ink-600">{{ 'FIN.CHQ.REJECT_HINT' | translate }}</p>
        <label class="field"><span class="label">{{ 'FIN.CHQ.REJECT_REASON' | translate }}</span><textarea class="textarea" rows="2" name="reason" [ngModel]="reason()" (ngModelChange)="reason.set($event)"></textarea></label>
      </form>
      <div modal-footer>
        <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="rejecting.set(null)">{{ 'COMMON.CANCEL' | translate }}</button>
        <button type="submit" form="rej-form" class="btn btn-danger" [disabled]="busy()">{{ 'FIN.CHQ.REJECT' | translate }}</button>
      </div>
    </app-modal>
  `,
})
export class ChequesComponent {
  private readonly api = inject(FinanceApi);
  private readonly errors = inject(ApiErrors);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly translate = inject(TranslateService);

  protected readonly statuses = STATUSES;
  protected readonly status = signal<'' | ChequeStatus>('');
  protected readonly guaranteeOnly = signal(false);
  protected readonly dueTo = signal('');
  protected readonly cheques = loadable<Cheque[]>([]);
  protected readonly total = computed(() => this.cheques.data().reduce((s, c) => s + c.amount, 0));
  protected readonly actions = chequeActions;

  protected readonly busy = signal(false);
  protected readonly creating = signal(false);
  protected readonly patient = signal<PickedPatient | null>(null);
  protected readonly form = formState({ number: '', bank: '', drawerName: '', amount: 0, dueDate: '', notes: '' });
  protected readonly rejecting = signal<Cheque | null>(null);
  protected readonly reason = signal('');

  private readonly query = computed(() => ({
    status: this.status(), guarantee: this.guaranteeOnly() ? true : undefined, dueTo: this.dueTo(),
  }));

  constructor() {
    effect(() => {
      const query = this.query();
      untracked(() => void this.cheques.load(() => this.api.cheques(query)));
    });
    refreshOnLive(['finance'], () => void this.cheques.load(() => this.api.cheques(this.query())));
  }

  protected openNew(): void {
    this.patient.set(null);
    this.form.reset({ number: '', bank: '', drawerName: '', amount: 0, dueDate: '', notes: '' });
    this.creating.set(true);
  }

  protected async create(): Promise<void> {
    const f = this.form.value();
    if (this.busy() || !f.number.trim() || f.amount <= 0) {
      return;
    }
    await this.run(async () => {
      await this.api.createCheque({
        number: f.number.trim(), bank: f.bank.trim() || undefined, drawerName: f.drawerName.trim() || undefined, patientId: this.patient()?.id,
        amount: f.amount, dueDate: f.dueDate || undefined, guarantee: true, notes: f.notes.trim() || undefined,
      });
      this.creating.set(false);
    });
  }

  protected async act(cheque: Cheque, action: 'deposit' | 'cash'): Promise<void> {
    await this.run(() => this.api.chequeAction(cheque.id, action).then(() => undefined));
  }

  protected openReject(cheque: Cheque): void {
    this.reason.set('');
    this.rejecting.set(cheque);
  }

  protected async reject(): Promise<void> {
    const cheque = this.rejecting();
    if (!cheque || this.busy()) {
      return;
    }
    await this.run(async () => {
      await this.api.chequeAction(cheque.id, 'reject', { reason: this.reason().trim() || undefined });
      this.rejecting.set(null);
    });
  }

  protected async release(cheque: Cheque): Promise<void> {
    if (!(await this.confirm.confirm(this.translate.instant('FIN.CHQ.RELEASE_CONFIRM', { number: cheque.number }), { danger: true }))) {
      return;
    }
    await this.run(() => this.api.releaseCheque(cheque.id));
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    try {
      await action();
      await this.cheques.load(() => this.api.cheques(this.query()));
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.busy.set(false);
    }
  }
}
