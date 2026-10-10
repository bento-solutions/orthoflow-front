import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ApiErrors } from '../../../core/services/api-error.service';
import { ConfirmDialogService } from '../../../core/services/confirm-dialog.service';
import {
  InsuranceForm, InsuranceFormLineInput, InsuranceFormPreview, InsuranceFormPurpose, InsuranceFormStatus, InsuranceFormsApi,
} from '../../../core/services/insurance-forms-api.service';
import { PermissionService } from '../../../core/services/permission.service';
import { Prescription, PrescriptionsApi } from '../../../core/services/prescriptions-api.service';
import { StockService } from '../../../core/services/stock.service';
import { ToastService } from '../../../core/services/toast.service';
import { Treatment } from '../../../core/models/stock.model';
import { PrescriptionEditorComponent } from '../../../shared/components/prescription/prescription-editor.component';
import { IconComponent } from '../../../shared/ui/icon.component';
import { ModalComponent } from '../../../shared/ui/modal.component';

const STATUS_PILL: Record<InsuranceFormStatus, string> = {
  TO_PRINT: 'pill-attention', PRINTED: 'pill-idle', HANDED_OVER: 'pill-ok', VOID: 'pill-critical',
};

/** An act as the manual form holds it. */
export interface ActDraft {
  treatmentId: string;
  code: string;
  label: string;
  teeth: string;
  amount: number | null;
}

const blankAct = (): ActDraft => ({ treatmentId: '', code: '', label: '', teeth: '', amount: null });

/** The acts worth sending: one needs a catalogue treatment, a code or a label. */
export function actLines(acts: readonly ActDraft[]): InsuranceFormLineInput[] {
  return acts
    .filter(a => a.treatmentId || a.code.trim() || a.label.trim())
    .map(a => ({
      treatmentId: a.treatmentId || undefined,
      code: a.code.trim() || undefined,
      label: a.label.trim() || undefined,
      teeth: a.teeth.trim() || undefined,
      amount: a.amount === null || (a.amount as unknown) === '' ? undefined : Number(a.amount),
    }));
}

/**
 * The patient's paperwork: the care forms filled for their insurer, and their ordonnances.
 *
 * The front desk sees the forms (they print them, have them stamped, hand them over); the
 * clinical team also sees the prescriptions. Above the forms, what the next one would be
 * filled on and what the record still lacks for it, so a missing immatriculation is fixed
 * in the record before it is discovered at the insurer's counter.
 */
@Component({
  selector: 'app-patient-documents',
  standalone: true,
  imports: [DatePipe, DecimalPipe, FormsModule, RouterLink, TranslateModule, IconComponent, ModalComponent, PrescriptionEditorComponent],
  template: `
    <div class="space-y-6">
      @if (canForms()) {
        <section class="card p-4" aria-labelledby="ins-title">
          <header class="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 id="ins-title" class="section-title !mb-0">{{ 'INSURANCE.TITLE' | translate }}</h2>
              @if (preview(); as p) {
                <p class="text-sm text-ink-600">
                  {{ p.insurerName ? p.insurerName + ' · ' : '' }}{{ p.formName }}
                  @if (!p.official) { <span class="pill pill-idle ms-1">{{ 'INSURANCE.GENERIC' | translate }}</span> }
                  @if (p.singleUse) { <span class="pill pill-attention ms-1">{{ 'INSURANCE.SINGLE_USE' | translate }}</span> }
                </p>
              }
            </div>
            @if (canWriteForms()) {
              <button type="button" class="btn btn-primary btn-sm" (click)="openNewForm()"><app-icon name="plus" [size]="14" /> {{ 'INSURANCE.NEW' | translate }}</button>
            }
          </header>

          @if (preview()?.missing?.length) {
            <div class="mb-3 rounded-lg border border-attention-200 bg-attention-50 p-3 text-sm" role="note">
              <span class="font-semibold">{{ 'INSURANCE.MISSING_TITLE' | translate }}</span>
              @for (m of preview()!.missing; track m) { <span class="pill pill-attention ms-1">{{ 'INSURANCE.MISSING.' + m | translate }}</span> }
              <a class="ms-2 underline" [routerLink]="['/patients', patientId(), 'edit']">{{ 'INSURANCE.COMPLETE_RECORD' | translate }}</a>
            </div>
          }

          @if (forms().length === 0) {
            <p class="text-sm text-ink-500">{{ 'INSURANCE.NONE_YET' | translate }}</p>
          } @else {
            <ul class="divide-y divide-ink-100">
              @for (f of forms(); track f.id) {
                <li class="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                  <div class="min-w-[14rem] flex-1">
                    <p class="font-semibold text-ink-900">
                      {{ ('INSURANCE.PURPOSE.' + f.purpose) | translate }} · {{ f.number }}
                      <span class="pill {{ pill(f.status) }} ms-1">{{ ('INSURANCE.STATUS.' + f.status) | translate }}</span>
                    </p>
                    <p class="text-sm text-ink-600">
                      {{ f.careDate | date: 'dd/MM/yyyy' }} · {{ f.insurerName || ('INSURANCE.NO_INSURER' | translate) }} · {{ 'INSURANCE.ACTS' | translate: { count: f.lines.length } }}
                      @if (f.total > 0) { · {{ f.total | number: '1.2-2' }} MAD }
                    </p>
                    <p class="truncate text-xs text-ink-500">{{ actsText(f) }}</p>
                    @if (f.missing.length && f.status === 'TO_PRINT') {
                      <p class="text-xs text-attention-800">{{ 'INSURANCE.MISSING_TITLE' | translate }}
                        @for (m of f.missing; track m) { {{ ('INSURANCE.MISSING.' + m) | translate }}{{ $last ? '' : ',' }} }
                      </p>
                    }
                  </div>
                  <div class="flex flex-wrap gap-1">
                    <button type="button" class="btn btn-secondary btn-sm" (click)="openForm(f)"><app-icon name="eye" [size]="14" /> {{ 'INSURANCE.OPEN' | translate }}</button>
                    @if (f.formCode !== 'generic') {
                      <button type="button" class="btn btn-ghost btn-sm" (click)="openForm(f, true)" [title]="'INSURANCE.OVERLAY_HINT' | translate">{{ 'INSURANCE.OVERLAY' | translate }}</button>
                    }
                    @if (canWriteForms() && f.status !== 'VOID') {
                      @if (!f.taskId) {
                        <button type="button" class="btn btn-ghost btn-sm" (click)="act(f, 'send')"><app-icon name="send" [size]="14" /> {{ 'INSURANCE.SEND' | translate }}</button>
                      }
                      @if (f.status === 'TO_PRINT') {
                        <button type="button" class="btn btn-ghost btn-sm" (click)="act(f, 'refresh')" [title]="'INSURANCE.REFRESH_HINT' | translate"><app-icon name="refresh" [size]="14" /> {{ 'INSURANCE.REFRESH' | translate }}</button>
                        <button type="button" class="btn btn-ghost btn-sm" (click)="act(f, 'printed')">{{ 'INSURANCE.MARK_PRINTED' | translate }}</button>
                      }
                      @if (f.status !== 'HANDED_OVER') {
                        <button type="button" class="btn btn-ghost btn-sm" (click)="act(f, 'handed-over')"><app-icon name="check" [size]="14" /> {{ 'INSURANCE.MARK_HANDED' | translate }}</button>
                      }
                      <button type="button" class="btn btn-ghost btn-sm text-critical-700" (click)="act(f, 'void')">{{ 'INSURANCE.VOID' | translate }}</button>
                    }
                  </div>
                </li>
              }
            </ul>
          }
        </section>
      }

      @if (canPrescriptions()) {
        <section class="card p-4" aria-labelledby="rx-title">
          <header class="mb-3 flex flex-wrap items-start justify-between gap-2">
            <h2 id="rx-title" class="section-title !mb-0">{{ 'RX.TITLE' | translate }}</h2>
            @if (canWritePrescriptions()) {
              <button type="button" class="btn btn-primary btn-sm" (click)="writing.set(true)"><app-icon name="plus" [size]="14" /> {{ 'RX.NEW' | translate }}</button>
            }
          </header>
          @if (prescriptions().length === 0) {
            <p class="text-sm text-ink-500">{{ 'RX.EMPTY' | translate }}</p>
          } @else {
            <ul class="divide-y divide-ink-100">
              @for (rx of prescriptions(); track rx.id) {
                <li class="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                  <div class="min-w-[14rem] flex-1">
                    <p class="font-semibold text-ink-900" [class.line-through]="rx.status === 'VOID'">
                      {{ rx.number }} · {{ rx.issuedAt | date: 'dd/MM/yyyy' }}
                      @if (rx.status === 'VOID') { <span class="pill pill-critical ms-1">{{ 'RX.VOID' | translate }}</span> }
                      @if (rx.warnings.length) { <span class="pill pill-attention ms-1" [title]="warningText(rx)">{{ 'RX.ALLERGY_OVERRIDDEN' | translate }}</span> }
                    </p>
                    <p class="truncate text-sm text-ink-600">{{ drugsText(rx) }}</p>
                    @if (rx.practitionerName) { <p class="text-xs text-ink-500">{{ rx.practitionerName }}</p> }
                  </div>
                  <div class="flex gap-1">
                    <button type="button" class="btn btn-secondary btn-sm" (click)="openPrescription(rx)"><app-icon name="eye" [size]="14" /> {{ 'RX.OPEN' | translate }}</button>
                    @if (canWritePrescriptions() && rx.status !== 'VOID') {
                      <button type="button" class="btn btn-ghost btn-sm text-critical-700" (click)="voidPrescription(rx)">{{ 'RX.VOID_ACTION' | translate }}</button>
                    }
                  </div>
                </li>
              }
            </ul>
          }
        </section>

        <app-prescription-editor [open]="writing()" [patientId]="patientId()" [patientName]="patientName()"
          (closed)="writing.set(false)" (issued)="loadPrescriptions()" />
      }
    </div>

    <app-modal [open]="newForm()" [title]="'INSURANCE.NEW' | translate" size="lg" [dismissable]="!busy()" (closed)="newForm.set(false)">
      <form id="ins-form" class="space-y-4" (ngSubmit)="createForm()">
        <div class="grid gap-4 sm:grid-cols-2">
          <label class="field">
            <span class="label">{{ 'INSURANCE.PURPOSE_LABEL' | translate }}</span>
            <select class="select" name="purpose" [ngModel]="purpose()" (ngModelChange)="purpose.set($event)">
              <option value="EXECUTION">{{ 'INSURANCE.PURPOSE.EXECUTION' | translate }}</option>
              <option value="PRIOR_AGREEMENT">{{ 'INSURANCE.PURPOSE.PRIOR_AGREEMENT' | translate }}</option>
            </select>
          </label>
          <label class="field">
            <span class="label">{{ 'INSURANCE.CARE_DATE' | translate }}</span>
            <input class="input" type="date" name="careDate" [ngModel]="careDate()" (ngModelChange)="careDate.set($event)" />
          </label>
        </div>

        @for (a of acts(); track $index; let i = $index) {
          <fieldset class="rounded-lg border border-ink-200 p-3">
            <legend class="px-1 text-xs font-semibold text-ink-500">{{ 'INSURANCE.ACT_N' | translate: { n: i + 1 } }}</legend>
            <div class="grid gap-2 sm:grid-cols-6">
              <select class="select sm:col-span-6" [name]="'treatment' + i" [ngModel]="a.treatmentId" (ngModelChange)="pickTreatment(i, $event)" [attr.aria-label]="'INSURANCE.FROM_CATALOG' | translate">
                <option value="">{{ 'INSURANCE.FROM_CATALOG' | translate }}</option>
                @for (t of catalog(); track t.id) { <option [value]="t.id">{{ t.name }}{{ t.actCode ? ' — ' + t.actCode : '' }}</option> }
              </select>
              <input class="input sm:col-span-1" [name]="'code' + i" [placeholder]="'INSURANCE.CODE' | translate" maxlength="30" [ngModel]="a.code" (ngModelChange)="setAct(i, 'code', $event)" [attr.aria-label]="'INSURANCE.CODE' | translate" />
              <input class="input sm:col-span-3" [name]="'label' + i" [placeholder]="'INSURANCE.LABEL' | translate" maxlength="200" [ngModel]="a.label" (ngModelChange)="setAct(i, 'label', $event)" [attr.aria-label]="'INSURANCE.LABEL' | translate" />
              <input class="input sm:col-span-1" [name]="'teeth' + i" [placeholder]="'INSURANCE.TEETH' | translate" maxlength="100" [ngModel]="a.teeth" (ngModelChange)="setAct(i, 'teeth', $event)" [attr.aria-label]="'INSURANCE.TEETH' | translate" />
              <input class="input sm:col-span-1" type="number" min="0" [name]="'amount' + i" [placeholder]="'INSURANCE.AMOUNT' | translate" [ngModel]="a.amount" (ngModelChange)="setAct(i, 'amount', $event)" [attr.aria-label]="'INSURANCE.AMOUNT' | translate" />
            </div>
            <button type="button" class="btn btn-ghost btn-sm mt-2 text-critical-700" (click)="removeAct(i)" [disabled]="acts().length === 1"><app-icon name="trash" [size]="14" /> {{ 'INSURANCE.REMOVE_ACT' | translate }}</button>
          </fieldset>
        }
        <button type="button" class="btn btn-secondary btn-sm" (click)="addAct()" [disabled]="acts().length >= 30"><app-icon name="plus" [size]="14" /> {{ 'INSURANCE.ADD_ACT' | translate }}</button>

        <label class="flex items-center gap-2">
          <input type="checkbox" name="send" [ngModel]="send()" (ngModelChange)="send.set($event)" />
          <span>{{ 'INSURANCE.SEND_ON_CREATE' | translate }}</span>
        </label>
      </form>
      <div modal-footer>
        <button type="button" class="btn btn-secondary" (click)="newForm.set(false)" [disabled]="busy()">{{ 'COMMON.CANCEL' | translate }}</button>
        <button type="submit" form="ins-form" class="btn btn-primary" [disabled]="busy() || !lines().length">{{ 'INSURANCE.CREATE' | translate }}</button>
      </div>
    </app-modal>
  `,
})
export class PatientDocumentsComponent {
  private readonly forms$ = inject(InsuranceFormsApi);
  private readonly rx$ = inject(PrescriptionsApi);
  private readonly stock = inject(StockService);
  private readonly permissions = inject(PermissionService);
  private readonly errors = inject(ApiErrors);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly translate = inject(TranslateService);

  readonly patientId = input.required<string>();
  readonly patientName = input('');

  protected readonly canForms = computed(() => this.permissions.can('BILLING_READ'));
  protected readonly canWriteForms = computed(() => this.permissions.can('BILLING_WRITE'));
  protected readonly canPrescriptions = computed(() => this.permissions.can('CLINICAL_READ'));
  protected readonly canWritePrescriptions = computed(() => this.permissions.can('CLINICAL_WRITE'));

  protected readonly preview = signal<InsuranceFormPreview | null>(null);
  protected readonly forms = signal<InsuranceForm[]>([]);
  protected readonly prescriptions = signal<Prescription[]>([]);
  protected readonly writing = signal(false);

  protected readonly newForm = signal(false);
  protected readonly busy = signal(false);
  protected readonly purpose = signal<InsuranceFormPurpose>('EXECUTION');
  protected readonly careDate = signal(today());
  protected readonly acts = signal<ActDraft[]>([blankAct()]);
  protected readonly send = signal(true);
  protected readonly catalog = signal<Treatment[]>([]);
  protected readonly lines = computed(() => actLines(this.acts()));

  constructor() {
    effect(() => {
      const id = this.patientId();
      untracked(() => {
        if (this.canForms()) void this.loadForms(id);
        if (this.canPrescriptions()) void this.loadPrescriptions();
      });
    });
  }

  protected pill(status: InsuranceFormStatus): string {
    return STATUS_PILL[status];
  }

  protected actsText(f: InsuranceForm): string {
    return f.lines.map(l => [l.code, l.label, l.teeth ? `(${l.teeth})` : null].filter(Boolean).join(' ')).join(' · ');
  }

  protected drugsText(rx: Prescription): string {
    return rx.lines.map(l => l.drug).join(' · ');
  }

  protected warningText(rx: Prescription): string {
    return rx.warnings.map(w => `${w.drug} / ${w.allergy}`).join(', ');
  }

  async loadForms(patientId = this.patientId()): Promise<void> {
    try {
      const [preview, forms] = await Promise.all([this.forms$.preview(patientId), this.forms$.list({ patientId })]);
      this.preview.set(preview);
      this.forms.set(forms);
    } catch (e) {
      this.errors.report(e);
    }
  }

  async loadPrescriptions(): Promise<void> {
    try {
      this.prescriptions.set(await this.rx$.list(this.patientId()));
    } catch (e) {
      this.errors.report(e);
    }
  }

  protected async openForm(f: InsuranceForm, overlay = false): Promise<void> {
    try {
      await this.forms$.open(f.id, overlay);
    } catch (e) {
      this.errors.report(e);
    }
  }

  protected async openPrescription(rx: Prescription): Promise<void> {
    try {
      await this.rx$.open(rx.id);
    } catch (e) {
      this.errors.report(e);
    }
  }

  protected async act(f: InsuranceForm, action: 'send' | 'printed' | 'handed-over' | 'refresh' | 'void'): Promise<void> {
    if (action === 'void' && !(await this.confirm.confirm(this.translate.instant('INSURANCE.VOID_CONFIRM', { number: f.number }),
      { title: this.translate.instant('INSURANCE.VOID_TITLE'), danger: true }))) {
      return;
    }
    try {
      const updated = action === 'send' ? await this.forms$.send(f.id) : await this.forms$.action(f.id, action);
      this.forms.update(list => list.map(x => (x.id === updated.id ? updated : x)));
      if (action === 'send') this.toast.success(this.translate.instant('INSURANCE.SENT'));
      if (action === 'refresh') void this.loadForms();
    } catch (e) {
      this.errors.report(e);
    }
  }

  protected async voidPrescription(rx: Prescription): Promise<void> {
    if (!(await this.confirm.confirm(this.translate.instant('RX.VOID_CONFIRM', { number: rx.number }),
      { title: this.translate.instant('RX.VOID_TITLE'), danger: true }))) {
      return;
    }
    try {
      const updated = await this.rx$.void(rx.id);
      this.prescriptions.update(list => list.map(x => (x.id === updated.id ? updated : x)));
    } catch (e) {
      this.errors.report(e);
    }
  }

  protected openNewForm(): void {
    this.purpose.set('EXECUTION');
    this.careDate.set(today());
    this.acts.set([blankAct()]);
    this.send.set(true);
    this.newForm.set(true);
    if (!this.catalog().length) {
      this.stock.getTreatments().subscribe({ next: list => this.catalog.set(list), error: () => undefined });
    }
  }

  protected pickTreatment(index: number, id: string): void {
    const t = this.catalog().find(x => x.id === id);
    this.acts.update(list => list.map((a, i) => (i !== index ? a : {
      ...a, treatmentId: id, code: t?.actCode ?? a.code, label: a.label || t?.name || '', amount: a.amount ?? t?.basePrice ?? null,
    })));
  }

  protected setAct(index: number, field: keyof ActDraft, value: string | number | null): void {
    this.acts.update(list => list.map((a, i) => (i === index ? { ...a, [field]: value } : a)));
  }

  protected addAct(): void {
    this.acts.update(list => [...list, blankAct()]);
  }

  protected removeAct(index: number): void {
    this.acts.update(list => list.filter((_, i) => i !== index));
  }

  protected async createForm(): Promise<void> {
    if (this.busy() || !this.lines().length) return;
    this.busy.set(true);
    try {
      const form = await this.forms$.create({
        patientId: this.patientId(), purpose: this.purpose(), careDate: this.careDate() || undefined,
        lines: this.lines(), send: this.send(),
      });
      this.newForm.set(false);
      this.toast.success(this.translate.instant(this.send() ? 'INSURANCE.CREATED_SENT' : 'INSURANCE.CREATED', { number: form.number }));
      await this.loadForms();
      await this.forms$.open(form.id);
    } catch (e) {
      this.errors.report(e);
    } finally {
      this.busy.set(false);
    }
  }
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
