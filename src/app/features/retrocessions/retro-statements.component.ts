import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AnalyticsApi, Statement, StatementSummary } from '../../core/services/analytics-api.service';
import { ApiErrors } from '../../core/services/api-error.service';
import { DownloadService } from '../../core/services/download.service';
import { LanguageService } from '../../core/services/language.service';
import { refreshOnLive } from '../../core/services/live-refresh';
import { PractitionerService } from '../../core/services/practitioner.service';
import { ToastService } from '../../core/services/toast.service';
import { formState } from '../../core/utils/form-state';
import { isoDate } from '../../core/utils/format';
import { loadable } from '../../core/utils/loadable';
import { CanDirective } from '../../shared/directives/can.directive';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { IconComponent } from '../../shared/ui/icon.component';
import { ModalComponent } from '../../shared/ui/modal.component';

export function statementTone(status: Statement['status']): string {
  return { UNPAID: 'pill-attention', PARTIAL: 'pill-active', PAID: 'pill-done', VOID: 'pill-idle' }[status];
}

/** What is still owed on a statement, never negative: a payout above the net (an overpayment the server refuses) would otherwise show a nonsense balance. */
export function remaining(s: Pick<Statement, 'net' | 'paid' | 'status'>): number {
  return s.status === 'VOID' ? 0 : Math.max(Math.round((s.net - s.paid) * 100) / 100, 0);
}

/**
 * The statements validated for each doctor. A validated statement is a record: its lines are
 * frozen, it cannot be edited, and a mistake is corrected by voiding it (with a reason) and
 * validating again. Payouts are recorded against it until it is settled.
 */
@Component({
  selector: 'app-retro-statements',
  standalone: true,
  imports: [DatePipe, FormsModule, TranslateModule, MoneyPipe, IconComponent, ModalComponent, CanDirective],
  template: `
    <div class="mb-4 flex flex-wrap items-end gap-3">
      <label class="field w-auto"><span class="label">{{ 'COMMON.PRACTITIONER' | translate }}</span>
        <select class="select w-auto" [ngModel]="practitionerId()" (ngModelChange)="practitionerId.set($event)">
          <option value="">{{ 'COMMON.ALL_PRACTITIONERS' | translate }}</option>
          @for (p of practitioners.active(); track p.id) { <option [value]="p.id">{{ p.displayName }}</option> }
        </select></label>
      <label class="flex items-center gap-1.5 pb-2 text-sm font-semibold text-ink-700"><input type="checkbox" [ngModel]="includeVoided()" (ngModelChange)="includeVoided.set($event)" /> {{ 'RETRO.ST.INCLUDE_VOIDED' | translate }}</label>
    </div>
    <div class="table-wrap" [attr.aria-busy]="list.loading()"><div class="table-scroll">
      <table class="data-table">
        <thead><tr>
          <th scope="col">{{ 'ACC.COL.NUMBER' | translate }}</th><th scope="col">{{ 'COMMON.PRACTITIONER' | translate }}</th><th scope="col">{{ 'RETRO.ST.PERIOD' | translate }}</th>
          <th scope="col" class="cell-num">{{ 'RETRO.GROSS' | translate }}</th><th scope="col" class="cell-num">{{ 'RETRO.ADVANCES_APPLIED' | translate }}</th><th scope="col" class="cell-num">{{ 'RETRO.NET' | translate }}</th>
          <th scope="col" class="cell-num">{{ 'ACC.COL.PAID' | translate }}</th><th scope="col">{{ 'COMMON.STATUS' | translate }}</th>
        </tr></thead>
        <tbody>
          @for (s of list.data(); track s.id) {
            <tr class="row-clickable" [class.opacity-60]="s.status === 'VOID'" (click)="open(s.id)">
              <td><button type="button" class="font-bold text-ink-900 hover:text-petrol-700" (click)="open(s.id); $event.stopPropagation()">{{ s.number }}</button></td>
              <td>{{ s.practitionerName }}</td>
              <td class="whitespace-nowrap">{{ s.from | date: 'shortDate' }} → {{ s.to | date: 'shortDate' }}</td>
              <td class="cell-num">{{ s.gross | money }}</td>
              <td class="cell-num">{{ s.advancesDeducted | money }}</td>
              <td class="cell-num font-semibold">{{ s.net | money }}</td>
              <td class="cell-num">{{ s.paid | money }}</td>
              <td><span class="pill" [class]="'pill ' + tone(s.status)">{{ 'RETRO.ST.STATUSES.' + s.status | translate }}</span></td>
            </tr>
          } @empty {
            <tr><td colspan="8" class="py-8 text-center text-ink-500">{{ 'RETRO.ST.EMPTY' | translate }}</td></tr>
          }
        </tbody>
      </table>
    </div></div>

    <app-modal [open]="detail() !== null" [title]="detail()?.number ?? ''" size="xl" (closed)="detail.set(null)">
      @if (detail(); as d) {
        <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
          <p class="text-sm text-ink-700"><strong>{{ d.practitionerName }}</strong> · {{ d.from | date: 'mediumDate' }} → {{ d.to | date: 'mediumDate' }}
            <span class="ms-2 pill" [class]="'pill ' + tone(d.status)">{{ 'RETRO.ST.STATUSES.' + d.status | translate }}</span></p>
          <button type="button" class="btn btn-secondary btn-sm" (click)="pdf(d)"><app-icon name="file-text" [size]="15" /> PDF</button>
        </div>
        <dl class="mb-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <div><dt class="text-ink-500">{{ 'RETRO.BASE' | translate }}</dt><dd class="font-semibold tabular-nums">{{ d.base | money }}</dd></div>
          <div><dt class="text-ink-500">{{ 'RETRO.LAB' | translate }}</dt><dd class="font-semibold tabular-nums">−{{ d.labDeduction | money }}</dd></div>
          <div><dt class="text-ink-500">{{ 'RETRO.VARIABLE' | translate }}</dt><dd class="font-semibold tabular-nums">{{ d.variable | money }}</dd></div>
          <div><dt class="text-ink-500">{{ 'RETRO.FIXED' | translate }}</dt><dd class="font-semibold tabular-nums">{{ d.fixed | money }}</dd></div>
          <div><dt class="text-ink-500">{{ 'RETRO.ADJUSTMENT' | translate }}</dt><dd class="font-semibold tabular-nums">{{ d.adjustment | money }}</dd></div>
          <div><dt class="text-ink-500">{{ 'RETRO.GROSS' | translate }}</dt><dd class="font-bold tabular-nums">{{ d.gross | money }}</dd></div>
          <div><dt class="text-ink-500">{{ 'RETRO.ADVANCES_APPLIED' | translate }}</dt><dd class="font-semibold tabular-nums">−{{ d.advancesDeducted | money }}</dd></div>
          <div><dt class="text-ink-500">{{ 'RETRO.NET' | translate }}</dt><dd class="text-base font-extrabold tabular-nums text-petrol-700">{{ d.net | money }}</dd></div>
        </dl>
        @if (d.status === 'VOID') { <p class="mb-4 rounded-md bg-critical-50 p-3 text-sm text-critical-700" role="note">{{ 'RETRO.ST.VOIDED' | translate: { at: (d.voidedAt | date: 'medium') } }} @if (d.voidReason) { — {{ d.voidReason }} }</p> }

        <h3 class="section-title">{{ 'RETRO.ST.PAYOUTS' | translate }}</h3>
        <table class="data-table mb-4">
          <tbody>
            @for (p of d.payouts; track p.id) { <tr><td>{{ p.paidDate | date: 'mediumDate' }}</td><td>{{ p.method }}@if (p.reference) { · {{ p.reference }} }</td><td class="cell-num font-semibold">{{ p.amount | money }}</td></tr> }
            @empty { <tr><td class="py-3 text-ink-500">{{ 'RETRO.ST.NO_PAYOUTS' | translate }}</td></tr> }
          </tbody>
          @if (d.payouts.length) { <tfoot><tr class="font-bold"><td colspan="2" class="text-start">{{ 'RETRO.ST.REMAINING' | translate }}</td><td class="cell-num">{{ left(d) | money }}</td></tr></tfoot> }
        </table>

        @if (d.status === 'UNPAID' || d.status === 'PARTIAL') {
          <form *appCan="'RETROCESSION_MANAGE'" id="payout-form" class="mb-4 grid gap-3 rounded-lg border border-ink-200 p-3 sm:grid-cols-4" (ngSubmit)="payout()">
            <label class="field"><span class="label">{{ 'ACC.FORM.AMOUNT' | translate }}</span><input class="input" type="number" min="0.01" [max]="left(d)" step="0.01" name="amount" required [ngModel]="pay.value().amount || null" (ngModelChange)="pay.set('amount', +$event || 0)" /></label>
            <label class="field"><span class="label">{{ 'ACC.FORM.DATE' | translate }}</span><input class="input" type="date" name="date" [max]="today" [ngModel]="pay.value().paidDate" (ngModelChange)="pay.set('paidDate', $event)" /></label>
            <label class="field"><span class="label">{{ 'ACC.FORM.METHOD' | translate }}</span><input class="input" name="method" maxlength="40" [ngModel]="pay.value().method" (ngModelChange)="pay.set('method', $event)" /></label>
            <label class="field"><span class="label">{{ 'ACC.FORM.REFERENCE' | translate }}</span><input class="input" name="reference" maxlength="100" [ngModel]="pay.value().reference" (ngModelChange)="pay.set('reference', $event)" /></label>
            <div class="sm:col-span-4 flex justify-end"><button type="submit" class="btn btn-primary btn-sm" [disabled]="busy() || pay.value().amount <= 0 || pay.value().amount > left(d)">{{ 'RETRO.ST.RECORD_PAYOUT' | translate }}</button></div>
          </form>
        }

        <details>
          <summary class="cursor-pointer text-sm font-semibold text-ink-700">{{ 'RETRO.SIM.LINES' | translate: { count: d.lines.length } }}</summary>
          <div class="table-scroll mt-2">
            <table class="data-table">
              <tbody>
                @for (l of d.lines; track $index) {
                  <tr><td>{{ l.date | date: 'shortDate' }}</td><td>{{ l.invoiceNumber }}<span class="block text-xs text-ink-500 mono">{{ l.patientCode }}</span></td><td>{{ l.label }}</td>
                    <td class="cell-num">{{ l.base | money }}</td><td class="cell-num">{{ l.ratePercent ?? '—' }}</td><td class="cell-num font-semibold">{{ l.amount | money }}</td></tr>
                }
              </tbody>
            </table>
          </div>
        </details>
      }
      <div modal-footer>
        @if (detail(); as d) {
          @if (d.status !== 'VOID') { <button *appCan="'RETROCESSION_MANAGE'" type="button" class="btn btn-danger-ghost me-auto" [disabled]="busy()" (click)="openVoid()">{{ 'RETRO.ST.VOID' | translate }}</button> }
        }
        <button type="button" class="btn btn-secondary" (click)="detail.set(null)">{{ 'COMMON.CLOSE' | translate }}</button>
      </div>
    </app-modal>

    <app-modal [open]="voiding()" [title]="'RETRO.ST.VOID_TITLE' | translate" size="sm" [dismissable]="!busy()" (closed)="voiding.set(false)">
      <form id="void-form" class="space-y-3" (ngSubmit)="doVoid()">
        <p class="text-sm text-ink-600">{{ 'RETRO.ST.VOID_HINT' | translate }}</p>
        <label class="field"><span class="label label-required">{{ 'ACC.VOID_REASON' | translate }}</span><textarea class="textarea" rows="3" name="reason" required minlength="3" [ngModel]="reason()" (ngModelChange)="reason.set($event)"></textarea></label>
      </form>
      <div modal-footer>
        <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="voiding.set(false)">{{ 'COMMON.CANCEL' | translate }}</button>
        <button type="submit" form="void-form" class="btn btn-danger" [disabled]="busy() || reason().trim().length < 3">{{ 'RETRO.ST.VOID' | translate }}</button>
      </div>
    </app-modal>
  `,
  styles: [`.section-title { margin-bottom: .5rem; font-size: var(--text-2xs); font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--text-muted); }`],
})
export class RetroStatementsComponent {
  private readonly api = inject(AnalyticsApi);
  private readonly errors = inject(ApiErrors);
  private readonly toast = inject(ToastService);
  private readonly downloads = inject(DownloadService);
  private readonly language = inject(LanguageService);
  private readonly translate = inject(TranslateService);
  protected readonly practitioners = inject(PractitionerService);

  protected readonly tone = statementTone;
  protected readonly left = remaining;
  protected readonly today = isoDate(new Date());
  protected readonly practitionerId = signal('');
  protected readonly includeVoided = signal(false);
  protected readonly list = loadable<StatementSummary[]>([]);
  protected readonly detail = signal<Statement | null>(null);
  protected readonly busy = signal(false);
  protected readonly pay = formState({ amount: 0, paidDate: this.today, method: 'CASH', reference: '' });
  protected readonly voiding = signal(false);
  protected readonly reason = signal('');

  private readonly query = computed(() => ({ practitionerId: this.practitionerId() || undefined, includeVoided: this.includeVoided() || undefined }));

  constructor() {
    effect(() => {
      const query = this.query();
      untracked(() => void this.list.load(() => this.api.statements(query)));
    });
    refreshOnLive(['retrocession'], () => void this.list.load(() => this.api.statements(this.query())));
  }

  protected async open(id: string): Promise<void> {
    try {
      const statement = await this.api.statement(id);
      this.pay.reset({ amount: remaining(statement), paidDate: this.today, method: 'CASH', reference: '' });
      this.detail.set(statement);
    } catch (error) {
      this.errors.report(error);
    }
  }

  protected async pdf(statement: Statement): Promise<void> {
    try {
      await this.downloads.open(`/retrocessions/statements/${statement.id}/pdf`, { lang: this.language.currentLang() });
    } catch (error) {
      this.errors.report(error);
    }
  }

  protected async payout(): Promise<void> {
    const d = this.detail();
    const p = this.pay.value();
    if (!d || this.busy() || p.amount <= 0 || p.amount > remaining(d)) {
      return;
    }
    await this.run(async () => {
      const updated = await this.api.payout(d.id, { amount: p.amount, paidDate: p.paidDate || undefined, method: p.method.trim() || undefined, reference: p.reference.trim() || undefined });
      this.detail.set(updated);
      this.pay.reset({ amount: remaining(updated), paidDate: this.today, method: p.method, reference: '' });
      this.toast.success(this.translate.instant('RETRO.ST.PAYOUT_DONE'));
    });
  }

  protected openVoid(): void {
    this.reason.set('');
    this.voiding.set(true);
  }

  protected async doVoid(): Promise<void> {
    const d = this.detail();
    if (!d || this.busy() || this.reason().trim().length < 3) {
      return;
    }
    await this.run(async () => {
      this.detail.set(await this.api.voidStatement(d.id, this.reason().trim()));
      this.voiding.set(false);
      this.toast.success(this.translate.instant('RETRO.ST.VOID_DONE'));
    });
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    try {
      await action();
      await this.list.load(() => this.api.statements(this.query()));
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.busy.set(false);
    }
  }
}
