import { Component, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ApiErrors } from '../../../core/services/api-error.service';
import { ConfirmDialogService } from '../../../core/services/confirm-dialog.service';
import { LanguageService } from '../../../core/services/language.service';
import { PermissionService } from '../../../core/services/permission.service';
import { Quote, QuoteApi, QuoteState, linesToInvoice, quoteState } from '../../../core/services/quote-api.service';
import { ToastService } from '../../../core/services/toast.service';
import { AppDatePipe } from '../../../shared/pipes/app-date.pipe';
import { MoneyPipe } from '../../../shared/pipes/money.pipe';
import { IconComponent } from '../../../shared/ui/icon.component';
import { ModalComponent } from '../../../shared/ui/modal.component';
import { QuoteEditorComponent } from './quote-editor.component';
import { QuotePrefill } from './quote-logic';

const PILL: Record<QuoteState, string> = {
  DRAFT: 'pill-idle', SENT: 'pill-active', ACCEPTED: 'pill-done', REFUSED: 'pill-critical', CANCELLED: 'pill-idle', EXPIRED: 'pill-attention',
};

/**
 * The patient's devis, at the top of the Facturation tab: what was proposed, what the patient
 * answered, and what is left to invoice. Every step of a devis starts here: write, print, record
 * the answer line by line, invoice the accepted acts.
 */
@Component({
  selector: 'app-patient-quotes',
  standalone: true,
  host: { class: 'block mb-6' },
  imports: [FormsModule, TranslateModule, AppDatePipe, MoneyPipe, IconComponent, ModalComponent, QuoteEditorComponent],
  template: `
    <section class="space-y-3" aria-labelledby="pq-title">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 id="pq-title" class="text-lg font-bold text-ink-900">{{ 'QUOTE.TITLE' | translate }}</h2>
        @if (canWrite()) {
          <button type="button" class="btn btn-primary btn-sm" (click)="editor().openNew()"><app-icon name="plus" [size]="15" /> {{ 'QUOTE.NEW' | translate }}</button>
        }
      </div>

      <div class="table-wrap"><div class="table-scroll">
        <table class="data-table">
          <thead><tr>
            <th scope="col">{{ 'QUOTE.COL.NUMBER' | translate }}</th>
            <th scope="col">{{ 'QUOTE.COL.DATE' | translate }}</th>
            <th scope="col">{{ 'QUOTE.COL.VALID' | translate }}</th>
            <th scope="col">{{ 'COMMON.STATUS' | translate }}</th>
            <th scope="col" class="cell-num">{{ 'QUOTE.COL.TOTAL' | translate }}</th>
            <th scope="col" class="cell-num">{{ 'QUOTE.COL.INVOICED' | translate }}</th>
            <th scope="col" class="cell-actions"><span class="sr-only">{{ 'COMMON.ACTIONS' | translate }}</span></th>
          </tr></thead>
          <tbody>
            @for (q of quotes(); track q.id) {
              <tr>
                <td>
                  <span class="font-bold text-ink-900 ltr-data">{{ q.quoteNumber }}</span>
                  @if (q.title) { <span class="block text-xs text-ink-500">{{ q.title }}</span> }
                </td>
                <td>{{ q.issueDate | appDate }}</td>
                <td>{{ q.validUntil | appDate }}</td>
                <td><span class="pill" [class]="'pill ' + pill(q)">{{ 'QUOTE.STATUS.' + state(q) | translate }}</span></td>
                <td class="cell-num">
                  {{ q.total | money }}
                  @if (q.status === 'ACCEPTED' && q.acceptedTotal !== q.total) {
                    <span class="block text-xs text-ink-500">{{ 'QUOTE.ACCEPTED_PART' | translate: { amount: money(q.acceptedTotal) } }}</span>
                  }
                </td>
                <td class="cell-num">{{ q.status === 'ACCEPTED' ? (q.invoicedTotal | money) : '—' }}</td>
                <td class="cell-actions">
                  <div class="flex flex-wrap justify-end gap-1">
                    <button type="button" class="btn btn-ghost btn-sm" (click)="print(q)" [disabled]="busy()" [attr.aria-label]="('QUOTE.PRINT' | translate) + ' ' + q.quoteNumber">
                      <app-icon name="print" [size]="14" /> {{ 'QUOTE.PDF' | translate }}</button>
                    @if (canWrite()) {
                      @if (q.status === 'DRAFT' || q.status === 'SENT') {
                        <button type="button" class="btn btn-ghost btn-sm" (click)="editor().openEdit(q)" [disabled]="busy()">{{ 'COMMON.EDIT' | translate }}</button>
                        <button type="button" class="btn btn-secondary btn-sm" (click)="openAccept(q)" [disabled]="busy()">{{ 'QUOTE.ACCEPT' | translate }}</button>
                        <button type="button" class="btn btn-ghost btn-sm" (click)="refuse(q)" [disabled]="busy()">{{ 'QUOTE.REFUSE' | translate }}</button>
                      }
                      @if (toInvoice(q).length) {
                        <button type="button" class="btn btn-primary btn-sm" (click)="invoice(q)" [disabled]="busy()">{{ 'QUOTE.INVOICE' | translate }}</button>
                      }
                      @if (q.status === 'DRAFT') {
                        <button type="button" class="btn btn-ghost btn-icon text-critical-700" (click)="remove(q)" [disabled]="busy()" [attr.aria-label]="('COMMON.DELETE' | translate) + ' ' + q.quoteNumber">
                          <app-icon name="trash" [size]="14" /></button>
                      } @else if (q.status !== 'CANCELLED' && q.invoicedTotal === 0) {
                        <button type="button" class="btn btn-ghost btn-sm text-critical-700" (click)="cancel(q)" [disabled]="busy()">{{ 'QUOTE.CANCEL' | translate }}</button>
                      }
                    }
                  </div>
                </td>
              </tr>
            } @empty {
              <tr><td colspan="7" class="py-6 text-center text-ink-500">{{ 'QUOTE.EMPTY' | translate }}</td></tr>
            }
          </tbody>
        </table>
      </div></div>
    </section>

    <app-quote-editor [patientId]="patientId()" (saved)="changed.emit()" />

    <!-- The patient's answer, line by line -->
    <app-modal [open]="accepting() !== null" [title]="'QUOTE.ACCEPT_TITLE' | translate: { number: accepting()?.quoteNumber ?? '' }" size="lg"
               [dismissable]="!busy()" (closed)="accepting.set(null)">
      @if (accepting(); as q) {
        <form id="accept-form" class="space-y-4" (ngSubmit)="submitAccept()">
          <p class="text-sm text-ink-600">{{ 'QUOTE.ACCEPT_HINT' | translate }}</p>
          <ul class="space-y-1">
            @for (l of q.lines; track l.id) {
              <li class="flex items-center justify-between gap-3 rounded-lg border border-ink-200 px-3 py-2">
                <label class="inline-flex min-w-0 items-center gap-2">
                  <input type="checkbox" [name]="'line-' + l.id" [checked]="chosen().has(l.id)" (change)="toggle(l.id)" />
                  <span class="font-semibold">{{ l.label }}</span>
                  @if (l.teeth) { <span class="text-xs text-ink-500">{{ 'QUOTE.TOOTH' | translate }} {{ l.teeth }}</span> }
                </label>
                <span class="tnum">{{ l.lineTotal | money }}</span>
              </li>
            }
          </ul>
          <p class="flex justify-between text-sm font-bold"><span>{{ 'QUOTE.ACCEPTED_TOTAL' | translate }}</span><span class="tnum">{{ chosenTotal() | money }}</span></p>
          <label class="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" name="plan" [(ngModel)]="addToPlan" /> {{ 'QUOTE.ADD_TO_PLAN' | translate }}
          </label>
          <p class="hint">{{ 'QUOTE.DEPOSIT_HINT' | translate }}</p>
        </form>
      }
      <div modal-footer>
        <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="accepting.set(null)">{{ 'COMMON.CANCEL' | translate }}</button>
        <button type="submit" form="accept-form" class="btn btn-primary" [disabled]="busy() || chosen().size === 0">{{ 'QUOTE.ACCEPT_SUBMIT' | translate }}</button>
      </div>
    </app-modal>
  `,
})
export class PatientQuotesComponent {
  readonly patientId = input.required<string>();
  readonly quotes = input<Quote[]>([]);
  /** A devis to start from (the plan's "Créer un devis"): opened as soon as it arrives. */
  readonly prefill = input<QuotePrefill | null>(null);
  readonly prefillUsed = output<void>();
  /** Something changed (a devis, or treatments planned from one): the parent reloads. */
  readonly changed = output<void>();

  private readonly api = inject(QuoteApi);
  private readonly router = inject(Router);
  private readonly errors = inject(ApiErrors);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  private readonly permissions = inject(PermissionService);
  private readonly moneyPipe = new MoneyPipe();

  protected readonly editor = viewChild.required(QuoteEditorComponent);
  protected readonly canWrite = computed(() => this.permissions.can('BILLING_WRITE'));
  protected readonly busy = signal(false);
  protected readonly accepting = signal<Quote | null>(null);
  protected readonly chosen = signal<Set<string>>(new Set());
  protected readonly chosenTotal = computed(() =>
    (this.accepting()?.lines ?? []).filter(l => this.chosen().has(l.id)).reduce((s, l) => s + l.lineTotal, 0));
  protected addToPlan = true;

  protected readonly state = quoteState;
  protected readonly toInvoice = linesToInvoice;
  protected pill(q: Quote): string {
    return PILL[quoteState(q)];
  }
  protected money(v: number): string {
    return this.moneyPipe.transform(v);
  }

  private readonly openPrefill = effect(() => {
    const prefill = this.prefill();
    if (!prefill) return;
    untracked(() => {
      this.editor().openNew(prefill);
      this.prefillUsed.emit();
    });
  });

  protected async print(q: Quote): Promise<void> {
    await this.run(async () => {
      const after = await this.api.print(q, this.language.currentLang());
      if (after.status !== q.status) this.changed.emit();
    });
  }

  protected openAccept(q: Quote): void {
    this.chosen.set(new Set(q.lines.map(l => l.id)));
    this.addToPlan = true;
    this.accepting.set(q);
  }

  protected toggle(id: string): void {
    this.chosen.update(s => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  protected async submitAccept(): Promise<void> {
    const q = this.accepting();
    if (!q || this.chosen().size === 0) return;
    await this.run(async () => {
      await this.api.accept(q.id, [...this.chosen()], this.addToPlan);
      this.accepting.set(null);
      this.toast.success(this.translate.instant(this.addToPlan ? 'QUOTE.ACCEPTED_PLANNED' : 'QUOTE.ACCEPTED_DONE', { number: q.quoteNumber }));
      this.changed.emit();
    });
  }

  protected async refuse(q: Quote): Promise<void> {
    const ok = await this.confirm.confirm(this.translate.instant('QUOTE.REFUSE_CONFIRM', { number: q.quoteNumber }),
      { confirmLabel: this.translate.instant('QUOTE.REFUSE') });
    if (!ok) return;
    await this.run(async () => {
      await this.api.refuse(q.id);
      this.changed.emit();
    });
  }

  protected async cancel(q: Quote): Promise<void> {
    const ok = await this.confirm.confirm(this.translate.instant('QUOTE.CANCEL_CONFIRM', { number: q.quoteNumber }),
      { danger: true, confirmLabel: this.translate.instant('QUOTE.CANCEL') });
    if (!ok) return;
    await this.run(async () => {
      await this.api.cancel(q.id);
      this.changed.emit();
    });
  }

  protected async remove(q: Quote): Promise<void> {
    const ok = await this.confirm.confirm(this.translate.instant('QUOTE.DELETE_CONFIRM', { number: q.quoteNumber }),
      { danger: true, confirmLabel: this.translate.instant('COMMON.DELETE') });
    if (!ok) return;
    await this.run(async () => {
      await this.api.remove(q.id);
      this.changed.emit();
    });
  }

  /** Opens the invoice form with the accepted lines not invoiced yet, to check and create. */
  protected invoice(q: Quote): void {
    void this.router.navigate(['/billing/invoices/create'], {
      queryParams: { patientId: this.patientId(), quoteId: q.id, quoteLines: linesToInvoice(q).map(l => l.id).join(',') },
    });
  }

  private async run(work: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    try {
      await work();
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.busy.set(false);
    }
  }
}
