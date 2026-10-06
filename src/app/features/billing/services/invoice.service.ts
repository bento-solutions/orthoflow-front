import { Injectable, signal, computed, effect, inject, untracked } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Invoice, InvoiceStatus, Payment, Quote, BillingSummary,
         CreateInvoiceRequest, RecordPaymentRequest } from '../models/billing.model';
import type { SpringPage } from '../../../core/api/contract';
import { Observable, BehaviorSubject, map, tap, finalize, switchMap, shareReplay } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { ToastService } from '../../../core/services/toast.service';
import { AuthService } from '../../../core/services/auth.service';

@Injectable({
  providedIn: 'root'
})
export class InvoiceService {
  private http = inject(HttpClient);
  private toast = inject(ToastService);
  private auth = inject(AuthService);
  private readonly apiUrl = `${environment.apiUrl}/api/v1/invoices`;

  // Signals for UI state
  private invoicesSignal = signal<Invoice[]>([]);
  private summarySignal = signal<BillingSummary | null>(null);
  private loadingSignal = signal<boolean>(false);
  private quotesSignal = signal<Quote[]>([]);
  private errorSignal = signal<string | null>(null);

  // Computed selectors for components
  invoices = computed(() => this.invoicesSignal());
  summary = computed(() => this.summarySignal());
  loading = computed(() => this.loadingSignal());
  quotes = computed(() => this.quotesSignal());
  error = computed(() => this.errorSignal());

  constructor() {
    // The first load waits for a signed-in session: this service is created at start-up (the voice
    // commands inject it), and asking for invoices before login only produced an error toast on
    // the sign-in page. A session that ends clears what was loaded.
    effect(() => {
      const token = this.auth.token();
      untracked(() => {
        if (token) {
          this.refreshInvoices();
        } else {
          this.invoicesSignal.set([]);
          this.summarySignal.set(null);
          this.quotesSignal.set([]);
        }
      });
    });
  }

  /**
   * Refreshes the list of invoices and the global billing summary.
   */
  refreshInvoices(): void {
    this.loadingSignal.set(true);
    this.errorSignal.set(null);
    this.http.get<SpringPage<Invoice>>(this.apiUrl)
      .pipe(
        map(page => page.content),
        tap(invoices => this.invoicesSignal.set(invoices)),
        switchMap(() => this.getBillingSummary()),
        tap(summary => this.summarySignal.set(summary)),
        finalize(() => this.loadingSignal.set(false))
      )
      .subscribe({
        error: (err) => {
          console.error('Failed to refresh billing data', err);
          this.errorSignal.set('Failed to load billing data.');
          this.toast.error('Could not load billing data. Please try again.');
        }
      });
  }

  /**
   * Fetches invoices for a specific patient.
   */
  getPatientInvoices(patientId: string): Observable<Invoice[]> {
    const params = new HttpParams().set('patientId', patientId).set('size', '200');
    return this.http.get<SpringPage<Invoice>>(this.apiUrl, { params }).pipe(
      map(page => page.content),
      shareReplay(1)
    );
  }

  /**
   * Fetches a single invoice by ID.
   */
  getInvoice(id: string): Observable<Invoice> {
    return this.http.get<Invoice>(`${this.apiUrl}/${id}`);
  }

  /**
   * Creates a new invoice and updates the internal state.
   */
  createInvoice(invoice: CreateInvoiceRequest): Observable<Invoice> {
    this.loadingSignal.set(true);
    return this.http.post<Invoice>(this.apiUrl, invoice).pipe(
      tap(newInvoice => {
        this.invoicesSignal.update(invoices => [newInvoice, ...invoices]);
        this.refreshSummary();
      }),
      finalize(() => this.loadingSignal.set(false))
    );
  }

  /**
   * Records a payment for an invoice.
   */
  recordPayment(invoiceId: string, payment: RecordPaymentRequest): Observable<Payment> {
    this.loadingSignal.set(true);
    return this.http.post<Payment>(`${this.apiUrl}/${invoiceId}/payments`, payment).pipe(
      tap(() => {
        // Refresh both the specific invoice and the summary
        this.refreshInvoices();
      }),
      finalize(() => this.loadingSignal.set(false))
    );
  }

  /**
   * Fetches the billing summary (total invoiced, collected, etc.).
   */
  getBillingSummary(): Observable<BillingSummary> {
    return this.http.get<BillingSummary>(`${this.apiUrl}/summary`);
  }

  private refreshSummary(): void {
    this.getBillingSummary().subscribe(summary => this.summarySignal.set(summary));
  }
}
