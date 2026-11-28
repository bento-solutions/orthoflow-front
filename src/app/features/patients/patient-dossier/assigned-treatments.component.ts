import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import type { Quote, QuoteLine } from '../../../core/services/quote-api.service';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { PatientTreatment, PatientTreatmentConsumable, PatientTreatmentStatus } from '../../../core/models/patient-treatment.model';
import { StockItem, Treatment } from '../../../core/models/stock.model';
import { ConfirmDialogService } from '../../../core/services/confirm-dialog.service';
import { PatientTreatmentRequestPayload, PatientTreatmentService } from '../../../core/services/patient-treatment.service';
import { PermissionService } from '../../../core/services/permission.service';
import { StockService } from '../../../core/services/stock.service';
import { ToastService } from '../../../core/services/toast.service';
import { AppDatePipe } from '../../../shared/pipes/app-date.pipe';
import { EmptyStateComponent } from '../../../shared/ui/empty-state.component';
import { IconComponent } from '../../../shared/ui/icon.component';
import { ModalComponent } from '../../../shared/ui/modal.component';
import { StatusPillComponent } from '../../../shared/ui/status-pill.component';

/**
 * The treatments assigned to the patient, with their progress, and the form that assigns one
 * (from the chart's tooth panel, with that tooth filled in, or from here).
 */
@Component({
  selector: 'app-assigned-treatments',
  standalone: true,
  imports: [FormsModule, TranslateModule, AppDatePipe, EmptyStateComponent, IconComponent, ModalComponent, StatusPillComponent],
  template: `
    <section class="card p-5" aria-labelledby="at-title">
      <header class="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 id="at-title" class="text-lg font-bold">{{ 'PATIENTS.DOSSIER.UI.TREATMENTS' | translate }}</h3>
        @if (canWrite()) {
          <button type="button" class="btn btn-secondary btn-sm" (click)="open()">
            <app-icon name="plus" [size]="14" /> {{ 'PATIENTS.DOSSIER.UI.ASSIGN' | translate }}
          </button>
        }
      </header>

      @if (treatments().length) {
        <ul class="space-y-2">
          @for (pt of treatments(); track pt.id) {
            <li class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink-200 bg-ink-50 px-4 py-3">
              <div class="min-w-0 flex-1">
                <p class="flex flex-wrap items-center gap-2">
                  <span class="font-bold text-ink-900">{{ pt.treatment.name }}</span>
                  @if (pt.teeth) { <span class="rounded bg-ink-200 px-1.5 py-0.5 text-xs font-bold text-ink-700">{{ 'PATIENTS.DOSSIER.UI.TEETH' | translate: { teeth: pt.teeth } }}</span> }
                  @if (quoteOf(pt); as link) {
                    <span class="pill pill-idle ltr-data">{{ 'QUOTE.ON_QUOTE' | translate: { number: link.quote.quoteNumber } }}</span>
                    @if (link.line.invoiceId) { <span class="pill pill-done">{{ 'QUOTE.INVOICED' | translate }}</span> }
                  }
                </p>
                <p class="mt-1 flex flex-wrap gap-x-4 text-xs text-ink-500">
                  @if (pt.doctorName) { <span><b class="text-ink-700">{{ 'PATIENTS.DOSSIER.UI.DOCTOR' | translate }}</b> {{ pt.doctorName }}</span> }
                  @if (pt.startDate) { <span><b class="text-ink-700">{{ 'PATIENTS.DOSSIER.UI.STARTED' | translate }}</b> {{ pt.startDate | appDate }}</span> }
                </p>
                @if (pt.notes) { <p class="mt-1 text-sm text-ink-600">{{ pt.notes }}</p> }
              </div>
              <div class="flex items-center gap-4">
                <div class="flex flex-col items-end gap-1">
                  <app-status-pill [status]="pt.status" />
                  <div class="flex items-center gap-2">
                    <div class="h-1.5 w-24 rounded-full bg-ink-200" role="progressbar" [attr.aria-valuenow]="pt.progress" aria-valuemin="0" aria-valuemax="100"
                         [attr.aria-label]="'PATIENTS.DOSSIER.UI.PROGRESS' | translate: { value: pt.progress }">
                      <div class="h-full rounded-full bg-petrol-600" [style.width.%]="pt.progress"></div>
                    </div>
                    <span class="text-xs font-bold text-ink-500">{{ pt.progress }}%</span>
                  </div>
                </div>
                @if (canBill() && pt.status !== 'CANCELLED' && !quoteOf(pt)?.line?.invoiceId) {
                  <button type="button" class="btn btn-secondary btn-sm" (click)="bill(pt)">{{ 'QUOTE.INVOICE' | translate }}</button>
                }
                @if (canWrite()) {
                  <div class="flex gap-1">
                    <button type="button" class="btn btn-ghost btn-icon" (click)="open(pt)" [attr.aria-label]="('COMMON.EDIT' | translate) + ' ' + pt.treatment.name">
                      <app-icon name="edit" [size]="16" />
                    </button>
                    <button type="button" class="btn btn-ghost btn-icon text-critical-700" (click)="remove(pt)" [attr.aria-label]="('COMMON.DELETE' | translate) + ' ' + pt.treatment.name">
                      <app-icon name="trash" [size]="16" />
                    </button>
                  </div>
                }
              </div>
            </li>
          }
        </ul>
      } @else {
        <app-empty-state icon="activity" [compact]="true" [title]="'PATIENTS.DOSSIER.UI.NO_TREATMENTS' | translate"
          [text]="'PATIENTS.DOSSIER.EMPTY.TREATMENTS' | translate"
          [actionLabel]="canWrite() ? ('PATIENTS.DOSSIER.UI.ASSIGN_FIRST' | translate) : null" (action)="open()" />
      }
    </section>

    <app-modal [open]="modal()" size="lg" [dismissable]="!busy()"
               [title]="(editing() ? 'PATIENTS.DOSSIER.UI.EDIT_ASSIGNMENT' : 'PATIENTS.DOSSIER.UI.NEW_ASSIGNMENT') | translate" (closed)="close()">
      <form id="assign-form" class="grid gap-4 sm:grid-cols-2" (ngSubmit)="save()">
        <label class="field sm:col-span-2">
          <span class="label label-required">{{ 'PATIENTS.DOSSIER.UI.TREATMENT_SETUP' | translate }}</span>
          <select class="select" name="treatment" required [(ngModel)]="form.treatmentId" (ngModelChange)="onTreatmentPicked($event)" [disabled]="!!editing()">
            <option value="" disabled>{{ 'PATIENTS.DOSSIER.UI.CHOOSE_TREATMENT' | translate }}</option>
            @for (t of catalogue(); track t.id) { <option [value]="t.id">{{ t.name }} ({{ t.code }})</option> }
          </select>
        </label>
        <label class="field">
          <span class="label label-required">{{ 'PATIENTS.DOSSIER.UI.ASSIGNED_TEETH' | translate }}</span>
          <input class="input" name="teeth" required [(ngModel)]="form.teeth" placeholder="11, 12, 13" autocomplete="off" />
        </label>
        <label class="field">
          <span class="label label-required">{{ 'PATIENTS.DOSSIER.UI.ASSIGNED_DOCTOR' | translate }}</span>
          <input class="input" name="doctor" required [(ngModel)]="form.doctorName" autocomplete="off" />
        </label>
        <label class="field">
          <span class="label">{{ 'COMMON.STATUS' | translate }}</span>
          <select class="select" name="status" [(ngModel)]="form.status">
            <option value="PLANNED">{{ 'PATIENTS.DOSSIER.UI.STATUS_PLANNED' | translate }}</option>
            <option value="ACTIVE">{{ 'PATIENTS.DOSSIER.UI.STATUS_ACTIVE' | translate }}</option>
            <option value="COMPLETED">{{ 'PATIENTS.DOSSIER.UI.STATUS_COMPLETED' | translate }}</option>
            <option value="CANCELLED">{{ 'PATIENTS.DOSSIER.UI.STATUS_CANCELLED' | translate }}</option>
          </select>
        </label>
        <label class="field">
          <span class="label">{{ 'PATIENTS.DOSSIER.UI.PROGRESS' | translate: { value: form.progress } }}</span>
          <input type="range" name="progress" min="0" max="100" step="5" [(ngModel)]="form.progress" />
        </label>
        <label class="field">
          <span class="label">{{ 'PATIENTS.DOSSIER.UI.START_DATE' | translate }}</span>
          <input class="input" type="date" name="start" [(ngModel)]="form.startDate" />
        </label>
        <label class="field">
          <span class="label">{{ 'PATIENTS.DOSSIER.UI.END_DATE' | translate }}</span>
          <input class="input" type="date" name="end" [(ngModel)]="form.endDate" />
        </label>
        <label class="field sm:col-span-2">
          <span class="label">{{ 'PATIENTS.DOSSIER.UI.CLINICAL_NOTES' | translate }}</span>
          <textarea class="textarea" name="notes" [(ngModel)]="form.notes" [placeholder]="'PATIENTS.DOSSIER.UI.CLINICAL_NOTES_HINT' | translate"></textarea>
        </label>

        <fieldset class="sm:col-span-2">
          <div class="mb-2 flex items-center justify-between">
            <legend class="label">{{ 'PATIENTS.DOSSIER.UI.MATERIALS' | translate }}</legend>
            <button type="button" class="btn btn-secondary btn-sm" (click)="addConsumable()" [disabled]="!stock().length">
              <app-icon name="plus" [size]="14" /> {{ 'PATIENTS.DOSSIER.UI.ADD_MATERIAL' | translate }}
            </button>
          </div>
          <div class="space-y-2 rounded-lg border border-ink-200 bg-ink-50 p-3">
            @for (c of form.consumables; track $index; let i = $index) {
              <div class="grid grid-cols-[1fr_7rem_auto] items-center gap-2">
                <select class="select" [name]="'item' + i" [(ngModel)]="c.stockItem" [attr.aria-label]="'STOCK.UI.STOCK_ITEM' | translate" [compareWith]="sameItem">
                  @for (item of stock(); track item.id) { <option [ngValue]="item">{{ item.name }} ({{ 'STOCK.UI.SKU' | translate }} {{ item.sku }})</option> }
                </select>
                <span class="flex items-center gap-1">
                  <input class="input" type="number" step="any" [name]="'qty' + i" [(ngModel)]="c.quantityUsed" [attr.aria-label]="'BILLING.FORM.QTY' | translate" />
                  <span class="text-xs text-ink-500">{{ c.stockItem.unitLabel || ('STOCK.UI.UNITS' | translate) }}</span>
                </span>
                <button type="button" class="btn btn-ghost btn-icon text-critical-700" (click)="form.consumables.splice(i, 1)" [attr.aria-label]="'COMMON.DELETE' | translate">
                  <app-icon name="trash" [size]="16" />
                </button>
              </div>
            } @empty {
              <p class="text-center text-sm text-ink-500">{{ 'PATIENTS.DOSSIER.UI.NO_MATERIALS' | translate }}</p>
            }
          </div>
        </fieldset>
      </form>
      <div modal-footer>
        <button type="button" class="btn btn-secondary" (click)="close()" [disabled]="busy()">{{ 'COMMON.CANCEL' | translate }}</button>
        <button type="submit" form="assign-form" class="btn btn-primary" [disabled]="busy()">{{ 'PATIENTS.DOSSIER.UI.SAVE_ASSIGNMENT' | translate }}</button>
      </div>
    </app-modal>
  `,
})
export class AssignedTreatmentsComponent {
  readonly patientId = input.required<string>();
  readonly treatments = input<PatientTreatment[]>([]);
  /** The patient's devis: a treatment that came from one says so, and is invoiced through it. */
  readonly quotes = input<Quote[]>([]);
  /** The patient's treatments changed: the parent reloads them. */
  readonly changed = output<void>();

  private readonly api = inject(PatientTreatmentService);
  private readonly stockService = inject(StockService);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private readonly permissions = inject(PermissionService);

  protected readonly canWrite = computed(() => this.permissions.can('CLINICAL_WRITE'));
  protected readonly canBill = computed(() => this.permissions.can('BILLING_WRITE'));
  private readonly router = inject(Router);
  private readonly quoteLines = computed(() => {
    const byTreatment = new Map<string, { quote: Quote; line: QuoteLine }>();
    for (const quote of this.quotes()) {
      if (quote.status !== 'ACCEPTED') continue;
      for (const line of quote.lines) if (line.patientTreatmentId && line.accepted) byTreatment.set(line.patientTreatmentId, { quote, line });
    }
    return byTreatment;
  });

  protected quoteOf(pt: PatientTreatment): { quote: Quote; line: QuoteLine } | null {
    return (pt.id && this.quoteLines().get(pt.id)) || null;
  }

  /**
   * "Facturer": the invoice form, filled in. A treatment accepted on a devis is billed at the
   * devis's price and marked billed on it; any other at the catalogue price.
   */
  protected bill(pt: PatientTreatment): void {
    const link = this.quoteOf(pt);
    const queryParams = link
      ? { patientId: this.patientId(), quoteId: link.quote.id, quoteLines: link.line.id }
      : { patientId: this.patientId(), treatmentIds: pt.id };
    void this.router.navigate(['/billing/invoices/create'], { queryParams });
  }
  protected readonly catalogue = signal<Treatment[]>([]);
  protected readonly stock = signal<StockItem[]>([]);
  protected readonly modal = signal(false);
  protected readonly editing = signal<PatientTreatment | null>(null);
  protected readonly busy = signal(false);
  private loaded = false;

  protected form = blankForm('');

  protected readonly sameItem = (a: StockItem | null, b: StockItem | null) => a?.id === b?.id;

  /** Opens the form: to edit `treatment`, or to assign a new one on `tooth`. */
  open(treatment?: PatientTreatment, tooth?: string | null): void {
    this.loadCatalogues();
    if (treatment) {
      this.editing.set(treatment);
      this.form = {
        treatmentId: treatment.treatment.id || '',
        teeth: treatment.teeth,
        status: treatment.status,
        progress: treatment.progress,
        notes: treatment.notes || '',
        doctorName: treatment.doctorName || '',
        startDate: treatment.startDate || '',
        endDate: treatment.endDate || '',
        consumables: (treatment.consumables ?? []).map(c => ({ ...c })),
      };
    } else {
      this.editing.set(null);
      this.form = blankForm(tooth ?? '');
    }
    this.modal.set(true);
  }

  protected close(): void {
    this.modal.set(false);
    this.editing.set(null);
  }

  private loadCatalogues(): void {
    if (this.loaded) return;
    this.loaded = true;
    this.stockService.getTreatments().subscribe(list => this.catalogue.set(list));
    this.stockService.getStockItems().subscribe(list => this.stock.set(list));
  }

  protected onTreatmentPicked(id: string): void {
    const picked = this.catalogue().find(t => t.id === id);
    this.form.consumables = (picked?.consumables ?? []).map(c => ({
      stockItem: c.stockItem, quantityUsed: c.quantityUsed, pricePerUnit: c.stockItem.pricePerUse, notes: '',
    }));
  }

  protected addConsumable(): void {
    const first = this.stock()[0];
    if (!first) return;
    this.form.consumables.push({ stockItem: first, quantityUsed: 1, pricePerUnit: first.pricePerUse || 0, notes: '' });
  }

  protected save(): void {
    const treatment = this.catalogue().find(t => t.id === this.form.treatmentId) ?? this.editing()?.treatment;
    if (!treatment?.id) {
      this.toast.error(this.translate.instant('PATIENTS.DOSSIER.UI.SELECT_VALID_TREATMENT'));
      return;
    }
    const payload: PatientTreatmentRequestPayload = {
      treatmentId: treatment.id,
      teeth: this.form.teeth,
      status: this.form.status,
      progress: this.form.progress,
      notes: this.form.notes,
      doctorName: this.form.doctorName,
      startDate: this.form.startDate || undefined,
      endDate: this.form.endDate || undefined,
      consumables: this.form.consumables.map(c => ({ stockItemId: c.stockItem.id, quantityUsed: c.quantityUsed, notes: c.notes })),
    };
    const editing = this.editing();
    const call = editing?.id
      ? this.api.updatePatientTreatment(this.patientId(), editing.id, payload)
      : this.api.createPatientTreatment(this.patientId(), payload);
    this.busy.set(true);
    call.subscribe({
      next: () => {
        this.busy.set(false);
        this.close();
        this.changed.emit();
      },
      error: (err: { error?: { detail?: string; message?: string }; message?: string }) => {
        this.busy.set(false);
        this.toast.error(err.error?.detail || err.error?.message || this.translate.instant('PATIENTS.DOSSIER.UI.ASSIGNMENT_SAVE_FAILED'));
      },
    });
  }

  protected async remove(treatment: PatientTreatment): Promise<void> {
    if (!treatment.id) return;
    const ok = await this.confirmDialog.confirm(
      this.translate.instant('PATIENTS.DOSSIER.UI.ASSIGNMENT_DELETE_CONFIRM'),
      { danger: true, confirmLabel: this.translate.instant('COMMON.DELETE') });
    if (!ok) return;
    this.api.deletePatientTreatment(this.patientId(), treatment.id).subscribe({
      next: () => {
        this.toast.success(this.translate.instant('PATIENTS.DOSSIER.UI.ASSIGNMENT_DELETED'));
        this.changed.emit();
      },
      error: () => this.toast.error(this.translate.instant('PATIENTS.DOSSIER.UI.ASSIGNMENT_DELETE_FAILED')),
    });
  }
}

function blankForm(teeth: string) {
  return {
    treatmentId: '',
    teeth,
    status: 'PLANNED' as PatientTreatmentStatus,
    progress: 0,
    notes: '',
    doctorName: '',
    startDate: new Date().toISOString().split('T')[0],
    endDate: '',
    consumables: [] as PatientTreatmentConsumable[],
  };
}
