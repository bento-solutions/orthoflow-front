import { describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import { issueAndDownloadInvoicePdf } from './invoice-pdf';
import { DownloadService } from '../services/download.service';
import { Invoice } from '../../features/billing/models/billing.model';

function setup() {
  const download = vi.fn().mockResolvedValue(undefined);
  const downloads = { download } as unknown as DownloadService;
  const issue = vi.fn((id: string) => of({ id, status: 'SENT', invoiceNumber: 'INV-1' } as Invoice));
  return { download, downloads, issue };
}

describe('printing an invoice', () => {
  it('issues a draft before printing it', async () => {
    const { download, downloads, issue } = setup();
    const result = await issueAndDownloadInvoicePdf(issue, downloads,
      { id: 'i1', status: 'DRAFT', invoiceNumber: 'INV-1' } as Invoice, 'fr');

    expect(issue).toHaveBeenCalledWith('i1');
    expect(result.status).toBe('SENT');
    expect(download).toHaveBeenCalledWith('/invoices/i1/pdf', { lang: 'fr' }, 'facture-INV-1');
  });

  it('prints an invoice already issued or paid without issuing it again', async () => {
    const { download, downloads, issue } = setup();
    for (const status of ['SENT', 'PARTIALLY_PAID', 'PAID'] as const) {
      const result = await issueAndDownloadInvoicePdf(issue, downloads,
        { id: 'i2', status, invoiceNumber: 'INV-2' } as Invoice, 'ar');
      expect(result.status).toBe(status);
    }
    expect(issue).not.toHaveBeenCalled();
    expect(download).toHaveBeenCalledTimes(3);
  });
});
