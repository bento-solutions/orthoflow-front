import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import type { Treatment } from '../../../core/models/stock.model';
import { ApiErrors } from '../../../core/services/api-error.service';
import { LanguageService } from '../../../core/services/language.service';
import { Quote, QuoteApi } from '../../../core/services/quote-api.service';
import { StockService } from '../../../core/services/stock.service';
import { ToastService } from '../../../core/services/toast.service';
import { MoneyPipe } from '../../../shared/pipes/money.pipe';
import { IconComponent } from '../../../shared/ui/icon.component';
import { ModalComponent } from '../../../shared/ui/modal.component';
import { QuoteDraftLine, QuotePrefill, blankLine, fromQuote, lineFromCatalogue, lineProblem, lineTotal, toInput, totals } from './quote-logic';

/**
 * Writing a devis: acts from the catalogue (code, label and price filled in) or free lines, the
 * teeth, quantities and discounts, a title, a validity date and a note. Saved as a draft, or
 * saved and printed, which hands it over.
 */
@Component({
  selector: 'app-quote-editor',
  standalone: true,
  imports: [FormsModule, TranslateModule, MoneyPipe, IconComponent, ModalComponent],
  template: `
    <app-modal [open]="isOpen()" [title]="(editing() ? 'QUOTE.EDIT_TITLE' : 'QUOTE.NEW_TITLE') | translate: { number: editing()?.quoteNumber ?? '' }"
               size="xl" [dismissable]="!busy()" (closed)="close()">
      <form id="quote-form" class="space-y-4" (ngSubmit)="save(false)">
        <div class="grid gap-4 sm:grid-cols-3">
          <label class="field sm:col-span-2"><span class="label">{{ 'QUOTE.SUBJECT' | translate }}</span>
            <input class="input" name="title" maxlength="200" [placeholder]="'QUOTE.SUBJECT_HINT' | translate" [(ngModel)]="title" /></label>
          <label class="field"><span class="label">{{ 'QUOTE.VALID_UNTIL' | translate }}</span>
            <input class="input" type="date" name="validUntil" [(ngModel)]="validUntil" />
            @if (!validUntil) { <span class="hint">{{ 'QUOTE.VALID_DEFAULT' | translate }}</span> }</label>
        </div>

        <fieldset>
          <legend class="label mb-2">{{ 'QUOTE.LINES' | translate }}</legend>
          <div class="table-wrap"><div class="table-scroll">
            <table class="data-table qe-lines">
              <thead><tr>
                <th scope="col">{{ 'QUOTE.COL.ACT' | translate }}</th>
                <th scope="col" class="w-24">{{ 'QUOTE.COL.CODE' | translate }}</th>
                <th scope="col" class="w-28">{{ 'QUOTE.COL.TEETH' | translate }}</th>
                <th scope="col" class="w-20 cell-num">{{ 'QUOTE.COL.QTY' | translate }}</th>
                <th scope="col" class="w-28 cell-num">{{ 'QUOTE.COL.PRICE' | translate }}</th>
                <th scope="col" class="w-20 cell-num">{{ 'QUOTE.COL.DISCOUNT' | translate }}</th>
                <th scope="col" class="w-28 cell-num">{{ 'QUOTE.COL.TOTAL' | translate }}</th>
                <th scope="col" class="cell-actions"><span class="sr-only">{{ 'COMMON.ACTIONS' | translate }}</span></th>
              </tr></thead>
              <tbody>
                @for (l of lines(); track $index; let i = $index) {
                  <tr>
                    <td><input class="input" [name]="'label-' + i" maxlength="255" required [attr.aria-label]="'QUOTE.COL.ACT' | translate"
                               [ngModel]="l.label" (ngModelChange)="patch(i, { label: $event })" /></td>
                    <td><input class="input mono" [name]="'code-' + i" maxlength="32" [attr.aria-label]="'QUOTE.COL.CODE' | translate"
                               [ngModel]="l.actCode" (ngModelChange)="patch(i, { actCode: $event })" /></td>
                    <td><input class="input" [name]="'teeth-' + i" maxlength="255" placeholder="16, 26" [attr.aria-label]="'QUOTE.COL.TEETH' | translate"
                               [ngModel]="l.teeth" (ngModelChange)="patch(i, { teeth: $event })" /></td>
                    <td><input class="input text-end" type="number" min="1" step="1" [name]="'qty-' + i" [attr.aria-label]="'QUOTE.COL.QTY' | translate"
                               [ngModel]="l.quantity" (ngModelChange)="patch(i, { quantity: +$event || 0 })" /></td>
                    <td><input class="input text-end" type="number" min="0" step="0.01" [name]="'price-' + i" [attr.aria-label]="'QUOTE.COL.PRICE' | translate"
                               [ngModel]="l.unitPrice" (ngModelChange)="patch(i, { unitPrice: +$event || 0 })" /></td>
                    <td><input class="input text-end" type="number" min="0" max="100" step="1" [name]="'disc-' + i" [attr.aria-label]="'QUOTE.COL.DISCOUNT' | translate"
                               [ngModel]="l.discountPct" (ngModelChange)="patch(i, { discountPct: +$event || 0 })" /></td>
                    <td class="cell-num tnum font-semibold">{{ lineTotal(l) | money }}</td>
                    <td class="cell-actions">
                      <button type="button" class="btn btn-ghost btn-icon text-critical-700" (click)="removeLine(i)" [disabled]="lines().length === 1"
                              [attr.aria-label]="'QUOTE.REMOVE_LINE' | translate"><app-icon name="trash" [size]="15" /></button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div></div>
          <div class="mt-2 flex flex-wrap items-center gap-2">
            <select class="select qe-pick" name="catalogue" [attr.aria-label]="'QUOTE.ADD_FROM_CATALOGUE' | translate" [ngModel]="''" (ngModelChange)="addFromCatalogue($event)">
              <option value="">{{ 'QUOTE.ADD_FROM_CATALOGUE' | translate }}</option>
              @for (t of catalogue(); track t.id) { <option [value]="t.id">{{ t.name }}{{ t.basePrice != null ? ' · ' + (t.basePrice | money) : '' }}</option> }
            </select>
            <button type="button" class="btn btn-secondary btn-sm" (click)="addLine()"><app-icon name="plus" [size]="14" /> {{ 'QUOTE.ADD_FREE_LINE' | translate }}</button>
          </div>
        </fieldset>

        <div class="grid gap-4 sm:grid-cols-3">
          <label class="field sm:col-span-2"><span class="label">{{ 'QUOTE.NOTES' | translate }}</span>
            <textarea class="textarea" rows="3" name="notes" [placeholder]="'QUOTE.NOTES_HINT' | translate" [(ngModel)]="notes"></textarea></label>
          <dl class="qe-totals self-end">
            <div><dt>{{ 'QUOTE.SUBTOTAL' | translate }}</dt><dd class="tnum">{{ sums().subtotal | money }}</dd></div>
            @if (sums().discount > 0) { <div><dt>{{ 'QUOTE.DISCOUNT' | translate }}</dt><dd class="tnum">- {{ sums().discount | money }}</dd></div> }
            <div class="qe-grand"><dt>{{ 'QUOTE.TOTAL' | translate }}</dt><dd class="tnum">{{ sums().total | money }}</dd></div>
          </dl>
        </div>
        @if (problem(); as p) { <p class="text-sm text-critical-700" role="alert">{{ p | translate }}</p> }
      </form>
      <div modal-footer>
        <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="close()">{{ 'COMMON.CANCEL' | translate }}</button>
        <button type="submit" form="quote-form" class="btn btn-secondary" [disabled]="busy() || !!problem()">{{ 'QUOTE.SAVE_DRAFT' | translate }}</button>
        <button type="button" class="btn btn-primary" [disabled]="busy() || !!problem()" (click)="save(true)">
          <app-icon name="print" [size]="15" /> {{ 'QUOTE.SAVE_PRINT' | translate }}</button>
      </div>
    </app-modal>
  `,
  styles: [`
    .qe-lines .input { min-width: 0; width: 100%; }
    .qe-lines td:first-child { min-width: 14rem; }
    .qe-pick { max-width: 22rem; }
    .qe-totals { display: grid; gap: .25rem; font-size: var(--text-sm); }
    .qe-totals div { display: flex; justify-content: space-between; gap: 1rem; }
    .qe-totals dt { color: rgb(var(--ink-600)); }
    .qe-grand { border-top: 1px solid rgb(var(--ink-200)); padding-top: .25rem; font-weight: 700; font-size: var(--text-base); }
  `],
})
export class QuoteEditorComponent {
  readonly patientId = input.required<string>();
  /** Saved (and, when asked, printed): the parent reloads its devis. */
  readonly saved = output<Quote>();

  private readonly api = inject(QuoteApi);
  private readonly stock = inject(StockService);
  private readonly errors = inject(ApiErrors);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);

  protected readonly isOpen = signal(false);
  protected readonly busy = signal(false);
  protected readonly editing = signal<Quote | null>(null);
  protected readonly catalogue = signal<Treatment[]>([]);
  protected readonly lines = signal<QuoteDraftLine[]>([blankLine()]);
  protected title = '';
  protected notes = '';
  protected validUntil = '';

  protected readonly lineTotal = lineTotal;
  protected readonly sums = computed(() => totals(this.lines()));
  protected readonly problem = computed(() => this.lines().map(lineProblem).find(Boolean) ?? null);

  /** A new devis, with what the plan (or a consultation) proposed already on it. */
  openNew(prefill?: QuotePrefill): void {
    this.editing.set(null);
    this.lines.set(prefill?.lines.length ? prefill.lines.map(l => ({ ...l })) : [blankLine()]);
    this.title = prefill?.title ?? '';
    this.notes = prefill?.notes ?? '';
    this.validUntil = '';
    this.show();
  }

  openEdit(quote: Quote): void {
    this.editing.set(quote);
    this.lines.set(fromQuote(quote));
    this.title = quote.title || '';
    this.notes = quote.notes || '';
    this.validUntil = quote.validUntil || '';
    this.show();
  }

  protected close(): void {
    this.isOpen.set(false);
  }

  protected patch(index: number, change: Partial<QuoteDraftLine>): void {
    this.lines.update(ls => ls.map((l, i) => (i === index ? { ...l, ...change } : l)));
  }

  protected addLine(): void {
    this.lines.update(ls => [...ls, blankLine()]);
  }

  protected removeLine(index: number): void {
    this.lines.update(ls => ls.filter((_, i) => i !== index));
  }

  protected addFromCatalogue(id: string): void {
    const t = this.catalogue().find(c => c.id === id);
    if (!t) return;
    const line = lineFromCatalogue(t);
    // The empty line a new devis opens with is replaced rather than left blank above.
    this.lines.update(ls => (ls.length === 1 && !ls[0].label.trim() ? [line] : [...ls, line]));
  }

  protected async save(print: boolean): Promise<void> {
    if (this.problem()) return;
    const editing = this.editing();
    const body = {
      patientId: this.patientId(),
      title: this.title.trim() || undefined,
      notes: this.notes.trim() || undefined,
      validUntil: this.validUntil || undefined,
      lines: this.lines().map(toInput),
    };
    this.busy.set(true);
    try {
      let quote = editing ? await this.api.update(editing.id, body) : await this.api.create(body);
      if (print) quote = await this.api.print(quote, this.language.currentLang());
      this.toast.success(this.translate.instant(editing ? 'QUOTE.UPDATED' : 'QUOTE.CREATED', { number: quote.quoteNumber }));
      this.isOpen.set(false);
      this.saved.emit(quote);
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.busy.set(false);
    }
  }

  private show(): void {
    this.isOpen.set(true);
    if (!this.catalogue().length) {
      void firstValueFrom(this.stock.getTreatments())
        .then(list => this.catalogue.set(list.filter(t => t.active !== false).sort((a, b) => a.name.localeCompare(b.name))))
        .catch(() => undefined);
    }
  }
}
