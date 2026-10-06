import { describe, expect, it } from 'vitest';
import type { Account, InvoiceBalance } from '../../../core/services/finance-api.service';
import { ReceiptForm, openInvoices, planSchedule, receiptRequest, settle } from './account-logic';

const invoice = (id: string, number: string, issueDate: string, balance: number, status: InvoiceBalance['status'] = 'SENT'): InvoiceBalance => ({
  id, invoiceNumber: number, issueDate, status, total: balance, paid: 0, balance,
});

const account = (invoices: InvoiceBalance[]): Account => ({
  patientId: 'p', invoices, receipts: [], totalInvoiced: 0, totalPaid: 0, balanceDue: 0, creditAvailable: 0, net: 0,
});

describe('openInvoices', () => {
  it('lists what is still owed, oldest first, without cancelled or settled invoices', () => {
    const open = openInvoices(account([
      invoice('c', 'FA-3', '2026-03-01', 50),
      invoice('a', 'FA-1', '2026-01-01', 100),
      invoice('x', 'FA-2', '2026-02-01', 0, 'PAID'),
      invoice('z', 'FA-4', '2026-02-15', 80, 'CANCELLED'),
    ]));
    expect(open.map(i => i.id)).toEqual(['a', 'c']);
  });

  it('is empty with no account', () => {
    expect(openInvoices(null)).toEqual([]);
  });
});

describe('settle', () => {
  const open = [invoice('a', 'FA-1', '2026-01-01', 100), invoice('b', 'FA-2', '2026-02-01', 60)];

  it('spreads a payment over the oldest invoices and keeps the rest as credit', () => {
    expect(settle(200, 'AUTO', open, {})).toMatchObject({ allocated: 160, leftover: 40, over: false });
    expect(settle(130, 'AUTO', open, {})).toMatchObject({ allocated: 130, leftover: 0 });
  });

  it('keeps everything as credit when asked to', () => {
    expect(settle(80, 'ADVANCE', open, {})).toEqual({ allocated: 0, leftover: 80, over: false, allocations: [] });
  });

  it('applies only what was typed per invoice, never above an invoice\'s balance', () => {
    const result = settle(150, 'CHOOSE', open, { a: 100, b: 500 });
    expect(result.allocations).toEqual([{ invoiceId: 'a', amount: 100 }, { invoiceId: 'b', amount: 60 }]);
    expect(result).toMatchObject({ allocated: 150, leftover: 0, over: true });
  });

  it('flags amounts that add up to more than was received', () => {
    expect(settle(100, 'CHOOSE', open, { a: 70, b: 60 })).toMatchObject({ over: true, allocated: 100, leftover: 0 });
    expect(settle(130, 'CHOOSE', open, { a: 70, b: 60 })).toMatchObject({ over: false, allocated: 130, leftover: 0 });
  });

  it('counts in whole cents so decimals do not drift', () => {
    const pennies = [invoice('a', 'FA-1', '2026-01-01', 0.1), invoice('b', 'FA-2', '2026-02-01', 0.2)];
    expect(settle(0.3, 'AUTO', pennies, {})).toMatchObject({ allocated: 0.3, leftover: 0 });
  });

  it('ignores a zero or negative amount', () => {
    expect(settle(0, 'AUTO', open, {})).toMatchObject({ allocated: 0, leftover: 0 });
    expect(settle(-5, 'AUTO', open, {})).toMatchObject({ allocated: 0, leftover: 0 });
  });
});

describe('receiptRequest', () => {
  const form: ReceiptForm = {
    amount: 100, method: 'CHEQUE', date: '2026-10-06', practitionerId: '', reference: '  ', notes: '', mode: 'AUTO',
    chequeNumber: '0012345', chequeBank: 'BMCE', chequeDrawer: '', chequeDue: '2026-12-01',
  };

  it('asks for automatic allocation and carries the cheque, leaving blanks out', () => {
    const request = receiptRequest(form, settle(100, 'AUTO', [], {}));
    expect(request).toMatchObject({
      amount: 100, method: 'CHEQUE', receiptDate: '2026-10-06', autoAllocate: true, allocations: [],
      cheque: { number: '0012345', bank: 'BMCE', drawerName: undefined, dueDate: '2026-12-01' },
    });
    expect(request.reference).toBeUndefined();
    expect(request.practitionerId).toBeUndefined();
  });

  it('sends chosen allocations and no cheque for cash', () => {
    const open = [invoice('a', 'FA-1', '2026-01-01', 100)];
    const chosen = { ...form, method: 'CASH' as const, mode: 'CHOOSE' as const };
    const request = receiptRequest(chosen, settle(100, 'CHOOSE', open, { a: 60 }));
    expect(request.autoAllocate).toBe(false);
    expect(request.allocations).toEqual([{ invoiceId: 'a', amount: 60 }]);
    expect(request.cheque).toBeUndefined();
  });

  it('keeps an advance free of allocations', () => {
    const request = receiptRequest({ ...form, mode: 'ADVANCE' }, settle(100, 'ADVANCE', [], {}));
    expect(request.autoAllocate).toBe(false);
    expect(request.allocations).toEqual([]);
  });
});

describe('planSchedule', () => {
  const sum = (slots: { amount: number }[]) => Math.round(slots.reduce((s, x) => s + x.amount * 100, 0)) / 100;

  it('puts the down payment first and splits the rest evenly', () => {
    const slots = planSchedule(6000, 1200, 4);
    expect(slots).toEqual([{ seq: 0, amount: 1200 }, { seq: 1, amount: 1200 }, { seq: 2, amount: 1200 }, { seq: 3, amount: 1200 }, { seq: 4, amount: 1200 }]);
  });

  it('lets the last instalment absorb the cents that do not divide evenly, so the plan adds up exactly', () => {
    const slots = planSchedule(1000, 0, 3);
    expect(slots.map(s => s.amount)).toEqual([333.33, 333.33, 333.34]);
    expect(sum(slots)).toBe(1000);
  });

  it('is empty for a plan that cannot exist', () => {
    expect(planSchedule(0, 0, 3)).toEqual([]);
    expect(planSchedule(500, 500, 3)).toEqual([]);
    expect(planSchedule(500, 0, 0)).toEqual([]);
  });
});
