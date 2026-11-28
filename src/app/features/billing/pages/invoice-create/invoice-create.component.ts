import { IconComponent } from '../../../../shared/ui/icon.component';
import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { InvoiceService } from '../../services/invoice.service';
import { PatientService } from '../../../../core/services/patient.service';
import { PatientApiService } from '../../../../core/services/patient-api.service';
import { PatientPickerComponent, PickedPatient } from '../../../../shared/ui/patient-picker.component';
import { InvoiceDraftLine, CreateInvoiceRequest, PaymentFrequency, PaymentTermsRequest } from '../../models/billing.model';
import { PaymentChoice, after, isoDay, previewSchedule } from '../../utils/payment-schedule';
import { AppDatePipe } from '../../../../shared/pipes/app-date.pipe';
import { OnInit } from '@angular/core';
import { finalize } from 'rxjs';
import { ToastService } from '../../../../core/services/toast.service';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MoneyPipe } from '../../../../shared/pipes/money.pipe';

@Component({
  selector: 'app-invoice-create',
  standalone: true,
  imports: [IconComponent, MoneyPipe, AppDatePipe, TranslateModule, CommonModule, RouterModule, FormsModule, PatientPickerComponent],
  template: `
    <div class="create-invoice-container">
      <header class="page-header">
        <div class="header-content">
          <button type="button" class="back-btn" [attr.aria-label]="'COMMON.BACK' | translate" routerLink="..">
            <app-icon class="mi" name="arrow_back" size="1em" />
          </button>
        </div>
      </header>

      <div class="form-grid">
        <div class="main-form">
          <section class="form-section">
            <h2>{{ 'BILLING.FORM.PATIENT_INFO' | translate }}</h2>
            <div class="field-group">
              <!-- Searched on the server as you type: a dropdown of every patient stopped at the first 200 (audit P1). -->
              <span class="field-label" id="invoice-create-patient-label">{{ 'BILLING.FORM.SELECT_PATIENT' | translate }}</span>
              <app-patient-picker [value]="pickedPatient()" (valueChange)="pickPatient($event)"
                [label]="'BILLING.FORM.SELECT_PATIENT' | translate" />
            </div>
          </section>

          <section class="form-section">
            <div class="section-header">
              <h2>{{ 'BILLING.FORM.LINES' | translate }}</h2>
              <button type="button" class="btn-text" (click)="addLine()">
                <app-icon class="mi" name="add" size="1em" /> {{ 'BILLING.FORM.ADD_LINE' | translate }}
              </button>
            </div>
            
            <div class="line-items-table">
              <div class="table-header">
                <span class="col-act">{{ 'BILLING.FORM.ACT_CODE' | translate }}</span>
                <span class="col-desc">{{ 'BILLING.FORM.DESCRIPTION' | translate }}</span>
                <span class="col-qty">{{ 'BILLING.FORM.QTY' | translate }}</span>
                <span class="col-price">{{ 'BILLING.FORM.UNIT_PRICE' | translate }}</span>
                <span class="col-discount">{{ 'BILLING.FORM.DISCOUNT_PCT' | translate }}</span>
                <span class="col-total">{{ 'COMMON.TOTAL' | translate }}</span>
                <span class="col-action"></span>
              </div>

              @for (line of lines(); track $index) {
                <div class="line-item-row">
                  <input type="text" [attr.aria-label]="'BILLING.FORM.ACT_CODE' | translate" [(ngModel)]="line.actCode" [placeholder]="'BILLING.FORM.ACT_CODE_HINT' | translate" class="form-control col-act" required>
                  <input type="text" [attr.aria-label]="'BILLING.FORM.DESCRIPTION' | translate" [(ngModel)]="line.label" [placeholder]="'BILLING.FORM.DESCRIPTION_HINT' | translate" class="form-control col-desc">
                  <input type="number" [attr.aria-label]="'BILLING.FORM.QTY' | translate" [(ngModel)]="line.quantity" (ngModelChange)="calculateTotal()" class="form-control col-qty">
                  <input type="number" [attr.aria-label]="'BILLING.FORM.UNIT_PRICE' | translate" [(ngModel)]="line.unitPrice" (ngModelChange)="calculateTotal()" class="form-control col-price">
                  <input type="number" [attr.aria-label]="'BILLING.FORM.DISCOUNT_PCT' | translate" [(ngModel)]="line.discountPct" (ngModelChange)="calculateTotal()" class="form-control col-discount">
                  <span class="col-total">{{ line.lineTotal | money }}</span>
                  <button type="button" class="icon-btn-danger col-action" [attr.aria-label]="'BILLING.FORM.REMOVE_LINE' | translate" (click)="removeLine($index)">
                    <app-icon class="mi" name="delete" size="1em" />
                  </button>
                </div>
              }
            </div>
          </section>

          <section class="form-section">
            <h2>{{ 'COMMON.NOTES' | translate }}</h2>
            <textarea [attr.aria-label]="'COMMON.NOTES' | translate" [(ngModel)]="notes" [placeholder]="'BILLING.FORM.NOTES_HINT' | translate" class="form-control" rows="4"></textarea>
          </section>

          <section class="form-section" aria-labelledby="invoice-create-terms">
            <h2 id="invoice-create-terms">{{ 'BILLING.PAYMENT_TERMS.TITLE' | translate }}</h2>
            <div class="terms-choice" role="radiogroup" [attr.aria-label]="'BILLING.PAYMENT_TERMS.TITLE' | translate">
              @for (choice of choices; track choice) {
                <label class="terms-option" [class.selected]="paymentChoice() === choice">
                  <input type="radio" name="invoice-payment-choice" [value]="choice" [checked]="paymentChoice() === choice" (change)="paymentChoice.set(choice)">
                  <span class="terms-name">{{ 'BILLING.PAYMENT_TERMS.' + choice | translate }}</span>
                  <span class="terms-hint">{{ 'BILLING.PAYMENT_TERMS.' + choice + '_HINT' | translate }}</span>
                </label>
              }
            </div>

            @if (paymentChoice() === 'ONE_PAYMENT') {
              <div class="terms-fields">
                <div class="field-group">
                  <label for="invoice-create-deadline">{{ 'BILLING.PAYMENT_TERMS.DEADLINE' | translate }}</label>
                  <input id="invoice-create-deadline" type="date" class="form-control" [min]="today" [ngModel]="singleDeadline()" (ngModelChange)="singleDeadline.set($event)">
                </div>
              </div>
            }
            @if (paymentChoice() === 'INSTALMENTS') {
              <div class="terms-fields">
                <div class="field-group">
                  <label for="invoice-create-parts">{{ 'BILLING.PAYMENT_TERMS.PARTS' | translate }}</label>
                  <input id="invoice-create-parts" type="number" min="2" max="120" class="form-control" [ngModel]="instalmentCount()" (ngModelChange)="instalmentCount.set(+$event)">
                </div>
                <div class="field-group">
                  <label for="invoice-create-frequency">{{ 'BILLING.PAYMENT_TERMS.FREQUENCY' | translate }}</label>
                  <select id="invoice-create-frequency" class="form-control" [ngModel]="frequency()" (ngModelChange)="frequency.set($event)">
                    @for (f of frequencies; track f) {
                      <option [value]="f">{{ 'BILLING.PAYMENT_TERMS.FREQ.' + f | translate }}</option>
                    }
                  </select>
                </div>
                <div class="field-group">
                  <label for="invoice-create-first">{{ 'BILLING.PAYMENT_TERMS.FIRST_DEADLINE' | translate }}</label>
                  <input id="invoice-create-first" type="date" class="form-control" [min]="today" [ngModel]="firstDeadline()" (ngModelChange)="firstDeadline.set($event)">
                </div>
              </div>
            }

            @if (paymentChoice() === 'IMMEDIATE') {
              <p class="terms-note">{{ 'BILLING.PAYMENT_TERMS.NO_DEADLINE' | translate }}</p>
            } @else if (schedule().length) {
              <div class="schedule-preview">
                <h3>{{ 'BILLING.PAYMENT_TERMS.SCHEDULE' | translate }}</h3>
                <ol>
                  @for (part of schedule(); track part.seq) {
                    <li>
                      <span class="part-name">{{ 'BILLING.PAYMENT_TERMS.PART' | translate: { n: part.seq, count: schedule().length } }}</span>
                      <span class="part-date">{{ part.dueDate | appDate }}</span>
                      <span class="part-amount">{{ part.amount | money }}</span>
                    </li>
                  }
                </ol>
              </div>
            }
          </section>
        </div>

        <div class="summary-sidebar">
          <div class="summary-card">
            <h2>{{ 'BILLING.FORM.SUMMARY' | translate }}</h2>
            <div class="summary-row">
              <span>{{ 'BILLING.FORM.SUBTOTAL' | translate }}</span>
              <span>{{ subtotal() | money }}</span>
            </div>
            <div class="summary-row">
              <span>{{ 'BILLING.FORM.DISCOUNT' | translate }}</span>
              <span class="discount-text">-{{ discountAmount() | money }}</span>
            </div>
            <div class="summary-row">
              <span>{{ 'BILLING.FORM.TAX_ZERO' | translate }}</span>
              <span>{{ 0 | money }}</span>
            </div>
            <hr>
            <div class="summary-row total">
              <span>{{ 'COMMON.TOTAL' | translate }}</span>
              <span>{{ total() | money }}</span>
            </div>

            <div class="sidebar-actions">
              <button type="button" class="btn btn-primary full-width" (click)="saveInvoice()">
                <app-icon class="mi" name="save" size="1em" />
                {{ 'BILLING.FORM.CREATE' | translate }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .create-invoice-container {
      padding: 2rem;
      max-width: 1440px;
      margin: 0 auto;
    }

    .page-header {
      margin-bottom: 2rem;
    }

    .header-content {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .back-btn {
      background: transparent;
      border: 1px solid rgb(var(--ink-200));
      border-radius: var(--radius-lg);
      padding: 0.5rem;
      min-width: 44px;
      min-height: 44px;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      display: flex;
      color: rgb(var(--ink-500));
    }

    .back-btn:focus-visible,
    .icon-btn-danger:focus-visible {
      outline: 2px solid var(--focus-ring);
      outline-offset: 2px;
    }

    .header-content h1 {
      font-size: var(--text-2xl);
      font-weight: 700;
      color: rgb(var(--ink-900));
      margin: 0;
    }

    .form-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 320px;
      gap: 2rem;
    }

    .form-section {
      background: var(--surface);
      border-radius: var(--radius-xl);
      border: 1px solid rgb(var(--ink-200));
      padding: 1.5rem;
      margin-bottom: 1.5rem;
    }

    .form-section h2 {
      margin: 0 0 1.25rem 0;
      font-size: var(--text-lg);
      font-weight: 600;
      color: rgb(var(--ink-900));
    }

    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.25rem;
    }

    .section-header h2 { margin: 0; }

    .field-group {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    label {
      font-size: var(--text-base);
      font-weight: 500;
      color: rgb(var(--ink-700));
    }

    .form-control {
      border: 1px solid rgb(var(--ink-300));
      border-radius: var(--radius-lg);
      padding: 0.75rem 1rem;
      font-size: var(--text-base);
      outline: none;
      transition: border-color 0.2s;
    }

    textarea.form-control { width: 100%; resize: vertical; }

    .form-control:focus {
      border-color: rgb(var(--petrol-900));
      box-shadow: 0 0 0 3px rgb(var(--petrol-500) / 0.15);
    }

    .line-items-table {
      /* act code | description | qty | unit price | disc % | total | remove */
      --line-cols: minmax(6.5rem, 1fr) minmax(11rem, 2.4fr) 4.5rem 7rem 4.5rem 7.5rem 2.75rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .table-header {
      display: grid;
      grid-template-columns: var(--line-cols);
      gap: 0.75rem;
      padding: 0 0.75rem;
      font-size: var(--text-xs);
      font-weight: 600;
      color: rgb(var(--ink-500));
      text-transform: uppercase;
    }

    .line-item-row {
      display: grid;
      grid-template-columns: var(--line-cols);
      gap: 0.75rem;
      align-items: center;
    }

    /* Inputs fill their column exactly, so each one sits under its header (a number input's
       intrinsic width used to push the row's columns out of line with the header's). */
    .line-item-row .form-control {
      width: 100%;
      min-width: 0;
      padding: 0.625rem 0.75rem;
    }

    .table-header .col-total, .line-item-row .col-total { text-align: end; white-space: nowrap; }

    .col-total {
      font-weight: 600;
      color: rgb(var(--ink-900));
      text-align: end;
    }

    .btn-text {
      background: transparent;
      border: none;
      color: rgb(var(--petrol-800));
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 0.25rem;
      cursor: pointer;
    }

    .icon-btn-danger {
      background: transparent;
      border: none;
      color: rgb(var(--critical-700));
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      min-width: 44px;
      min-height: 44px;
      padding: 0.5rem;
      border-radius: var(--radius-md);
    }

    .icon-btn-danger:hover { background: rgb(var(--critical-50)); }

    .summary-card {
      background: var(--surface);
      border-radius: var(--radius-xl);
      border: 1px solid rgb(var(--ink-200));
      padding: 1.5rem;
      position: sticky;
      top: 2rem;
    }

    .summary-card h2 {
      margin: 0 0 1.25rem 0;
      font-size: var(--text-lg);
      font-weight: 600;
    }

    .summary-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 0.75rem;
      color: rgb(var(--ink-600));
      font-weight: 500;
    }

    .summary-row.total {
      margin-top: 1rem;
      font-size: var(--text-lg);
      font-weight: 700;
      color: rgb(var(--ink-900));
    }

    .discount-text { color: rgb(var(--positive-700)); }

    .sidebar-actions {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      margin-top: 1.5rem;
    }

    .full-width { width: 100%; justify-content: center; }

    .terms-choice {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 0.75rem;
    }
    .terms-option {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      padding: 0.875rem 1rem;
      border: 1px solid rgb(var(--ink-200));
      border-radius: var(--radius-lg);
      cursor: pointer;
      position: relative;
    }
    .terms-option input { position: absolute; opacity: 0; pointer-events: none; }
    .terms-option:focus-within { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
    .terms-option.selected { border-color: rgb(var(--petrol-800)); background: rgb(var(--petrol-500) / 0.08); }
    .terms-name { font-weight: 600; color: rgb(var(--ink-900)); }
    .terms-hint { font-size: var(--text-sm); color: rgb(var(--ink-500)); }
    .terms-fields {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
      gap: 1rem;
      margin-top: 1.25rem;
    }
    .terms-note { margin: 1rem 0 0; color: rgb(var(--ink-600)); }
    .schedule-preview { margin-top: 1.25rem; }
    .schedule-preview h3 {
      margin: 0 0 0.5rem;
      font-size: var(--text-sm);
      font-weight: 600;
      color: rgb(var(--ink-500));
      text-transform: uppercase;
    }
    .schedule-preview ol { list-style: none; margin: 0; padding: 0; }
    .schedule-preview li {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto 8rem;
      gap: 1rem;
      padding: 0.5rem 0;
      border-bottom: 1px solid rgb(var(--ink-100));
    }
    .part-name { color: rgb(var(--ink-700)); }
    .part-date { color: rgb(var(--ink-900)); font-weight: 500; }
    .part-amount { text-align: end; font-weight: 600; color: rgb(var(--ink-900)); }
    @media (max-width: 720px) {
      .terms-choice { grid-template-columns: 1fr; }
    }

    /* The lines are a table: on a narrow screen it scrolls on its own, and the page does not. */
    .form-grid > * { min-width: 0; }
    .line-items-table { overflow-x: auto; }
    .line-items-table > * { min-width: 49rem; }

    /* Below this width the summary moves under the form, so a whole line still fits
       side by side instead of the line table having to scroll. */
    @media (max-width: 1360px) {
      .form-grid { grid-template-columns: 1fr; }
      .summary-card { position: static; }
    }
  `]
})
export class InvoiceCreateComponent implements OnInit {
  private readonly translate = inject(TranslateService);
  invoiceService = inject(InvoiceService);
  patientService = inject(PatientService);
  router = inject(Router);
  route = inject(ActivatedRoute);
  private toast = inject(ToastService);

  selectedPatientId = '';
  readonly pickedPatient = signal<PickedPatient | null>(null);
  private readonly patientApi = inject(PatientApiService);

  pickPatient(patient: PickedPatient | null): void {
    this.pickedPatient.set(patient);
    this.selectedPatientId = patient?.id ?? '';
  }
  treatmentPlanId = '';
  notes = '';
  lines = signal<InvoiceDraftLine[]>([
    { actCode: 'ORTHO-01', label: 'Orthodontic Treatment - Monthly Fee', quantity: 1, unitPrice: 1500, discountPct: 0, lineTotal: 1500, sortOrder: 0 }
  ]);

  loading = signal(false);

  // ── Payment terms ──
  readonly choices: PaymentChoice[] = ['IMMEDIATE', 'ONE_PAYMENT', 'INSTALMENTS'];
  readonly frequencies: PaymentFrequency[] = ['MONTHLY', 'BIWEEKLY', 'WEEKLY', 'QUARTERLY'];
  readonly today = isoDay(new Date());
  readonly paymentChoice = signal<PaymentChoice>('IMMEDIATE');
  readonly singleDeadline = signal(after(this.today, 'MONTHLY', 1));
  readonly instalmentCount = signal(3);
  readonly frequency = signal<PaymentFrequency>('MONTHLY');
  readonly firstDeadline = signal(after(this.today, 'MONTHLY', 1));

  /** The parts and their deadlines as the server will create them. */
  readonly schedule = computed(() => {
    switch (this.paymentChoice()) {
      case 'IMMEDIATE': return [];
      case 'ONE_PAYMENT': return this.singleDeadline() ? previewSchedule(this.total(), 1, 'MONTHLY', this.singleDeadline()) : [];
      case 'INSTALMENTS': {
        const n = this.instalmentCount();
        return this.firstDeadline() && n >= 2 && n <= 120 ? previewSchedule(this.total(), n, this.frequency(), this.firstDeadline()) : [];
      }
    }
  });

  /** The terms to send, or the key of what is missing. */
  private paymentTerms(): PaymentTermsRequest | string {
    switch (this.paymentChoice()) {
      case 'IMMEDIATE':
        return { mode: 'IMMEDIATE' };
      case 'ONE_PAYMENT': {
        const due = this.singleDeadline();
        if (!due) return 'BILLING.PAYMENT_TERMS.NEED_DEADLINE';
        if (due < this.today) return 'BILLING.PAYMENT_TERMS.DEADLINE_PAST';
        return { mode: 'INSTALMENTS', instalmentCount: 1, frequency: 'MONTHLY', firstDueDate: due };
      }
      case 'INSTALMENTS': {
        const first = this.firstDeadline();
        const n = this.instalmentCount();
        if (!Number.isInteger(n) || n < 2 || n > 120) return 'BILLING.PAYMENT_TERMS.NEED_PARTS';
        if (!first) return 'BILLING.PAYMENT_TERMS.NEED_DEADLINE';
        if (first < this.today) return 'BILLING.PAYMENT_TERMS.DEADLINE_PAST';
        return { mode: 'INSTALMENTS', instalmentCount: n, frequency: this.frequency(), firstDueDate: first };
      }
    }
  }

  ngOnInit() {
    this.route.queryParams.subscribe(params => {
      if (params['patientId']) {
        const id = params['patientId'];
        this.selectedPatientId = id;
        this.patientApi.getPatient(id).subscribe({
          next: (p) => this.pickedPatient.set({ id: p.id, name: `${p.lastName} ${p.firstName}`.trim(), phone: p.phone || undefined }),
          error: () => this.pickedPatient.set(null),
        });
      }
    });
    this.calculateTotal();
  }

  subtotal = signal(0);
  discountAmount = signal(0);
  total = signal(0);

  addLine() {
    this.lines.update(l => [...l, {
      actCode: '',
      label: '',
      quantity: 1,
      unitPrice: 0,
      discountPct: 0,
      lineTotal: 0,
      sortOrder: l.length
    }]);
  }

  removeLine(index: number) {
    this.lines.update(l => l.filter((_, i) => i !== index));
    this.calculateTotal();
  }

  calculateTotal() {
    let sub = 0;
    let disc = 0;

    const updatedLines = this.lines().map(line => {
      const lineSub = line.quantity * line.unitPrice;
      const lineDisc = (lineSub * line.discountPct) / 100;
      const lineTotal = lineSub - lineDisc;
      
      sub += lineSub;
      disc += lineDisc;

      return { ...line, lineTotal };
    });

    this.lines.set(updatedLines);
    this.subtotal.set(sub);
    this.discountAmount.set(disc);
    this.total.set(sub - disc);
  }

  saveInvoice() {
    if (!this.selectedPatientId) {
      this.toast.error(this.translate.instant('BILLING.FORM.NEED_PATIENT'));
      return;
    }
    if (!this.lines().length) {
      this.toast.error(this.translate.instant('BILLING.FORM.NEED_LINE'));
      return;
    }
    /* actCode and label are @NotBlank on the server's InvoiceLineRequest.
       Submitting without them returns a 400 that the user could only read as
       a generic failure, so catch it here where the offending line is
       visible. */
    if (this.lines().some(l => !l.actCode?.trim() || !l.label?.trim())) {
      this.toast.error(this.translate.instant('BILLING.FORM.LINE_INCOMPLETE'));
      return;
    }

    const payment = this.paymentTerms();
    if (typeof payment === 'string') {
      this.toast.error(this.translate.instant(payment));
      return;
    }

    this.loading.set(true);
    // Only fields the backend's CreateInvoiceRequest actually accepts are
    // sent — status, issue/due dates, subtotal, tax and totals are computed
    // server-side, which is authoritative (previously the client computed
    // and displayed these while the server silently discarded them and
    // computed different values — audit III.8).
    const invoiceData: CreateInvoiceRequest = {
      practiceId: '00000000-0000-0000-0000-000000000001', // Mock practice ID until multi-tenancy exists
      patientId: this.selectedPatientId,
      treatmentPlanId: this.treatmentPlanId || undefined,
      currency: 'MAD',
      regionCode: 'MA',
      notes: this.notes,
      payment,
      lines: this.lines(),
    };

    this.invoiceService.createInvoice(invoiceData)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: () => {
          this.toast.success(this.translate.instant('BILLING.FORM.CREATED'));
          this.router.navigate(['/billing/invoices']);
        },
        error: (err) => {
          console.error('Failed to create invoice', err);
          this.toast.error(err.error?.detail || 'Failed to create invoice. Please try again.');
        }
      });
  }
}
