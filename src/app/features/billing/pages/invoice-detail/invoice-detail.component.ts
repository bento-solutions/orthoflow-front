import { IconComponent } from '../../../../shared/ui/icon.component';
import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { InvoiceService } from '../../services/invoice.service';
import { PageLabelService } from '../../../../core/services/page-label.service';
import { Invoice, Payment } from '../../models/billing.model';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ToastService } from '../../../../core/services/toast.service';
import { ApiErrors } from '../../../../core/services/api-error.service';
import { PracticeProfileService } from '../../../../core/services/practice-profile.service';
import { issueAndDownloadInvoicePdf } from '../../../../core/utils/invoice-pdf';
import { DownloadService } from '../../../../core/services/download.service';
import { LanguageService } from '../../../../core/services/language.service';
import { PatientService } from '../../../../core/services/patient.service';
import { MoneyPipe } from '../../../../shared/pipes/money.pipe';
import { AppDatePipe } from '../../../../shared/pipes/app-date.pipe';

@Component({
  selector: 'app-invoice-detail',
  standalone: true,
  imports: [IconComponent, AppDatePipe, MoneyPipe, CommonModule, RouterModule, FormsModule, TranslateModule],
  template: `
    @if (invoice(); as inv) {
      <div class="invoice-detail-container">
        <header class="page-header">
          <div class="header-content">
            <button type="button" class="back-btn" [attr.aria-label]="'COMMON.BACK' | translate" routerLink="..">
              <app-icon class="mi" name="arrow_back" size="1em" />
            </button>
            <div class="title-with-status">
              <p class="print-name">{{ 'BILLING.INVOICE_NUMBER' | translate }} <span class="ltr-data">{{ inv.invoiceNumber }}</span></p>
              <span class="status-badge" [class]="inv.status.toLowerCase().replace('_', '-')">
                {{ 'BILLING.STATUS.' + inv.status | translate }}
              </span>
            </div>
          </div>
          <div class="header-actions">
            <button type="button" class="btn btn-secondary" (click)="downloadPdf(inv)">
              <app-icon class="mi" name="download" size="1em" />
              PDF
            </button>
            <button type="button" class="btn btn-secondary" (click)="send(inv)">
              <app-icon class="mi" name="email" size="1em" />
              {{ 'BILLING.FORM.SEND' | translate }}
            </button>
            @if (inv.status === 'DRAFT') {
              <button type="button" class="btn btn-primary" (click)="issue(inv)">{{ 'BILLING.FORM.ISSUE' | translate }}</button>
            }
          </div>
        </header>

        <div class="detail-grid">
          <div class="main-content">
            <div class="invoice-card patient-card">
              <div class="card-header">
                <h3>{{ 'BILLING.FORM.PATIENT_PRACTICE' | translate }}</h3>
              </div>
              <div class="card-body info-grid">
                <div class="info-group">
                  <label>{{ 'BILLING.FORM.BILL_TO' | translate }}</label>
                  <span class="info-value">{{ inv.patientName || patients.nameFor(inv.patientId) || '—' }}</span>
                  <span class="info-sub">{{ 'PATIENTS.NAME' | translate }} ID: {{ inv.patientId }}</span>
                </div>
                <div class="info-group">
                  <label>{{ 'BILLING.FORM.PRACTICE' | translate }}</label>
                  <span class="info-value">{{ practice.name() || '—' }}</span>
                  @if (practiceAddress(); as address) { <span class="info-sub">{{ address }}</span> }
                </div>
                <div class="info-group">
                  <label>{{ 'BILLING.ISSUE_DATE' | translate }}</label>
                  <span class="info-value">{{ inv.issueDate | appDate }}</span>
                </div>
                <div class="info-group">
                  <label>{{ 'BILLING.EXPIRY_DATE' | translate }}</label>
                  <span class="info-value">{{ inv.dueDate | appDate }}</span>
                </div>
              </div>
            </div>

            <div class="invoice-card items-card">
              <div class="card-header">
                <h3>{{ 'BILLING.FORM.LINES' | translate }}</h3>
              </div>
              <table class="items-table">
                <thead>
                  <tr>
                    <th scope="col">{{ 'BILLING.FORM.DESCRIPTION' | translate }}</th>
                    <th scope="col" class="text-end">{{ 'BILLING.FORM.QTY' | translate }}</th>
                    <th scope="col" class="text-end">{{ 'BILLING.FORM.UNIT_PRICE' | translate }}</th>
                    <th scope="col" class="text-end">{{ 'BILLING.FORM.DISCOUNT' | translate }}</th>
                    <th scope="col" class="text-end">{{ 'COMMON.TOTAL' | translate }}</th>
                  </tr>
                </thead>
                <tbody>
                  @for (line of inv.lines; track $index) {
                    <tr>
                      <td>{{ line.label }}</td>
                      <td class="text-end">{{ line.quantity }}</td>
                      <td class="text-end">{{ line.unitPrice | money:inv.currency }}</td>
                      <td class="text-end">{{ line.discountPct }}%</td>
                      <td class="text-end font-bold">{{ line.lineTotal | money:inv.currency }}</td>
                    </tr>
                  }
                </tbody>
              </table>
              <div class="totals-section">
                <div class="total-row">
                  <span>{{ 'BILLING.FORM.SUBTOTAL' | translate }}</span>
                  <span>{{ inv.subtotal | money:inv.currency }}</span>
                </div>
                <div class="total-row">
                  <span>{{ 'BILLING.FORM.DISCOUNT' | translate }}</span>
                  <span class="text-success">-{{ inv.discountAmount | money:inv.currency }}</span>
                </div>
                <div class="total-row">
                  <span>{{ 'BILLING.FORM.TAX' | translate }}</span>
                  <span>{{ inv.taxAmount | money:inv.currency }}</span>
                </div>
                <div class="total-row grand-total">
                  <span>{{ 'COMMON.TOTAL' | translate }}</span>
                  <span>{{ inv.total | money:inv.currency }}</span>
                </div>
              </div>
            </div>

            <div class="invoice-card payments-card">
              <div class="card-header">
                <h3>{{ 'BILLING.PAYMENT_HISTORY' | translate }}</h3>
              </div>
              <div class="card-body">
                @if (inv.payments && inv.payments.length > 0) {
                  <div class="payment-timeline">
                    @for (payment of inv.payments; track payment.id) {
                      <div class="payment-item">
                        <div class="payment-icon" [ngSwitch]="payment.method">
                          <app-icon class="mi" *ngSwitchCase="'CASH'" name="payments" size="1em" />
                          <app-icon class="mi" *ngSwitchCase="'CARD'" name="credit_card" size="1em" />
                          <app-icon class="mi" *ngSwitchDefault name="account_balance" size="1em" />
                        </div>
                        <div class="payment-details">
                          <div class="payment-main">
                            <span class="payment-amount">{{ payment.amount | money:inv.currency }}</span>
                            <span class="payment-method">{{ 'BILLING.METHODS.' + payment.method | translate }}</span>
                          </div>
                          <div class="payment-meta">
                            <span>{{ payment.paymentDate | appDate }}</span>
                            <span>•</span>
                            <span>By {{ payment.recordedBy }}</span>
                          </div>
                        </div>
                      </div>
                    }
                  </div>
                } @else {
                  <p class="empty-msg">{{ 'BILLING.NO_PAYMENTS' | translate }}</p>
                }
              </div>
            </div>
          </div>

          <div class="sidebar">
            <div class="invoice-card balance-card">
              <div class="balance-content">
                <span class="balance-label">{{ 'BILLING.REMAINING_BALANCE' | translate }}</span>
                <span class="balance-value" [class.paid]="remainingBalance() === 0">
                  {{ remainingBalance() | money:inv.currency }}
                </span>
              </div>
              @if (remainingBalance() > 0) {
                <button type="button" class="btn btn-primary full-width" (click)="showPaymentForm.set(true)">
                  <app-icon class="mi" name="add" size="1em" />
                  {{ 'BILLING.RECORD_PAYMENT' | translate }}
                </button>
              }
            </div>

            @if (showPaymentForm()) {
              <div class="invoice-card payment-form-card">
                <div class="card-header">
                  <h3>{{ 'BILLING.RECORD_PAYMENT' | translate }}</h3>
                  <button type="button" class="icon-btn" [attr.aria-label]="'COMMON.CLOSE' | translate" (click)="showPaymentForm.set(false)">
                    <app-icon class="mi" name="close" size="1em" />
                  </button>
                </div>
                <div class="card-body">
                  <div class="form-group">
                    <label for="invoice-detail-paymentAmount">{{ 'COMMON.AMOUNT' | translate }}</label>
                    <input id="invoice-detail-paymentAmount" type="number" [(ngModel)]="paymentAmount" class="form-control">
                  </div>
                  <div class="form-group">
                    <label for="invoice-detail-paymentMethod">{{ 'BILLING.METHOD' | translate }}</label>
                    <select id="invoice-detail-paymentMethod" [(ngModel)]="paymentMethod" class="form-control">
                      <option value="CASH">{{ 'BILLING.METHODS.CASH' | translate }}</option>
                      <option value="CARD">{{ 'BILLING.METHODS.CARD' | translate }}</option>
                      <option value="BANK_TRANSFER">{{ 'BILLING.METHODS.BANK_TRANSFER' | translate }}</option>
                      <option value="CHEQUE">{{ 'BILLING.METHODS.CHEQUE' | translate }}</option>
                    </select>
                  </div>
                  <div class="form-group">
                    <label for="invoice-detail-paymentRef">{{ 'BILLING.REFERENCE' | translate }}</label>
                    <input id="invoice-detail-paymentRef" type="text" [(ngModel)]="paymentRef" class="form-control" [placeholder]="'COMMON.OPTIONAL' | translate">
                  </div>
                  <button type="button" class="btn btn-primary full-width mt-4" (click)="recordPayment()">
                    {{ 'COMMON.SUBMIT' | translate }}
                  </button>
                </div>
              </div>
            }
          </div>
        </div>
      </div>
    } @else {
      <div class="loading">{{ 'BILLING.LOADING_INVOICE' | translate }}</div>
    }
  `,
  styles: [`
    .invoice-detail-container {
      padding: 2rem;
      max-width: 1200px;
      margin: 0 auto;
    }

    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 2rem;
    }

    .header-content {
      display: flex;
      align-items: center;
      gap: 1.5rem;
    }

    .back-btn {
      background: var(--surface);
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
      transition: all 0.2s;
    }

    .back-btn:hover { background: rgb(var(--ink-50)); color: rgb(var(--petrol-800)); }
    .back-btn:focus-visible, .icon-btn:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }

    .title-with-status {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .print-name { display: none; margin: 0; }
    @media print {
      .print-name { display: block; font-size: var(--text-xl); font-weight: 800; }
    }

    .title-with-status h1 {
      margin: 0;
      font-size: var(--text-2xl);
      font-weight: 700;
      color: rgb(var(--ink-900));
    }

    .header-actions {
      display: flex;
      gap: 0.75rem;
    }

    .detail-grid {
      display: grid;
      grid-template-columns: 1fr 350px;
      gap: 2rem;
    }

    /* Named distinctly from the shared .card (which this doesn't fully
       match — hardcoded radius, an added margin-bottom) so it doesn't
       shadow the canonical class. */
    .invoice-card {
      background: var(--surface);
      border-radius: var(--radius-xl);
      border: 1px solid rgb(var(--ink-200));
      margin-bottom: 1.5rem;
      overflow: hidden;
    }

    .card-header {
      padding: 1.25rem 1.5rem;
      border-bottom: 1px solid rgb(var(--ink-100));
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .card-header h3 {
      margin: 0;
      font-size: var(--text-md);
      font-weight: 600;
      color: rgb(var(--ink-900));
    }

    .card-body {
      padding: 1.5rem;
    }

    .info-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 2rem;
    }

    .info-group {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .info-group label {
      font-size: var(--text-xs);
      font-weight: 600;
      color: rgb(var(--ink-500));
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .info-value {
      font-weight: 600;
      color: rgb(var(--ink-900));
    }

    .info-sub {
      font-size: var(--text-base);
      color: rgb(var(--ink-500));
    }

    .items-table {
      width: 100%;
      border-collapse: collapse;
    }

    .items-table th {
      background: rgb(var(--ink-50));
      padding: 0.75rem 1.5rem;
      font-size: var(--text-xs);
      font-weight: 600;
      color: rgb(var(--ink-500));
      text-transform: uppercase;
    }

    .items-table td {
      padding: 1rem 1.5rem;
      border-bottom: 1px solid rgb(var(--ink-100));
      color: rgb(var(--ink-700));
    }

    .text-right { text-align: end; }
    .font-bold { font-weight: 600; }

    .totals-section {
      padding: 1.5rem;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 0.75rem;
    }

    .total-row {
      display: flex;
      justify-content: space-between;
      width: 250px;
      font-size: var(--text-base);
      color: rgb(var(--ink-600));
    }

    .total-row.grand-total {
      margin-top: 0.5rem;
      padding-top: 1rem;
      border-top: 2px solid rgb(var(--ink-100));
      font-size: var(--text-lg);
      font-weight: 700;
      color: rgb(var(--ink-900));
    }

    .text-success { color: rgb(var(--positive-700)); }

    .payment-timeline {
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }

    .payment-item {
      display: flex;
      gap: 1rem;
      align-items: flex-start;
    }

    .payment-icon {
      width: 36px;
      height: 36px;
      border-radius: var(--radius-lg);
      background: rgb(var(--ink-100));
      color: rgb(var(--ink-600));
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .payment-details {
      flex: 1;
    }

    .payment-main {
      display: flex;
      justify-content: space-between;
      margin-bottom: 0.125rem;
    }

    .payment-amount { font-weight: 600; color: rgb(var(--ink-900)); }
    .payment-method { font-size: var(--text-xs); font-weight: 600; color: rgb(var(--ink-500)); text-transform: uppercase; }
    .payment-meta { font-size: var(--text-sm); color: rgb(var(--ink-500)); display: flex; gap: 0.5rem; }

    .balance-card {
      padding: 1.5rem;
      /* Dark in both themes: --ink-900 turns near-white in the dark theme, under white text. */
      background: var(--surface-inverse);
      color: var(--text-inverse);
      border: none;
    }

    .balance-content {
      display: flex;
      flex-direction: column;
      margin-bottom: 1.5rem;
    }

    .balance-label { font-size: var(--text-base); opacity: 0.8; }
    .balance-value { font-size: 2rem; font-weight: 700; }
    .balance-value.paid { color: rgb(var(--positive-700)); }

    .full-width { width: 100%; justify-content: center; }

    .form-group { margin-bottom: 1rem; }
    .form-group label { display: block; margin-bottom: 0.5rem; font-size: var(--text-base); font-weight: 500; }
    .form-control { width: 100%; padding: 0.75rem; border: 1px solid rgb(var(--ink-300)); border-radius: var(--radius-md); outline: none; }

    .mt-4 { margin-top: 1rem; }

    @media (max-width: 992px) {
      .detail-grid { grid-template-columns: 1fr; }
    }
  `]
})
export class InvoiceDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private invoiceService = inject(InvoiceService);
  private pageLabel = inject(PageLabelService);
  /** Read by the template to resolve the patient name off `patientId`. */
  protected patients = inject(PatientService);
  private toast = inject(ToastService);
  private errors = inject(ApiErrors);
  /** The clinic as its profile names it; this used to read "OrthoFlow Clinic, Casablanca" whatever the clinic. */
  protected practice = inject(PracticeProfileService);
  protected practiceAddress = computed(() => {
    const p = this.practice.profile();
    return [p?.address, p?.city].filter(Boolean).join(', ');
  });

  private downloads = inject(DownloadService);
  private language = inject(LanguageService);
  private translate = inject(TranslateService);

  /** Printing a draft issues it: the invoice handed to the patient is never a draft. */
  downloadPdf(invoice: Invoice): Promise<boolean> {
    return issueAndDownloadInvoicePdf(id => this.invoiceService.issueInvoice(id), this.downloads, invoice, this.language.currentLang())
      .then(current => {
        this.invoice.update(inv => (inv ? { ...inv, status: current.status } : inv));
        return true;
      })
      .catch(error => {
        this.errors.report(error, 'COMMON.EXPORT_FAILED');
        return false;
      });
  }

  /** Issues the invoice and hands over its PDF, to attach to an email or a WhatsApp message. */
  async send(invoice: Invoice): Promise<void> {
    if (await this.downloadPdf(invoice)) this.toast.success(this.translate.instant('BILLING.FORM.SEND_READY'));
  }

  /** "Émettre": the draft becomes the issued invoice. */
  issue(invoice: Invoice): void {
    this.invoiceService.issueInvoice(invoice.id).subscribe({
      next: issued => {
        this.invoice.update(inv => (inv ? { ...inv, status: issued.status } : inv));
        this.toast.success(this.translate.instant('BILLING.FORM.ISSUED'));
      },
      error: error => this.errors.report(error, 'COMMON.SAVE_FAILED'),
    });
  }

  invoice = signal<Invoice | null>(null);
  showPaymentForm = signal(false);

  paymentAmount = 0;
  paymentMethod: any = 'CASH';
  paymentRef = '';

  remainingBalance = signal(0);

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.invoiceService.getInvoice(id).subscribe(inv => {
        this.invoice.set(inv);
        this.pageLabel.set(`${this.translate.instant('BILLING.INVOICE_NUMBER')} ${inv.invoiceNumber}`);
        this.calculateBalance();
      });
    }
  }

  calculateBalance() {
    const inv = this.invoice();
    if (inv) {
      // Prefer the server-computed balanceDue (backend now returns payments
      // with every invoice); fall back to summing payments client-side.
      const balance = inv.balanceDue ?? (inv.total - (inv.payments?.reduce((sum, p) => sum + p.amount, 0) || 0));
      this.remainingBalance.set(Math.max(0, balance));
      this.paymentAmount = this.remainingBalance();
    }
  }

  recordPayment() {
    const inv = this.invoice();
    if (inv) {
      const paymentData = {
        amount: this.paymentAmount,
        method: this.paymentMethod,
        paymentDate: new Date().toISOString().split('T')[0],
        reference: this.paymentRef
      };

      this.invoiceService.recordPayment(inv.id, paymentData).subscribe({
        next: () => {
          // Refresh local state
          this.invoiceService.getInvoice(inv.id).subscribe(updatedInv => {
            this.invoice.set(updatedInv);
            this.calculateBalance();
            this.showPaymentForm.set(false);
          });
        },
        error: (err) => {
          console.error('Failed to record payment', err);
          this.toast.error(err.error?.detail || err.error?.message || 'Failed to record payment');
        }
      });
    }
  }
}
