import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { InvoiceService } from '../../services/invoice.service';
import { PatientService } from '../../../../core/services/patient.service';
import { InvoiceDraftLine, CreateInvoiceRequest } from '../../models/billing.model';
import { OnInit } from '@angular/core';
import { finalize } from 'rxjs';
import { ToastService } from '../../../../core/services/toast.service';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

@Component({
  selector: 'app-invoice-create',
  standalone: true,
  imports: [TranslateModule, CommonModule, RouterModule, FormsModule],
  template: `
    <div class="create-invoice-container">
      <header class="page-header">
        <div class="header-content">
          <button type="button" class="back-btn" [attr.aria-label]="'COMMON.BACK' | translate" routerLink="..">
            <span class="material-icons" aria-hidden="true">arrow_back</span>
          </button>
          <h1>{{ 'BILLING.NEW_INVOICE' | translate }}</h1>
        </div>
      </header>

      <div class="form-grid">
        <div class="main-form">
          <section class="form-section">
            <h2>{{ 'BILLING.FORM.PATIENT_INFO' | translate }}</h2>
            <div class="field-group">
              <label for="invoice-create-selectedPatientId">{{ 'BILLING.FORM.SELECT_PATIENT' | translate }}</label>
              <select id="invoice-create-selectedPatientId" [(ngModel)]="selectedPatientId" class="form-control">
                <option value="">{{ 'BILLING.FORM.SELECT_PATIENT_HINT' | translate }}</option>
                @for (patient of patientService.patients(); track patient.id) {
                  <option [value]="patient.id">{{ patient.firstName }} {{ patient.lastName }}</option>
                }
              </select>
            </div>
          </section>

          <section class="form-section">
            <div class="section-header">
              <h2>{{ 'BILLING.FORM.LINES' | translate }}</h2>
              <button type="button" class="btn-text" (click)="addLine()">
                <span aria-hidden="true" class="material-icons">add</span> {{ 'BILLING.FORM.ADD_LINE' | translate }}
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
                  <span class="col-total">{{ line.lineTotal | number:'1.2-2' }}</span>
                  <button type="button" class="icon-btn-danger col-action" [attr.aria-label]="'BILLING.FORM.REMOVE_LINE' | translate" (click)="removeLine($index)">
                    <span class="material-icons" aria-hidden="true">delete</span>
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
              <span>{{ subtotal() | number:'1.2-2' }} MAD</span>
            </div>
            <div class="summary-row">
              <span>{{ 'BILLING.FORM.DISCOUNT' | translate }}</span>
              <span class="discount-text">-{{ discountAmount() | number:'1.2-2' }} MAD</span>
            </div>
            <div class="summary-row">
              <span>{{ 'BILLING.FORM.TAX_ZERO' | translate }}</span>
              <span>0.00 MAD</span>
            </div>
            <hr>
            <div class="summary-row total">
              <span>{{ 'COMMON.TOTAL' | translate }}</span>
              <span>{{ total() | number:'1.2-2' }} MAD</span>
            </div>

            <div class="sidebar-actions">
              <button type="button" class="btn btn-primary full-width" (click)="saveInvoice()">
                <span aria-hidden="true" class="material-icons">save</span>
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
      max-width: 1200px;
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
      border-radius: 10px;
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
      font-size: 1.875rem;
      font-weight: 700;
      color: rgb(var(--ink-900));
      margin: 0;
    }

    .form-grid {
      display: grid;
      grid-template-columns: 1fr 350px;
      gap: 2rem;
    }

    .form-section {
      background: var(--surface);
      border-radius: 16px;
      border: 1px solid rgb(var(--ink-200));
      padding: 1.5rem;
      margin-bottom: 1.5rem;
    }

    .form-section h2 {
      margin: 0 0 1.25rem 0;
      font-size: 1.125rem;
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
      font-size: 0.875rem;
      font-weight: 500;
      color: rgb(var(--ink-700));
    }

    .form-control {
      border: 1px solid rgb(var(--ink-300));
      border-radius: 10px;
      padding: 0.75rem 1rem;
      font-size: 0.95rem;
      outline: none;
      transition: border-color 0.2s;
    }

    .form-control:focus {
      border-color: rgb(var(--petrol-900));
      box-shadow: 0 0 0 3px rgba(3, 4, 94, 0.1);
    }

    .line-items-table {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .table-header {
      display: grid;
      grid-template-columns: 110px 1fr 80px 120px 80px 100px 40px;
      gap: 1rem;
      padding: 0 0.5rem;
      font-size: 0.75rem;
      font-weight: 600;
      color: rgb(var(--ink-500));
      text-transform: uppercase;
    }

    .line-item-row {
      display: grid;
      grid-template-columns: 110px 1fr 80px 120px 80px 100px 40px;
      gap: 1rem;
      align-items: center;
    }

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
      border-radius: 8px;
    }

    .icon-btn-danger:hover { background: rgb(var(--critical-50)); }

    .summary-card {
      background: var(--surface);
      border-radius: 16px;
      border: 1px solid rgb(var(--ink-200));
      padding: 1.5rem;
      position: sticky;
      top: 2rem;
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
      font-size: 1.25rem;
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
    .line-items-table > * { min-width: 40rem; }

    @media (max-width: 992px) {
      .form-grid { grid-template-columns: 1fr; }
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
  treatmentPlanId = '';
  notes = '';
  lines = signal<InvoiceDraftLine[]>([
    { actCode: 'ORTHO-01', label: 'Orthodontic Treatment - Monthly Fee', quantity: 1, unitPrice: 1500, discountPct: 0, lineTotal: 1500, sortOrder: 0 }
  ]);

  loading = signal(false);

  ngOnInit() {
    this.route.queryParams.subscribe(params => {
      if (params['patientId']) {
        this.selectedPatientId = params['patientId'];
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
