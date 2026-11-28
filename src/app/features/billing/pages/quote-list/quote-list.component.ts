import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { Quote, QuoteApi, QuoteState, quoteState } from '../../../../core/services/quote-api.service';
import { loadable } from '../../../../core/utils/loadable';
import { AppDatePipe } from '../../../../shared/pipes/app-date.pipe';
import { MoneyPipe } from '../../../../shared/pipes/money.pipe';
import { PageHeaderComponent } from '../../../../shared/ui/page-header.component';

const PILL: Record<QuoteState, string> = {
  DRAFT: 'pill-idle', SENT: 'pill-active', ACCEPTED: 'pill-done', REFUSED: 'pill-critical', CANCELLED: 'pill-idle', EXPIRED: 'pill-attention',
};

/**
 * Every devis of the clinic, newest first: what is waiting for an answer, what was accepted and is
 * still to invoice. A devis is written and handled in the patient's file; a row opens it there.
 */
@Component({
  selector: 'app-quote-list',
  standalone: true,
  imports: [AppDatePipe, MoneyPipe, FormsModule, RouterModule, TranslateModule, PageHeaderComponent],
  template: `
    <div class="anim-rise">
      <app-page-header>
        <div page-actions class="contents">
          <a class="btn btn-secondary" routerLink="/billing/invoices">{{ 'BILLING.INVOICES' | translate }}</a>
        </div>
      </app-page-header>

      <div class="mb-4 flex flex-wrap gap-2" role="group" [attr.aria-label]="'COMMON.STATUS' | translate">
        @for (f of filters; track f) {
          <button type="button" class="btn btn-sm" [class.btn-primary]="filter() === f" [class.btn-secondary]="filter() === f ? false : true"
                  [attr.aria-pressed]="filter() === f" (click)="filter.set(f)">
            {{ 'QUOTE.FILTER.' + f | translate }} <span class="tnum">({{ count(f) }})</span>
          </button>
        }
      </div>

      <div class="table-wrap"><div class="table-scroll">
        <table class="data-table">
          <thead><tr>
            <th scope="col">{{ 'QUOTE.COL.NUMBER' | translate }}</th>
            <th scope="col">{{ 'QUOTE.COL.PATIENT' | translate }}</th>
            <th scope="col">{{ 'QUOTE.COL.DATE' | translate }}</th>
            <th scope="col">{{ 'QUOTE.COL.VALID' | translate }}</th>
            <th scope="col">{{ 'COMMON.STATUS' | translate }}</th>
            <th scope="col" class="cell-num">{{ 'QUOTE.COL.TOTAL' | translate }}</th>
            <th scope="col" class="cell-num">{{ 'QUOTE.COL.TO_INVOICE' | translate }}</th>
          </tr></thead>
          <tbody>
            @for (q of shown(); track q.id) {
              <tr>
                <td><a class="font-bold text-ink-900 no-underline hover:text-petrol-700" [routerLink]="['/patients', q.patientId]" [queryParams]="{ tab: 'billing' }">
                  <span class="ltr-data">{{ q.quoteNumber }}</span></a>
                  @if (q.title) { <span class="block text-xs text-ink-500">{{ q.title }}</span> }</td>
                <td>{{ q.patientName || '—' }}</td>
                <td>{{ q.issueDate | appDate }}</td>
                <td>{{ q.validUntil | appDate }}</td>
                <td><span [class]="'pill ' + pill(q)">{{ 'QUOTE.STATUS.' + state(q) | translate }}</span></td>
                <td class="cell-num">{{ q.total | money }}</td>
                <td class="cell-num">{{ q.status === 'ACCEPTED' ? (q.acceptedTotal - q.invoicedTotal | money) : '—' }}</td>
              </tr>
            } @empty {
              <tr><td colspan="7" class="py-6 text-center text-ink-500">{{ (all.loading() ? 'COMMON.LOADING' : 'QUOTE.EMPTY_ALL') | translate }}</td></tr>
            }
          </tbody>
        </table>
      </div></div>
    </div>
  `,
})
export class QuoteListComponent {
  private readonly api = inject(QuoteApi);
  protected readonly all = loadable<Quote[]>([]);
  protected readonly filters = ['ALL', 'PENDING', 'TO_INVOICE', 'DRAFT'] as const;
  protected readonly filter = signal<(typeof this.filters)[number]>('ALL');
  protected readonly shown = computed(() => this.all.data().filter(q => this.matches(q, this.filter())));
  protected readonly state = quoteState;

  constructor() {
    void this.all.load(() => this.api.list());
  }

  protected pill(q: Quote): string {
    return PILL[quoteState(q)];
  }

  protected count(f: (typeof this.filters)[number]): number {
    return this.all.data().filter(q => this.matches(q, f)).length;
  }

  private matches(q: Quote, f: (typeof this.filters)[number]): boolean {
    switch (f) {
      case 'PENDING': return q.status === 'SENT' && !q.expired;
      case 'TO_INVOICE': return q.status === 'ACCEPTED' && q.acceptedTotal > q.invoicedTotal;
      case 'DRAFT': return q.status === 'DRAFT';
      default: return true;
    }
  }
}
