import { IconComponent } from '../../../../shared/ui/icon.component';
import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { InvoiceService } from '../../services/invoice.service';
import { PatientService } from '../../../../core/services/patient.service';
import { PatientApiService } from '../../../../core/services/patient-api.service';
import { PatientPickerComponent, PickedPatient } from '../../../../shared/ui/patient-picker.component';
import { InvoiceDraftLine, CreateInvoiceRequest } from '../../models/billing.model';
import { OnInit } from '@angular/core';
import { finalize } from 'rxjs';
import { ToastService } from '../../../../core/services/toast.service';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { MoneyPipe } from '../../../../shared/pipes/money.pipe';
import { QuoteApi, linesToInvoice } from '../../../../core/services/quote-api.service';
import { PatientTreatmentService } from '../../../../core/services/patient-treatment.service';

@Component({
  selector: 'app-invoice-create',
  standalone: true,
  imports: [IconComponent, MoneyPipe, TranslateModule, CommonModule, RouterModule, FormsModule, PatientPickerComponent],
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

          @if (fromQuote(); as q) {
            <p class="from-quote" role="status"><app-icon name="file-text" [size]="16" /> {{ 'QUOTE.INVOICING_FROM' | translate: { number: q.number } }}</p>
          }
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

    /* The lines are a table: on a narrow screen it scrolls on its own, and the page does not. */
    .form-grid > * { min-width: 0; }
    .line-items-table { overflow-x: auto; }
    .line-items-table > * { min-width: 49rem; }

    /* Below this width the summary moves under the form, so a whole line still fits
       side by side instead of the line table having to scroll. */
    .from-quote { display: flex; align-items: center; gap: .5rem; margin: 0 0 1rem; padding: .625rem .875rem; border-radius: var(--radius-md);
      background: var(--status-active-tint, rgb(var(--petrol-50))); color: rgb(var(--ink-800)); font-weight: 600; }
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
  // An invoice starts with one empty line, not a sample one somebody has to notice and delete.
  lines = signal<InvoiceDraftLine[]>([emptyLine(0)]);
  /** Opened from a devis ("Facturer"): its accepted lines are billed and marked billed on it. */
  readonly fromQuote = signal<{ id: string; number: string; lineIds: string[] } | null>(null);
  private readonly quoteApi = inject(QuoteApi);
  private readonly patientTreatments = inject(PatientTreatmentService);

  loading = signal(false);

  ngOnInit() {
    this.route.queryParams.subscribe(params => {
      if (params['patientId']) {
        const id = params['patientId'];
        this.selectedPatientId = id;
        this.patientApi.getPatient(id).subscribe({
          next: (p) => this.pickedPatient.set({ id: p.id, name: `${p.lastName} ${p.firstName}`.trim(), phone: p.phone || undefined }),
          error: () => this.pickedPatient.set(null),
        });
        if (params['quoteId']) void this.prefillFromQuote(params['quoteId'], String(params['quoteLines'] ?? '').split(',').filter(Boolean));
        else if (params['treatmentIds']) this.prefillFromTreatments(id, String(params['treatmentIds']).split(',').filter(Boolean));
      }
    });
    this.calculateTotal();
  }

  /** The accepted lines of the devis not invoiced yet (or those asked for), at the devis's prices. */
  private async prefillFromQuote(quoteId: string, lineIds: string[]): Promise<void> {
    try {
      const quote = await this.quoteApi.get(quoteId);
      const wanted = linesToInvoice(quote).filter(l => !lineIds.length || lineIds.includes(l.id));
      if (!wanted.length) {
        this.toast.error(this.translate.instant('QUOTE.NOTHING_TO_INVOICE'));
        return;
      }
      this.fromQuote.set({ id: quote.id, number: quote.quoteNumber, lineIds: wanted.map(l => l.id) });
      this.notes = this.notes || this.translate.instant('QUOTE.INVOICE_NOTE', { number: quote.quoteNumber });
      this.lines.set(wanted.map((l, i) => ({
        actCode: l.actCode || 'ACTE',
        label: l.teeth ? `${l.label} (${this.translate.instant('QUOTE.TOOTH')} ${l.teeth})` : l.label,
        quantity: l.quantity, unitPrice: l.unitPrice, discountPct: l.discountPct, lineTotal: l.lineTotal, sortOrder: i,
      })));
      this.calculateTotal();
    } catch {
      this.toast.error(this.translate.instant('QUOTE.LOAD_FAILED'));
    }
  }

  /** Treatments from the patient's file, at the catalogue price. */
  private prefillFromTreatments(patientId: string, ids: string[]): void {
    this.patientTreatments.getPatientTreatments(patientId).subscribe(list => {
      const picked = list.filter(t => t.id && ids.includes(t.id) && t.treatment);
      if (!picked.length) return;
      this.lines.set(picked.map((t, i) => {
        const price = t.treatment.basePrice ?? 0;
        return {
          actCode: t.treatment.actCode || t.treatment.code || 'ACTE',
          label: t.teeth ? `${t.treatment.name} (${this.translate.instant('QUOTE.TOOTH')} ${t.teeth})` : t.treatment.name,
          quantity: 1, unitPrice: price, discountPct: 0, lineTotal: price, sortOrder: i,
        };
      }));
      this.calculateTotal();
    });
  }

  subtotal = signal(0);
  discountAmount = signal(0);
  total = signal(0);

  addLine() {
    this.lines.update(l => [...l, emptyLine(l.length)]);
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
      lines: this.lines(),
    };

    const quote = this.fromQuote();
    if (quote) {
      if (invoiceData.patientId !== this.route.snapshot.queryParamMap.get('patientId')) {
        this.loading.set(false);
        this.toast.error(this.translate.instant('QUOTE.WRONG_PATIENT'));
        return;
      }
      this.quoteApi.invoice(quote.id, { quoteLineIds: quote.lineIds, invoice: invoiceData })
        .then(created => {
          this.toast.success(this.translate.instant('BILLING.FORM.CREATED'));
          void this.router.navigate(['/billing/invoices', created.id]);
        }, err => this.toast.error(err?.error?.detail || this.translate.instant('QUOTE.INVOICE_FAILED')))
        .finally(() => this.loading.set(false));
      return;
    }

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

function emptyLine(sortOrder: number): InvoiceDraftLine {
  return { actCode: '', label: '', quantity: 1, unitPrice: 0, discountPct: 0, lineTotal: 0, sortOrder };
}
