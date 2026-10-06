import { Component, inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { InvoiceService } from '../../services/invoice.service';
import { Invoice, InvoiceStatus } from '../../models/billing.model';
import { TranslateModule } from '@ngx-translate/core';
import { downloadInvoicePdf } from '../../../../core/utils/invoice-pdf';
import { IconComponent } from '../../../../shared/ui/icon.component';
import { StatusPillComponent } from '../../../../shared/ui/status-pill.component';
import { PatientService } from '../../../../core/services/patient.service';

/**
 * Invoice register.
 *
 * The money figures carry the only deliberate colour on the screen:
 * outstanding turns amber when there is anything to collect, and an
 * invoice past its due date is surfaced as OVERDUE rather than sitting
 * quietly as SENT. `status` alone cannot express that — the backend has no
 * overdue state — so it is derived from `dueDate` at render time, which is
 * also the reason the derivation lives here next to the display rather
 * than in the service.
 */
@Component({
  selector: 'app-invoice-list',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, TranslateModule, IconComponent, StatusPillComponent],
  template: `
    <div class="anim-rise">
      <header class="page-head">
        <div>
          <h1 class="page-title">{{ 'BILLING.TITLE' | translate }}</h1>
          <p class="page-sub">{{ 'BILLING.SUBTITLE' | translate }}</p>
        </div>
        <div class="page-actions">
          <!-- No link to quotes: that page is a mock-up with no backend behind it (see billing.routes.ts). -->
          <a class="btn btn-primary" routerLink="create">
            <app-icon name="plus" [size]="16" />
            {{ 'BILLING.NEW_INVOICE' | translate }}
          </a>
        </div>
      </header>

      <!-- Money summary -->
      @if (invoiceService.summary(); as summary) {
        <section class="stagger mb-4 grid gap-4 sm:grid-cols-3">
          <article class="card flex items-center gap-3 p-4">
            <span class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-petrol-50 text-petrol-600">
              <app-icon name="receipt" [size]="17" />
            </span>
            <span class="flex min-w-0 flex-col leading-tight">
              <span class="text-xs font-bold uppercase tracking-wider text-ink-500">{{ 'BILLING.TOTAL_INVOICED' | translate }}</span>
              <span class="truncate text-xl font-extrabold tabular-nums text-ink-900">{{ money(summary.totalInvoiced) }}</span>
            </span>
          </article>

          <article class="card flex items-center gap-3 p-4">
            <span class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-positive-50 text-positive-600">
              <app-icon name="check-circle" [size]="17" />
            </span>
            <span class="flex min-w-0 flex-col leading-tight">
              <span class="text-xs font-bold uppercase tracking-wider text-ink-500">{{ 'BILLING.TOTAL_COLLECTED' | translate }}</span>
              <span class="truncate text-xl font-extrabold tabular-nums text-ink-900">{{ money(summary.totalCollected) }}</span>
            </span>
          </article>

          <article class="card flex items-center gap-3 p-4">
            <span
              class="grid h-9 w-9 shrink-0 place-items-center rounded-md"
              [class]="summary.outstandingAmount > 0 ? 'bg-caution-50 text-caution-700' : 'bg-ink-100 text-ink-500'"
            >
              <app-icon name="clock" [size]="17" />
            </span>
            <span class="flex min-w-0 flex-col leading-tight">
              <span class="text-xs font-bold uppercase tracking-wider text-ink-500">{{ 'BILLING.OUTSTANDING' | translate }}</span>
              <span
                class="truncate text-xl font-extrabold tabular-nums"
                [class]="summary.outstandingAmount > 0 ? 'text-caution-700' : 'text-ink-900'"
              >{{ money(summary.outstandingAmount) }}</span>
            </span>
          </article>
        </section>
      }

      <!-- Filters -->
      <div class="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <label class="search">
          <span class="sr-only">{{ 'COMMON.SEARCH' | translate }}</span>
          <app-icon name="search" [size]="16" />
          <input
            class="input"
            type="search"
            [placeholder]="'BILLING.SEARCH_PLACEHOLDER' | translate"
            [ngModel]="query()"
            (ngModelChange)="query.set($event)"
          />
        </label>

        <label class="sm:w-56">
          <span class="sr-only">{{ 'BILLING.ALL_STATUSES' | translate }}</span>
          <select class="select" [ngModel]="statusFilter()" (ngModelChange)="statusFilter.set($event)">
            <option value="">{{ 'BILLING.ALL_STATUSES' | translate }}</option>
            @for (s of statuses; track s) {
              <option [value]="s">{{ 'STATUS.' + s | translate }}</option>
            }
          </select>
        </label>
      </div>

      <!-- Table -->
      <div class="table-wrap">
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">{{ 'BILLING.INVOICE_NUMBER' | translate }}</th>
                <th scope="col">{{ 'PATIENTS.NAME' | translate }}</th>
                <th scope="col">{{ 'COMMON.STATUS' | translate }}</th>
                <th scope="col">{{ 'COMMON.DATE' | translate }}</th>
                <th scope="col" class="cell-num">{{ 'COMMON.AMOUNT' | translate }}</th>
                <th scope="col" class="cell-actions"><span class="sr-only">{{ 'COMMON.ACTIONS' | translate }}</span></th>
              </tr>
            </thead>
            <tbody>
              @for (row of visible(); track row.invoice.id) {
                <!-- Row click is a mouse convenience; the invoice number is
                     the keyboard-reachable link (a routerLink on <tr> is
                     not focusable, so it was mouse-only). -->
                <tr class="row-clickable" (click)="open(row.invoice.id)">
                  <td>
                    <a
                      class="mono font-semibold text-ink-900 no-underline hover:text-petrol-700"
                      [routerLink]="[row.invoice.id]"
                      (click)="$event.stopPropagation()"
                    >{{ row.invoice.invoiceNumber }}</a>
                  </td>
                  <td>
                    <span class="flex min-w-0 flex-col leading-tight">
                      <span class="truncate font-semibold text-ink-900">{{ row.patientName || '—' }}</span>
                      @if (row.invoice.regionCode) {
                        <span class="text-2xs text-ink-500">{{ row.invoice.regionCode }}</span>
                      }
                    </span>
                  </td>
                  <td><app-status-pill [status]="row.displayStatus" /></td>
                  <td>
                    <span class="flex flex-col leading-tight">
                      <span class="text-ink-900">{{ row.invoice.issueDate | date: 'mediumDate' }}</span>
                      <span
                        class="text-2xs"
                        [class]="row.isOverdue ? 'font-bold text-critical-700' : 'text-ink-500'"
                      >
                        {{ 'BILLING.DUE' | translate }}: {{ row.invoice.dueDate | date: 'mediumDate' }}
                      </span>
                    </span>
                  </td>
                  <td class="cell-num">
                    <span class="flex flex-col leading-tight">
                      <span class="font-bold text-ink-900">{{ money(row.invoice.total, row.invoice.currency) }}</span>
                      @if (row.balance > 0) {
                        <span class="text-2xs font-semibold text-caution-700">
                          {{ 'BILLING.BALANCE' | translate }} {{ money(row.balance, row.invoice.currency) }}
                        </span>
                      }
                    </span>
                  </td>
                  <td class="cell-actions">
                    <div class="flex justify-end gap-1">
                      <button
                        type="button"
                        class="btn btn-ghost btn-icon"
                        [title]="'BILLING.DOWNLOAD_PDF' | translate"
                        [attr.aria-label]="('BILLING.DOWNLOAD_PDF' | translate) + ' — ' + row.invoice.invoiceNumber"
                        (click)="$event.stopPropagation(); downloadPdf(row.invoice)"
                      >
                        <app-icon name="download" [size]="16" />
                      </button>
                    </div>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="6" class="!p-0">
                    <div class="empty">
                      <span class="empty-icon"><app-icon name="receipt" [size]="20" /></span>
                      @if (invoiceService.invoices().length) {
                        <p class="empty-title">{{ 'BILLING.NO_MATCHES' | translate }}</p>
                        <p class="empty-text">{{ 'BILLING.NO_MATCHES_HINT' | translate }}</p>
                        <button type="button" class="btn btn-secondary btn-sm" (click)="clearFilters()">
                          {{ 'COMMON.CLEAR_FILTERS' | translate }}
                        </button>
                      } @else {
                        <p class="empty-title">{{ 'BILLING.EMPTY_TITLE' | translate }}</p>
                        <p class="empty-text">{{ 'BILLING.EMPTY_TEXT' | translate }}</p>
                        <a class="btn btn-primary btn-sm" routerLink="create">
                          <app-icon name="plus" [size]="15" />
                          {{ 'BILLING.NEW_INVOICE' | translate }}
                        </a>
                      }
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
})
export class InvoiceListComponent {
  readonly invoiceService = inject(InvoiceService);
  private readonly router = inject(Router);
  private readonly patients = inject(PatientService);

  readonly query = signal('');
  readonly statusFilter = signal<'' | InvoiceStatus>('');

  readonly statuses: InvoiceStatus[] = ['DRAFT', 'SENT', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'];

  readonly visible = computed(() => {
    const q = this.query().trim().toLowerCase();
    const status = this.statusFilter();
    const todayStart = new Date().setHours(0, 0, 0, 0);

    return this.invoiceService
      .invoices()
      .filter((inv) => {
        if (status && inv.status !== status) return false;
        if (!q) return true;
        return [inv.invoiceNumber, this.patients.nameFor(inv.patientId), inv.regionCode]
          .some((v) => (v ?? '').toString().toLowerCase().includes(q));
      })
      .map((invoice) => {
        /* InvoiceResponse carries only patientId, so the display name is a
           join against the loaded patient list rather than a field. */
        const patientName = this.patients.nameFor(invoice.patientId);
        /* A cancelled or draft invoice is not collectable, so it has no
           balance to chase — showing one made a cancelled invoice look
           like unpaid debt in the amber "still owed" treatment. */
        const collectable = invoice.status !== 'CANCELLED' && invoice.status !== 'DRAFT';
        const balance = collectable
          ? Math.max(0, (invoice.total ?? 0) - (invoice.amountPaid ?? 0))
          : 0;

        /* Overdue is a display concern: money is still owed and the due
           date has passed. The backend has no OVERDUE state. */
        const isOverdue =
          balance > 0 && !!invoice.dueDate && new Date(invoice.dueDate).getTime() < todayStart;

        return { invoice, patientName, balance, isOverdue, displayStatus: isOverdue ? 'OVERDUE' : invoice.status };
      });
  });

  /** Formatted in the invoice's own currency, falling back to MAD. */
  money(value: number | undefined, currency = 'MAD'): string {
    const amount = value ?? 0;
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: currency || 'MAD',
        maximumFractionDigits: 2,
      }).format(amount);
    } catch {
      return `${amount.toFixed(2)} ${currency}`;
    }
  }

  open(id: string): void {
    this.router.navigate(['/billing/invoices', id]);
  }

  clearFilters(): void {
    this.query.set('');
    this.statusFilter.set('');
  }

  downloadPdf(invoice: Invoice): void {
    downloadInvoicePdf(invoice, this.patients.nameFor(invoice.patientId));
  }
}
