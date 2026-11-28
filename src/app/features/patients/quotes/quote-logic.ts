import type { PatientTreatment } from '../../../core/models/patient-treatment.model';
import type { Treatment } from '../../../core/models/stock.model';
import type { Quote, QuoteLineInput } from '../../../core/services/quote-api.service';

/** A line as the devis form edits it: every field present, numbers as numbers. */
export interface QuoteDraftLine {
  treatmentId: string | null;
  /** The planned treatment this line prices (a devis made from the plan); accepting it plans nothing new. */
  patientTreatmentId: string | null;
  actCode: string;
  label: string;
  teeth: string;
  quantity: number;
  unitPrice: number;
  discountPct: number;
}

/** What a new devis opens with: from the treatment plan, a proposed plan, or nothing. */
export interface QuotePrefill {
  lines: QuoteDraftLine[];
  title?: string;
  notes?: string;
}

export const blankLine = (): QuoteDraftLine =>
  ({ treatmentId: null, patientTreatmentId: null, actCode: '', label: '', teeth: '', quantity: 1, unitPrice: 0, discountPct: 0 });

export function lineFromCatalogue(t: Treatment, teeth = ''): QuoteDraftLine {
  return {
    treatmentId: t.id, patientTreatmentId: null, actCode: t.actCode || t.code || '', label: t.name, teeth,
    quantity: 1, unitPrice: t.basePrice ?? 0, discountPct: 0,
  };
}

/** A planned or started treatment, as a devis line priced from the catalogue. */
export function lineFromTreatment(pt: PatientTreatment): QuoteDraftLine | null {
  const t = pt.treatment;
  if (!t?.id) return null;
  return { ...lineFromCatalogue(t as Treatment, pt.teeth ?? ''), patientTreatmentId: pt.id ?? null };
}

/**
 * The treatments the plan holds (planned or in progress) that no devis line has already become:
 * those are what "Créer un devis" proposes.
 */
export function plannedNotQuoted(treatments: readonly PatientTreatment[], quotes: readonly Quote[]): PatientTreatment[] {
  const onQuote = new Set(quotes.flatMap(q => q.status === 'CANCELLED' ? [] : q.lines.map(l => l.patientTreatmentId).filter(Boolean)));
  return treatments.filter(t => (t.status === 'PLANNED' || t.status === 'ACTIVE') && t.id && !onQuote.has(t.id));
}

export function lineTotal(l: QuoteDraftLine): number {
  const gross = (l.unitPrice || 0) * (l.quantity || 0);
  return round(gross - gross * (l.discountPct || 0) / 100);
}

export function totals(lines: readonly QuoteDraftLine[]): { subtotal: number; discount: number; total: number } {
  let subtotal = 0;
  let discount = 0;
  for (const l of lines) {
    const gross = (l.unitPrice || 0) * (l.quantity || 0);
    subtotal += gross;
    discount += gross * (l.discountPct || 0) / 100;
  }
  return { subtotal: round(subtotal), discount: round(discount), total: round(subtotal) - round(discount) };
}

/** The reason a line cannot be saved, as a translation key, or null. */
export function lineProblem(l: QuoteDraftLine): string | null {
  if (!l.label.trim()) return 'QUOTE.ERR_LABEL';
  if (!(l.quantity > 0)) return 'QUOTE.ERR_QTY';
  if (l.unitPrice < 0) return 'QUOTE.ERR_PRICE';
  if (l.discountPct < 0 || l.discountPct > 100) return 'QUOTE.ERR_DISCOUNT';
  return null;
}

export function toInput(l: QuoteDraftLine): QuoteLineInput {
  return {
    treatmentId: l.treatmentId || undefined,
    patientTreatmentId: l.patientTreatmentId || undefined,
    actCode: l.actCode.trim() || undefined,
    label: l.label.trim(),
    teeth: l.teeth.trim() || undefined,
    quantity: l.quantity,
    unitPrice: l.unitPrice,
    discountPct: l.discountPct,
  };
}

export function fromQuote(q: Quote): QuoteDraftLine[] {
  return q.lines.map(l => ({
    treatmentId: l.treatmentId || null, patientTreatmentId: l.patientTreatmentId || null, actCode: l.actCode || '', label: l.label, teeth: l.teeth || '',
    quantity: l.quantity, unitPrice: l.unitPrice, discountPct: l.discountPct,
  }));
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
