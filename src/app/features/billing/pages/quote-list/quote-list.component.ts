import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { InvoiceService } from '../../services/invoice.service';

@Component({
  selector: 'app-quote-list',
  standalone: true,
  imports: [CommonModule, RouterModule, TranslateModule],
  template: `
    <div class="billing-container">
      <header class="page-header">
        <div class="header-content">
          <button type="button" class="back-btn" [attr.aria-label]="'COMMON.BACK' | translate" routerLink="/billing/invoices">
            <span class="material-icons" aria-hidden="true">arrow_back</span>
          </button>
          <div class="title-meta">
            <h1>{{ 'BILLING.QUOTES_TITLE' | translate }}</h1>
            <p>{{ 'BILLING.QUOTES_SUBTITLE' | translate }}</p>
          </div>
        </div>
        <button type="button" class="btn btn-primary">
          <span class="material-icons">add</span>
          {{ 'BILLING.NEW_QUOTE' | translate }}
        </button>
      </header>

      <div class="table-wrap">
        <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr>
              <th>{{ 'BILLING.QUOTE_NUMBER' | translate }}</th>
              <th>{{ 'PATIENTS.NAME' | translate }}</th>
              <th>{{ 'COMMON.STATUS' | translate }}</th>
              <th>{{ 'BILLING.ISSUE_DATE' | translate }}</th>
              <th>{{ 'BILLING.EXPIRY_DATE' | translate }}</th>
              <th>{{ 'COMMON.AMOUNT' | translate }}</th>
              <th>{{ 'COMMON.ACTIONS' | translate }}</th>
            </tr>
          </thead>
          <tbody>
            @for (quote of invoiceService.quotes(); track quote.id) {
              <tr>
                <td><span class="quote-number">{{ quote.quoteNumber }}</span></td>
                <td>{{ quote.patientName }}</td>
                <td>
                  <span class="status-badge" [class]="quote.status.toLowerCase()">
                     {{ 'BILLING.STATUS.' + quote.status | translate }}
                  </span>
                </td>
                <td>{{ quote.issueDate | date:'mediumDate' }}</td>
                <td>{{ quote.expiryDate | date:'mediumDate' }}</td>
                <td><span class="amount">{{ quote.total | number:'1.2-2' }} {{ quote.currency }}</span></td>
                <td>
                  <div class="row-actions">
                    <button type="button" class="icon-btn" [title]="'BILLING.ACCEPT_CONVERT' | translate" [attr.aria-label]="'BILLING.ACCEPT_CONVERT' | translate">
                      <span class="material-icons" aria-hidden="true">check_circle</span>
                    </button>
                    <button type="button" class="icon-btn" [title]="'BILLING.DOWNLOAD_PDF' | translate" [attr.aria-label]="'BILLING.DOWNLOAD_PDF' | translate">
                      <span class="material-icons" aria-hidden="true">download</span>
                    </button>
                  </div>
                </td>
              </tr>
            }
          </tbody>
        </table>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .billing-container { padding: 2rem; max-width: 1200px; margin: 0 auto; }
    .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; }
    .header-content { display: flex; align-items: center; gap: 1.5rem; }
    .header-content h1 { margin: 0; font-size: 1.875rem; font-weight: 700; }
    .back-btn { background: var(--surface); border: 1px solid rgb(var(--ink-200)); border-radius: 12px; padding: 0.5rem; min-width: 44px; min-height: 44px; align-items: center; justify-content: center; cursor: pointer; display: flex; color: rgb(var(--ink-500)); }
    .back-btn:focus-visible, .icon-btn:focus-visible, .btn-primary:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }

    .quote-number { font-weight: 600; color: rgb(var(--petrol-900)); }
    
    .amount { font-weight: 700; color: rgb(var(--ink-900)); }
    .row-actions { display: flex; gap: 0.5rem; }
  `]
})
export class QuoteListComponent {
  invoiceService = inject(InvoiceService);
}
