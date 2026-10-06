import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ApiErrors } from '../../../core/services/api-error.service';
import { ConfirmDialogService } from '../../../core/services/confirm-dialog.service';
import { DownloadService } from '../../../core/services/download.service';
import { Account, FinanceApi, TaxDocument } from '../../../core/services/finance-api.service';
import { LanguageService } from '../../../core/services/language.service';
import { refreshOnLive } from '../../../core/services/live-refresh';
import { PractitionerService } from '../../../core/services/practitioner.service';
import { ToastService } from '../../../core/services/toast.service';
import { Period, periodFor } from '../../../core/utils/format';
import { loadable } from '../../../core/utils/loadable';
import { CanDirective } from '../../../shared/directives/can.directive';
import { MoneyPipe } from '../../../shared/pipes/money.pipe';
import { ExportMenuComponent } from '../../../shared/ui/export-menu.component';
import { IconComponent } from '../../../shared/ui/icon.component';
import { ModalComponent } from '../../../shared/ui/modal.component';
import { PatientPickerComponent, PickedPatient } from '../../../shared/ui/patient-picker.component';
import { PeriodPickerComponent } from '../../../shared/ui/period-picker.component';
import { StatusPillComponent } from '../../../shared/ui/status-pill.component';

const KINDS = ['FEE_NOTE', 'CARE_FORM'] as const;
const STATUSES = ['ISSUED', 'DELIVERED', 'VOID'] as const;
const LANGS = ['fr', 'en', 'ar'] as const;

/**
 * Fee notes and insurance care forms that were issued to patients: the PDF, whether it was handed
 * over, and which ones are duplicates (a reprint is a new document marked as a copy, so the
 * original stays untouched). A document cannot be edited; if it is wrong it is voided and a new
 * one issued.
 */
@Component({
  selector: 'app-tax-documents',
  standalone: true,
  imports: [DatePipe, FormsModule, RouterLink, TranslateModule, MoneyPipe, ExportMenuComponent, IconComponent, ModalComponent, PatientPickerComponent, PeriodPickerComponent, StatusPillComponent, CanDirective],
  template: `
    <div class="mb-4 flex flex-wrap items-end gap-3">
      <app-period-picker [value]="period()" (valueChange)="period.set($event)" [presets]="presets" />
      <label class="field w-auto"><span class="label">{{ 'COMMON.TYPE' | translate }}</span>
        <select class="select w-auto" [ngModel]="kind()" (ngModelChange)="kind.set($event)">
          <option value="">{{ 'COMMON.ALL' | translate }}</option>
          @for (k of kinds; track k) { <option [value]="k">{{ 'FIN.TAX.KINDS.' + k | translate }}</option> }
        </select></label>
      <label class="field w-auto"><span class="label">{{ 'COMMON.STATUS' | translate }}</span>
        <select class="select w-auto" [ngModel]="status()" (ngModelChange)="status.set($event)">
          <option value="">{{ 'COMMON.ALL' | translate }}</option>
          @for (s of statuses; track s) { <option [value]="s">{{ 'STATUS.' + s | translate }}</option> }
        </select></label>
      <label class="flex items-center gap-1.5 pb-2 text-sm font-semibold text-ink-700"><input type="checkbox" [ngModel]="duplicatesOnly()" (ngModelChange)="duplicatesOnly.set($event)" /> {{ 'FIN.TAX.DUPLICATES_ONLY' | translate }}</label>
      <span class="ms-auto flex gap-2">
        <app-export-menu path="/tax-documents/export" [query]="exportQuery()" fallbackName="tax-documents" />
        <button *appCan="'BILLING_WRITE'" type="button" class="btn btn-primary btn-sm" (click)="openIssue()"><app-icon name="plus" [size]="15" /> {{ 'FIN.TAX.ISSUE' | translate }}</button>
      </span>
    </div>

    <div class="table-wrap" [attr.aria-busy]="documents.loading()"><div class="table-scroll">
      <table class="data-table">
        <thead><tr>
          <th scope="col">{{ 'ACC.COL.NUMBER' | translate }}</th><th scope="col">{{ 'COMMON.TYPE' | translate }}</th><th scope="col">{{ 'COMMON.PATIENT' | translate }}</th>
          <th scope="col" class="cell-num">{{ 'ACC.COL.AMOUNT' | translate }}</th><th scope="col">{{ 'FIN.TAX.ISSUED' | translate }}</th><th scope="col">{{ 'FIN.TAX.DELIVERED' | translate }}</th>
          <th scope="col">{{ 'COMMON.STATUS' | translate }}</th><th scope="col" class="cell-actions"><span class="sr-only">{{ 'COMMON.ACTIONS' | translate }}</span></th>
        </tr></thead>
        <tbody>
          @for (d of documents.data(); track d.id) {
            <tr [class.opacity-60]="d.status === 'VOID'">
              <td class="font-semibold">{{ d.number }}@if (d.duplicate) { <span class="pill pill-attention pill-nodot ms-2">{{ 'FIN.TAX.DUPLICATE' | translate }}</span> }</td>
              <td>{{ 'FIN.TAX.KINDS.' + d.kind | translate }}</td>
              <td><a class="text-ink-900 no-underline hover:text-petrol-700" [routerLink]="['/patients', d.patientId]">{{ d.patientName }}</a></td>
              <td class="cell-num">{{ d.amount | money }}</td>
              <td>{{ d.issuedAt | date: 'mediumDate' }}</td>
              <td>{{ d.deliveredAt ? (d.deliveredAt | date: 'mediumDate') : '—' }}</td>
              <td><app-status-pill [status]="d.status" /></td>
              <td class="cell-actions">
                <span class="inline-flex flex-wrap justify-end gap-1">
                  @if (d.fileId) { <button type="button" class="btn btn-ghost btn-icon" (click)="view(d)" [title]="'FIN.TAX.VIEW' | translate" [attr.aria-label]="('FIN.TAX.VIEW' | translate) + ' ' + d.number"><app-icon name="eye" [size]="16" /></button> }
                  <ng-container *appCan="'FINANCE_MANAGE'">
                    @if (d.status === 'ISSUED') { <button type="button" class="btn btn-secondary btn-sm" (click)="act(d, 'deliver')">{{ 'FIN.TAX.MARK_DELIVERED' | translate }}</button> }
                    @if (d.status !== 'VOID') {
                      <button type="button" class="btn btn-ghost btn-icon" (click)="duplicate(d)" [title]="'FIN.TAX.MAKE_DUPLICATE' | translate" [attr.aria-label]="('FIN.TAX.MAKE_DUPLICATE' | translate) + ' ' + d.number"><app-icon name="copy" [size]="16" /></button>
                      <button type="button" class="btn btn-danger-ghost btn-sm" (click)="voidDoc(d)">{{ 'FIN.TAX.VOID' | translate }}</button>
                    }
                  </ng-container>
                </span>
              </td>
            </tr>
          } @empty {
            <tr><td colspan="8" class="py-8 text-center text-ink-500">{{ 'FIN.TAX.EMPTY' | translate }}</td></tr>
          }
        </tbody>
      </table>
    </div></div>

    <app-modal [open]="issuing()" [title]="'FIN.TAX.ISSUE' | translate" size="md" [dismissable]="!busy()" (closed)="issuing.set(false)">
      <form id="tax-form" class="space-y-4" (ngSubmit)="issue()">
        <div class="field"><span class="label label-required">{{ 'COMMON.PATIENT' | translate }}</span>
          <app-patient-picker [value]="patient()" (valueChange)="pickPatient($event)" [label]="'COMMON.PATIENT' | translate" /></div>
        <label class="field"><span class="label label-required">{{ 'FIN.TAX.INVOICE' | translate }}</span>
          <select class="select" name="invoice" required [ngModel]="invoiceId()" (ngModelChange)="invoiceId.set($event)" [disabled]="!patient()">
            <option value="">—</option>
            @for (i of invoices(); track i.id) { <option [value]="i.id">{{ i.invoiceNumber }} — {{ i.total | money }}</option> }
          </select></label>
        <div class="grid gap-4 sm:grid-cols-3">
          <label class="field"><span class="label">{{ 'COMMON.TYPE' | translate }}</span>
            <select class="select" name="kindNew" [ngModel]="newKind()" (ngModelChange)="newKind.set($event)">@for (k of kinds; track k) { <option [value]="k">{{ 'FIN.TAX.KINDS.' + k | translate }}</option> }</select></label>
          <label class="field"><span class="label">{{ 'COMMON.PRACTITIONER' | translate }}</span>
            <select class="select" name="doctor" [ngModel]="practitionerId()" (ngModelChange)="practitionerId.set($event)">
              <option value="">—</option>@for (p of practitioners.active(); track p.id) { <option [value]="p.id">{{ p.displayName }}</option> }</select></label>
          <label class="field"><span class="label">{{ 'FIN.TAX.LANGUAGE' | translate }}</span>
            <select class="select" name="lang" [ngModel]="lang()" (ngModelChange)="lang.set($event)">@for (l of langs; track l) { <option [value]="l">{{ 'FIN.TAX.LANGS.' + l | translate }}</option> }</select></label>
        </div>
        <label class="field"><span class="label">{{ 'COMMON.NOTES' | translate }}</span><textarea class="textarea" rows="2" name="notes" [ngModel]="notes()" (ngModelChange)="notes.set($event)"></textarea></label>
      </form>
      <div modal-footer>
        <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="issuing.set(false)">{{ 'COMMON.CANCEL' | translate }}</button>
        <button type="submit" form="tax-form" class="btn btn-primary" [disabled]="busy() || !invoiceId()">{{ 'FIN.TAX.ISSUE' | translate }}</button>
      </div>
    </app-modal>
  `,
})
export class TaxDocumentsComponent {
  private readonly api = inject(FinanceApi);
  private readonly errors = inject(ApiErrors);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly downloads = inject(DownloadService);
  private readonly language = inject(LanguageService);
  private readonly translate = inject(TranslateService);
  protected readonly practitioners = inject(PractitionerService);

  protected readonly kinds = KINDS;
  protected readonly statuses = STATUSES;
  protected readonly langs = LANGS;
  protected readonly presets: ('month' | 'lastMonth' | 'quarter' | 'year' | 'lastYear')[] = ['month', 'lastMonth', 'quarter', 'year', 'lastYear'];
  protected readonly period = signal<Period>(periodFor('year'));
  protected readonly kind = signal('');
  protected readonly status = signal('');
  protected readonly duplicatesOnly = signal(false);
  protected readonly documents = loadable<TaxDocument[]>([]);

  protected readonly busy = signal(false);
  protected readonly issuing = signal(false);
  protected readonly patient = signal<PickedPatient | null>(null);
  protected readonly account = signal<Account | null>(null);
  protected readonly invoices = computed(() => (this.account()?.invoices ?? []).filter(i => i.status !== 'DRAFT' && i.status !== 'CANCELLED'));
  protected readonly invoiceId = signal('');
  protected readonly newKind = signal<(typeof KINDS)[number]>('FEE_NOTE');
  protected readonly practitionerId = signal('');
  protected readonly lang = signal<string>('fr');
  protected readonly notes = signal('');

  private readonly query = computed(() => ({ ...this.period(), kind: this.kind(), status: this.status(), duplicates: this.duplicatesOnly() ? true : undefined }));
  protected readonly exportQuery = computed(() => ({ ...this.period(), kind: this.kind() }));

  constructor() {
    effect(() => {
      const query = this.query();
      untracked(() => void this.documents.load(() => this.api.taxDocuments(query)));
    });
    refreshOnLive(['finance'], () => void this.documents.load(() => this.api.taxDocuments(this.query())));
  }

  protected openIssue(): void {
    this.patient.set(null);
    this.account.set(null);
    this.invoiceId.set('');
    this.newKind.set('FEE_NOTE');
    this.practitionerId.set('');
    this.lang.set(this.language.currentLang());
    this.notes.set('');
    this.issuing.set(true);
  }

  protected async pickPatient(patient: PickedPatient | null): Promise<void> {
    this.patient.set(patient);
    this.invoiceId.set('');
    this.account.set(null);
    if (patient) {
      try {
        const account = await this.api.account(patient.id);
        if (this.patient()?.id === patient.id) {
          this.account.set(account);
        }
      } catch (error) {
        this.errors.report(error);
      }
    }
  }

  protected async issue(): Promise<void> {
    if (this.busy() || !this.invoiceId()) {
      return;
    }
    await this.run(async () => {
      const created = await this.api.issueTaxDocument({
        kind: this.newKind(), invoiceId: this.invoiceId(), practitionerId: this.practitionerId() || undefined, lang: this.lang(), notes: this.notes().trim() || undefined,
      });
      this.issuing.set(false);
      this.toast.success(this.translate.instant('FIN.TAX.ISSUED_DONE', { number: created.number }));
    });
  }

  protected async view(d: TaxDocument): Promise<void> {
    try {
      await this.downloads.open(`/tax-documents/${d.id}/file`);
    } catch (error) {
      this.errors.report(error);
    }
  }

  protected async act(d: TaxDocument, action: 'deliver' | 'void'): Promise<void> {
    await this.run(() => this.api.taxDocumentAction(d.id, action).then(() => undefined));
  }

  protected async duplicate(d: TaxDocument): Promise<void> {
    await this.run(async () => {
      const copy = await this.api.duplicateTaxDocument(d.id, this.language.currentLang());
      this.toast.success(this.translate.instant('FIN.TAX.DUPLICATED', { number: copy.number }));
    });
  }

  protected async voidDoc(d: TaxDocument): Promise<void> {
    if (await this.confirm.confirm(this.translate.instant('FIN.TAX.VOID_CONFIRM', { number: d.number }), { danger: true })) {
      await this.act(d, 'void');
    }
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    try {
      await action();
      await this.documents.load(() => this.api.taxDocuments(this.query()));
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.busy.set(false);
    }
  }
}
