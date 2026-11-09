import { DownloadService } from '../services/download.service';
import { Invoice } from '../../features/billing/models/billing.model';

/**
 * Downloads the invoice as the server prints it (GET /invoices/{id}/pdf): the clinic's letterhead,
 * the patient's name whoever they are, tagged for screen readers.
 *
 * It was drawn here with jsPDF from what the browser had loaded, so it named the patient only when
 * they were among the first 200 patients ("Patient: —" otherwise), and it cost the app jsPDF,
 * html2canvas and canvg (about 750 kB) and the DOMPurify advisories that came with them (audit P1, P4).
 */
export function downloadInvoicePdf(downloads: DownloadService, invoice: Invoice, lang: string): Promise<void> {
  return downloads.download(`/invoices/${invoice.id}/pdf`, { lang }, `facture-${invoice.invoiceNumber || invoice.id}`);
}
