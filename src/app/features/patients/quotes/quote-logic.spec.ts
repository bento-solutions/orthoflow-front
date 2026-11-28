import { describe, expect, it } from 'vitest';
import type { PatientTreatment } from '../../../core/models/patient-treatment.model';
import type { Quote } from '../../../core/services/quote-api.service';
import { isPending, linesToInvoice, quoteState } from '../../../core/services/quote-api.service';
import { blankLine, lineFromTreatment, lineProblem, plannedNotQuoted, totals } from './quote-logic';

const treatment = (id: string, status: string, name = 'Couronne', price = 4000) =>
  ({ id, status, teeth: '16', treatment: { id: 't-' + id, name, code: 'CC', actCode: 'D629', basePrice: price } }) as unknown as PatientTreatment;

const quote = (over: Partial<Quote>): Quote => ({
  id: 'q1', quoteNumber: 'DEV-2026-00001', status: 'SENT', expired: false, total: 0, acceptedTotal: 0, invoicedTotal: 0, lines: [],
  ...over,
}) as Quote;

describe('devis logic', () => {
  it('adds lines up with their discounts the way the server does', () => {
    const t = totals([
      { ...blankLine(), label: 'Couronne', unitPrice: 4000, quantity: 1 },
      { ...blankLine(), label: 'Implant', unitPrice: 9000, quantity: 1, discountPct: 10 },
      { ...blankLine(), label: 'Détartrage', unitPrice: 300, quantity: 1 },
    ]);
    expect(t).toEqual({ subtotal: 13300, discount: 900, total: 12400 });
  });

  it('proposes the planned treatments that no devis holds yet, priced from the catalogue', () => {
    const planned = [treatment('a', 'PLANNED'), treatment('b', 'ACTIVE'), treatment('c', 'COMPLETED'), treatment('d', 'PLANNED')];
    const onQuote = quote({ status: 'ACCEPTED', lines: [{ id: 'l1', patientTreatmentId: 'd' } as Quote['lines'][number]] });
    expect(plannedNotQuoted(planned, [onQuote]).map(t => t.id)).toEqual(['a', 'b']);
    // A cancelled devis no longer holds its treatments.
    expect(plannedNotQuoted(planned, [{ ...onQuote, status: 'CANCELLED' }]).map(t => t.id)).toEqual(['a', 'b', 'd']);
    expect(lineFromTreatment(planned[0])).toMatchObject({ treatmentId: 't-a', patientTreatmentId: 'a', actCode: 'D629', label: 'Couronne', teeth: '16', unitPrice: 4000 });
  });

  it('refuses a line without a description or with a bad quantity', () => {
    expect(lineProblem(blankLine())).toBe('QUOTE.ERR_LABEL');
    expect(lineProblem({ ...blankLine(), label: 'x', quantity: 0 })).toBe('QUOTE.ERR_QTY');
    expect(lineProblem({ ...blankLine(), label: 'x', discountPct: 120 })).toBe('QUOTE.ERR_DISCOUNT');
    expect(lineProblem({ ...blankLine(), label: 'x' })).toBeNull();
  });

  it('reads a handed-over devis past its date as expired, and only an answered one as invoiceable', () => {
    expect(quoteState(quote({ expired: true }))).toBe('EXPIRED');
    expect(isPending(quote({}))).toBe(true);
    expect(isPending(quote({ expired: true }))).toBe(false);
    const accepted = quote({ status: 'ACCEPTED', lines: [
      { id: 'a', accepted: true, invoiceId: '' }, { id: 'b', accepted: false }, { id: 'c', accepted: true, invoiceId: 'inv' },
    ] as Quote['lines'] });
    expect(linesToInvoice(accepted).map(l => l.id)).toEqual(['a']);
    expect(linesToInvoice({ ...accepted, status: 'SENT' })).toEqual([]);
  });
});
