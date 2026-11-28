import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from '../api/url';
import type { Req, Wire } from '../api/wire';
import type { Invoice } from '../../features/billing/models/billing.model';
import { DownloadService } from './download.service';

export type Quote = Wire<'QuoteView'>;
export type QuoteLine = Wire<'QuoteLineView'>;
export type QuoteStatus = Quote['status'];
export type QuoteSaveInput = Req<'QuoteSaveRequest'>;
export type QuoteLineInput = Req<'QuoteLineRequest'>;
export type QuoteInvoiceInput = Req<'QuoteInvoiceRequest'>;

/**
 * What a devis reads as on screen: its stored status, except that one handed over and past its
 * validity date with no answer reads as expired.
 */
export type QuoteState = QuoteStatus | 'EXPIRED';

export function quoteState(q: Pick<Quote, 'status' | 'expired'>): QuoteState {
  return q.expired ? 'EXPIRED' : q.status;
}

/** Still waiting for the patient's answer (the banner's "Devis en attente"). */
export function isPending(q: Pick<Quote, 'status' | 'expired'>): boolean {
  return q.status === 'SENT' && !q.expired;
}

/** Accepted lines that have not been invoiced yet. */
export function linesToInvoice(q: Quote): QuoteLine[] {
  return q.status === 'ACCEPTED' ? q.lines.filter(l => l.accepted && !l.invoiceId) : [];
}

/** Devis: written, handed over, accepted line by line, invoiced (GET/POST /quotes). */
@Injectable({ providedIn: 'root' })
export class QuoteApi {
  private readonly http = inject(HttpClient);
  private readonly downloads = inject(DownloadService);

  list(patientId?: string): Promise<Quote[]> {
    return firstValueFrom(this.http.get<Quote[]>(api('/quotes'), { params: patientId ? { patientId } : {} }));
  }
  get(id: string): Promise<Quote> {
    return firstValueFrom(this.http.get<Quote>(api(`/quotes/${id}`)));
  }
  create(body: QuoteSaveInput): Promise<Quote> {
    return firstValueFrom(this.http.post<Quote>(api('/quotes'), body));
  }
  update(id: string, body: QuoteSaveInput): Promise<Quote> {
    return firstValueFrom(this.http.put<Quote>(api(`/quotes/${id}`), body));
  }
  remove(id: string): Promise<unknown> {
    return firstValueFrom(this.http.delete(api(`/quotes/${id}`)));
  }
  issue(id: string): Promise<Quote> {
    return firstValueFrom(this.http.post<Quote>(api(`/quotes/${id}/issue`), {}));
  }
  accept(id: string, lineIds: string[], createTreatments = true): Promise<Quote> {
    return firstValueFrom(this.http.post<Quote>(api(`/quotes/${id}/accept`), { lineIds, createTreatments }));
  }
  refuse(id: string): Promise<Quote> {
    return firstValueFrom(this.http.post<Quote>(api(`/quotes/${id}/refuse`), {}));
  }
  cancel(id: string): Promise<Quote> {
    return firstValueFrom(this.http.post<Quote>(api(`/quotes/${id}/cancel`), {}));
  }
  invoice(id: string, body: QuoteInvoiceInput): Promise<Invoice> {
    return firstValueFrom(this.http.post<Invoice>(api(`/quotes/${id}/invoice`), body));
  }

  /** Prints the devis; a draft is marked handed over first, as a printed invoice is issued. */
  async print(quote: Quote, lang: string): Promise<Quote> {
    const current = quote.status === 'DRAFT' ? await this.issue(quote.id) : quote;
    await this.downloads.download(`/quotes/${quote.id}/pdf`, { lang }, `devis-${quote.quoteNumber || quote.id}`);
    return current;
  }
}
