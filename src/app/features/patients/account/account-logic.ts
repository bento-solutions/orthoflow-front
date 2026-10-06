import type { Account, InvoiceBalance, PaymentMethod, PaymentPlanInput, ReceiptInput } from '../../../core/services/finance-api.service';

const cents = (amount: number): number => Math.round(amount * 100);
const fromCents = (value: number): number => value / 100;

/** Invoices that still have something to pay, oldest first, which is the order a payment settles them in. */
export function openInvoices(account: Account | null): InvoiceBalance[] {
  return (account?.invoices ?? [])
    .filter(i => i.balance > 0 && i.status !== 'CANCELLED')
    .sort((a, b) => a.issueDate.localeCompare(b.issueDate) || a.invoiceNumber.localeCompare(b.invoiceNumber));
}

export type SettleMode = 'AUTO' | 'CHOOSE' | 'ADVANCE';

export interface Settlement {
  /** What goes to invoices. */
  allocated: number;
  /** What stays with the patient as credit. */
  leftover: number;
  /** True when more is assigned to invoices than was received, which the server would refuse. */
  over: boolean;
  /** The invoice amounts to send, for the "choose" mode. */
  allocations: { invoiceId: string; amount: number }[];
}

/**
 * How a payment would be spread, so the form can say it before the cashier presses the button:
 * oldest invoices first up to their balance (AUTO), the amounts typed per invoice (CHOOSE), or
 * nothing (ADVANCE). Whatever is not applied becomes the patient's credit. Computed in whole
 * cents: adding decimal amounts as floats drifts by a cent often enough to show.
 */
export function settle(received: number, mode: SettleMode, open: InvoiceBalance[], chosen: Record<string, number>): Settlement {
  const total = cents(received);
  if (mode === 'ADVANCE' || total <= 0) {
    return { allocated: 0, leftover: fromCents(Math.max(total, 0)), over: false, allocations: [] };
  }
  if (mode === 'AUTO') {
    let left = total;
    for (const invoice of open) {
      left -= Math.min(left, cents(invoice.balance));
    }
    return { allocated: fromCents(total - left), leftover: fromCents(left), over: false, allocations: [] };
  }
  const allocations = open
    .map(invoice => ({ invoiceId: invoice.id, amount: Math.min(cents(chosen[invoice.id] ?? 0), cents(invoice.balance)) }))
    .filter(a => a.amount > 0);
  const assigned = allocations.reduce((sum, a) => sum + a.amount, 0);
  return {
    allocated: fromCents(Math.min(assigned, total)),
    leftover: fromCents(Math.max(total - assigned, 0)),
    over: assigned > total,
    allocations: allocations.map(a => ({ invoiceId: a.invoiceId, amount: fromCents(a.amount) })),
  };
}

export interface ReceiptForm {
  amount: number;
  method: PaymentMethod;
  date: string;
  practitionerId: string;
  reference: string;
  notes: string;
  mode: SettleMode;
  chequeNumber: string;
  chequeBank: string;
  chequeDrawer: string;
  chequeDue: string;
}

/** The request for a filled-in form. A cheque carries its own details; nothing blank is sent as an empty string. */
export function receiptRequest(form: ReceiptForm, settlement: Settlement): ReceiptInput {
  const blank = (v: string): string | undefined => (v.trim() === '' ? undefined : v.trim());
  return {
    amount: form.amount,
    method: form.method,
    receiptDate: form.date,
    practitionerId: blank(form.practitionerId),
    reference: blank(form.reference),
    notes: blank(form.notes),
    allocations: form.mode === 'CHOOSE' ? settlement.allocations : [],
    autoAllocate: form.mode === 'AUTO',
    cheque:
      form.method === 'CHEQUE'
        ? { number: blank(form.chequeNumber), bank: blank(form.chequeBank), drawerName: blank(form.chequeDrawer), dueDate: blank(form.chequeDue) }
        : undefined,
  };
}

export interface ScheduledSlot {
  seq: number;
  amount: number;
}

/**
 * The instalments the server will create: the down payment first (as number 0), then equal
 * instalments rounded down to the cent, the last one taking what does not divide evenly so the
 * schedule always adds up to the total. A mirror of the backend rule, for the preview only; the
 * server's answer is what is shown afterwards.
 */
export function planSchedule(total: number, down: number, count: number): ScheduledSlot[] {
  const totalC = cents(total);
  const downC = Math.max(cents(down), 0);
  if (!(count >= 1) || totalC <= 0 || downC >= totalC) {
    return [];
  }
  const slots: ScheduledSlot[] = [];
  if (downC > 0) {
    slots.push({ seq: 0, amount: fromCents(downC) });
  }
  const remainder = totalC - downC;
  const each = Math.floor(remainder / count);
  for (let i = 1; i <= count; i++) {
    slots.push({ seq: i, amount: fromCents(i === count ? remainder - each * (count - 1) : each) });
  }
  return slots;
}

export function planRequest(
  form: { total: number; down: number; count: number; frequency: PaymentPlanInput['frequency']; start: string; invoiceId: string; notes: string },
): PaymentPlanInput {
  return {
    total: form.total,
    downPayment: form.down > 0 ? form.down : undefined,
    instalmentCount: form.count,
    frequency: form.frequency,
    startDate: form.start,
    invoiceId: form.invoiceId || undefined,
    notes: form.notes.trim() || undefined,
  };
}
