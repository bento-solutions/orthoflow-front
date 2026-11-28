/**
 * Billing types.
 *
 * The wire types are re-exported from `core/api/contract` rather than declared
 * here. The hand-written versions they replace had drifted from the server in a
 * way that showed up as a bug rather than a compile error: `Invoice` declared
 * `patientName`, `treatmentPlanId`, `insuranceScheme`, `notes` and `updatedAt`,
 * none of which `InvoiceResponse` has ever contained. The invoice list rendered
 * `patientName` in its patient column (always blank) and searched on it
 * (never matching). See `core/api/contract.ts` for why the duplication existed.
 *
 * `Quote` and `InsuranceClaim` stay hand-written below because they are not
 * wire types at all — there is no quote or claim endpoint. They are kept, and
 * labelled, so that the distinction between "contract" and "not built yet"
 * is visible in the type system rather than discovered at runtime.
 */

export type {
  Invoice,
  InvoiceLine,
  InvoiceStatus,
  Payment,
  PaymentMethod,
  BillingSummary,
  CreateInvoiceRequest,
  PaymentTermsRequest,
  PaymentFrequency,
  InvoicePaymentPlan,
  InvoicePaymentPart,
  InvoiceLineRequest,
  RecordPaymentRequest,
} from '../../../core/api/contract';

import type { InvoiceLine, InvoiceLineRequest } from '../../../core/api/contract';

// ── Client-side view models ────────────────────────────────────────────

/**
 * A line being edited in the invoice composer.
 *
 * This is deliberately built on `InvoiceLineRequest`, not on the response
 * type. The two differ: the request carries `discountPct` and `sortOrder`,
 * the response carries `id` and `lineTotal`. The composer previously typed
 * its draft lines as the response type, which is how it came to omit
 * `actCode` — a `@NotBlank` field on the server — and how the omission went
 * unnoticed. `lineTotal` is added back because the composer shows a running
 * per-line total; the server recomputes it and ignores whatever is sent.
 */
export interface InvoiceDraftLine extends InvoiceLineRequest {
  lineTotal: number;
}

// ── Not yet implemented server-side ────────────────────────────────────
//
// No endpoint serves either of these. `InvoiceService.quotes` is a signal that
// is declared, exposed and never populated; `quote-list.component` renders it
// and therefore always shows an empty list. These declarations describe the
// intended shape for when the endpoints exist — they are not a contract, and
// nothing validates them against the backend because there is nothing to
// validate against. Move them into `core/api/contract.ts` on the day the
// backend grows `/quotes`, and delete them from here.

export type QuoteStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED';
export type ClaimStatus = 'PENDING' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'PAID';

export interface Quote {
  id: string;
  practiceId: string;
  patientId: string;
  patientName?: string;
  treatmentPlanId?: string;
  quoteNumber: string;
  status: QuoteStatus;
  issueDate: string;
  expiryDate: string;
  currency: string;
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  total: number;
  regionCode: string;
  notes?: string;
  convertedToInvoiceId?: string;
  rejectionReason?: string;
  lines: InvoiceLine[];
}

export interface InsuranceClaim {
  id: string;
  invoiceId: string;
  insuranceScheme: string;
  status: ClaimStatus;
  coveragePct: number;
  claimAmount: number;
  paidAmount: number;
  reference?: string;
  notes?: string;
}
