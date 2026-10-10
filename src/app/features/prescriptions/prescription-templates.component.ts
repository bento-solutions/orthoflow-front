import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ApiErrors } from '../../core/services/api-error.service';
import { ConfirmDialogService } from '../../core/services/confirm-dialog.service';
import {
  PRESCRIPTION_CATEGORIES, PrescriptionCategory, PrescriptionLibraryEntry, PrescriptionTemplate, PrescriptionsApi,
} from '../../core/services/prescriptions-api.service';
import { ToastService } from '../../core/services/toast.service';
import { loadable } from '../../core/utils/loadable';
import { LineDraft, completeLines, incompleteLines } from '../../shared/components/prescription/prescription-editor.component';
import { IconComponent } from '../../shared/ui/icon.component';
import { ModalComponent } from '../../shared/ui/modal.component';

interface TemplateForm {
  id: string | null;
  name: string;
  category: PrescriptionCategory;
  lines: LineDraft[];
  advice: string;
  active: boolean;
}

const blankLine = (): LineDraft => ({ drug: '', form: '', dci: '', posology: '' });

/**
 * The clinic's prescription templates, and the reference library they can start from.
 *
 * The library (ordonnance.ma) is read-only reference: adopting an entry copies it into the
 * clinic's templates flagged "to review", and it stays flagged until a doctor validates or
 * edits it. Orthodontic prescriptions are not in the library at all; they are the clinic's
 * to write here.
 */
@Component({
  selector: 'app-prescription-templates',
  standalone: true,
  imports: [DatePipe, FormsModule, TranslateModule, IconComponent, ModalComponent],
  template: `
    <div class="anim-rise">
      <header class="page-head">
        <div>
          <h1 class="page-title">{{ 'RX.TEMPLATES_TITLE' | translate }}</h1>
          <p class="page-sub">{{ 'RX.TEMPLATES_SUB' | translate }}</p>
        </div>
        <div class="page-actions">
          <button type="button" class="btn btn-primary" (click)="openNew()"><app-icon name="plus" [size]="16" /> {{ 'RX.NEW_TEMPLATE' | translate }}</button>
        </div>
      </header>

      <section class="mb-8">
        <h2 class="section-title">{{ 'RX.CLINIC_TEMPLATES' | translate }}</h2>
        @if (templates.data().length === 0 && !templates.loading()) {
          <p class="card p-6 text-center text-ink-500">{{ 'RX.NO_TEMPLATES' | translate }}</p>
        } @else {
          <ul class="card divide-y divide-ink-100">
            @for (t of templates.data(); track t.id) {
              <li class="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3">
                <div class="min-w-0 flex-1">
                  <p class="font-semibold text-ink-900" [class.text-ink-500]="!t.active">
                    {{ t.name }}
                    <span class="pill pill-idle ms-1">{{ ('RX.CAT.' + t.category) | translate }}</span>
                    @if (!t.reviewed) { <span class="pill pill-attention ms-1">{{ 'RX.TO_REVIEW' | translate }}</span> }
                    @if (!t.active) { <span class="pill pill-idle ms-1">{{ 'RX.INACTIVE' | translate }}</span> }
                  </p>
                  <p class="truncate text-sm text-ink-600">{{ drugs(t.lines) }}</p>
                  @if (t.reviewed && t.reviewedByName) {
                    <p class="text-xs text-ink-500">{{ 'RX.REVIEWED_BY' | translate: { name: t.reviewedByName, date: (t.reviewedAt | date: 'dd/MM/yyyy') } }}</p>
                  }
                </div>
                <div class="flex flex-wrap gap-1">
                  @if (!t.reviewed) {
                    <button type="button" class="btn btn-secondary btn-sm" (click)="review(t)"><app-icon name="check" [size]="14" /> {{ 'RX.VALIDATE' | translate }}</button>
                  }
                  <button type="button" class="btn btn-ghost btn-sm" (click)="openEdit(t)"><app-icon name="edit" [size]="14" /> {{ 'COMMON.EDIT' | translate }}</button>
                  <button type="button" class="btn btn-ghost btn-sm text-critical-700" (click)="remove(t)"><app-icon name="trash" [size]="14" /> {{ 'COMMON.DELETE' | translate }}</button>
                </div>
              </li>
            }
          </ul>
        }
      </section>

      <section>
        <h2 class="section-title">{{ 'RX.LIBRARY' | translate }}</h2>
        <p class="mb-3 text-sm text-ink-600">{{ 'RX.LIBRARY_EXPLAINED' | translate }}</p>
        <ul class="card divide-y divide-ink-100">
          @for (e of library.data(); track e.code) {
            <li class="px-4 py-3">
              <div class="flex flex-wrap items-start gap-x-4 gap-y-2">
                <div class="min-w-0 flex-1">
                  <p class="font-semibold text-ink-900">{{ e.name }} <span class="pill pill-idle ms-1">{{ ('RX.CAT.' + e.category) | translate }}</span></p>
                  <p class="text-sm text-ink-600">{{ drugs(e.lines) }}</p>
                </div>
                <div class="flex gap-1">
                  <button type="button" class="btn btn-ghost btn-sm" (click)="expanded.set(expanded() === e.code ? null : e.code)" [attr.aria-expanded]="expanded() === e.code">
                    {{ (expanded() === e.code ? 'RX.HIDE' : 'RX.DETAILS') | translate }}
                  </button>
                  @if (e.adopted) {
                    <span class="pill pill-ok">{{ 'RX.ADOPTED' | translate }}</span>
                  } @else {
                    <button type="button" class="btn btn-secondary btn-sm" (click)="adopt(e)"><app-icon name="plus" [size]="14" /> {{ 'RX.ADOPT' | translate }}</button>
                  }
                </div>
              </div>
              @if (expanded() === e.code) {
                <div class="mt-2 space-y-1 rounded-lg bg-ink-50 p-3 text-sm">
                  @for (l of e.lines; track $index) {
                    <p><b>{{ l.drug }}</b>{{ l.form ? ' — ' + l.form : '' }}{{ l.dci ? ' (' + l.dci + ')' : '' }} : {{ l.posology }}</p>
                  }
                  @if (e.advice) { <p><b>{{ 'RX.ADVICE' | translate }}</b> {{ e.advice }}</p> }
                  @if (e.warningSigns) { <p><b>{{ 'RX.WARNING_SIGNS' | translate }}</b> {{ e.warningSigns }}</p> }
                  @if (e.alternative) { <p><b>{{ 'RX.ALTERNATIVE' | translate }}</b> {{ e.alternative }}</p> }
                  <a class="text-xs underline" [href]="e.sourceUrl" target="_blank" rel="noopener">{{ 'RX.SOURCE' | translate }}</a>
                </div>
              }
            </li>
          }
        </ul>
      </section>
    </div>

    <app-modal [open]="form() !== null" [title]="(form()?.id ? 'RX.EDIT_TEMPLATE' : 'RX.NEW_TEMPLATE') | translate" size="lg" [dismissable]="!busy()" (closed)="form.set(null)">
      @if (form(); as f) {
        <form id="rx-template" class="space-y-4" (ngSubmit)="save()">
          <div class="grid gap-4 sm:grid-cols-3">
            <label class="field sm:col-span-2"><span class="label label-required">{{ 'RX.TEMPLATE_NAME' | translate }}</span>
              <input class="input" name="name" required maxlength="160" [ngModel]="f.name" (ngModelChange)="patch({ name: $event })" /></label>
            <label class="field"><span class="label">{{ 'RX.CATEGORY' | translate }}</span>
              <select class="select" name="category" [ngModel]="f.category" (ngModelChange)="patch({ category: $event })">
                @for (c of categories; track c) { <option [value]="c">{{ ('RX.CAT.' + c) | translate }}</option> }
              </select></label>
          </div>
          @for (line of f.lines; track $index; let i = $index) {
            <fieldset class="rounded-lg border border-ink-200 p-3">
              <legend class="px-1 text-xs font-semibold text-ink-500">{{ 'RX.DRUG_N' | translate: { n: i + 1 } }}</legend>
              <div class="grid gap-2 sm:grid-cols-3">
                <input class="input sm:col-span-2" [name]="'drug' + i" [placeholder]="'RX.DRUG' | translate" [attr.aria-label]="'RX.DRUG' | translate" maxlength="160" [ngModel]="line.drug" (ngModelChange)="setLine(i, 'drug', $event)" />
                <input class="input" [name]="'form' + i" [placeholder]="'RX.FORM' | translate" [attr.aria-label]="'RX.FORM' | translate" maxlength="80" [ngModel]="line.form" (ngModelChange)="setLine(i, 'form', $event)" />
                <input class="input sm:col-span-3" [name]="'dci' + i" [placeholder]="'RX.DCI' | translate" [attr.aria-label]="'RX.DCI' | translate" maxlength="160" [ngModel]="line.dci" (ngModelChange)="setLine(i, 'dci', $event)" />
                <textarea class="textarea sm:col-span-3" rows="2" [name]="'posology' + i" [placeholder]="'RX.POSOLOGY' | translate" [attr.aria-label]="'RX.POSOLOGY' | translate" maxlength="600" [ngModel]="line.posology" (ngModelChange)="setLine(i, 'posology', $event)"></textarea>
              </div>
              <button type="button" class="btn btn-ghost btn-sm mt-2 text-critical-700" (click)="removeLine(i)" [disabled]="f.lines.length === 1"><app-icon name="trash" [size]="14" /> {{ 'RX.REMOVE_DRUG' | translate }}</button>
            </fieldset>
          }
          <button type="button" class="btn btn-secondary btn-sm" (click)="addLine()" [disabled]="f.lines.length >= 20"><app-icon name="plus" [size]="14" /> {{ 'RX.ADD_DRUG' | translate }}</button>
          <label class="field"><span class="label">{{ 'RX.ADVICE' | translate }}</span>
            <textarea class="textarea" rows="3" name="advice" maxlength="4000" [ngModel]="f.advice" (ngModelChange)="patch({ advice: $event })"></textarea></label>
          <label class="flex items-center gap-2"><input type="checkbox" name="active" [ngModel]="f.active" (ngModelChange)="patch({ active: $event })" /> {{ 'RX.ACTIVE' | translate }}</label>
          <p class="text-xs text-ink-500">{{ 'RX.SAVE_REVIEWS' | translate }}</p>
        </form>
      }
      <div modal-footer>
        <button type="button" class="btn btn-secondary" (click)="form.set(null)" [disabled]="busy()">{{ 'COMMON.CANCEL' | translate }}</button>
        <button type="submit" form="rx-template" class="btn btn-primary" [disabled]="busy() || !canSave()">{{ 'COMMON.SAVE' | translate }}</button>
      </div>
    </app-modal>
  `,
})
export class PrescriptionTemplatesComponent {
  private readonly api = inject(PrescriptionsApi);
  private readonly errors = inject(ApiErrors);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);

  protected readonly categories = PRESCRIPTION_CATEGORIES;
  protected readonly templates = loadable<PrescriptionTemplate[]>([]);
  protected readonly library = loadable<PrescriptionLibraryEntry[]>([]);
  protected readonly expanded = signal<string | null>(null);
  protected readonly form = signal<TemplateForm | null>(null);
  protected readonly busy = signal(false);

  constructor() {
    void this.reload();
  }

  private reload(): Promise<unknown> {
    return Promise.all([this.templates.load(() => this.api.templates(true)), this.library.load(() => this.api.library())]);
  }

  protected drugs(lines: { drug: string }[]): string {
    return lines.map(l => l.drug).join(' · ');
  }

  protected canSave(): boolean {
    const f = this.form();
    return !!f && !!f.name.trim() && incompleteLines(f.lines) === 0 && completeLines(f.lines).length > 0;
  }

  protected openNew(): void {
    this.form.set({ id: null, name: '', category: 'ORTHO', lines: [blankLine()], advice: '', active: true });
  }

  protected openEdit(t: PrescriptionTemplate): void {
    this.form.set({
      id: t.id, name: t.name, category: t.category, advice: t.advice ?? '', active: t.active,
      lines: t.lines.map(l => ({ drug: l.drug ?? '', form: l.form ?? '', dci: l.dci ?? '', posology: l.posology ?? '' })),
    });
  }

  protected patch(change: Partial<TemplateForm>): void {
    this.form.update(f => (f ? { ...f, ...change } : f));
  }

  protected setLine(index: number, field: keyof LineDraft, value: string): void {
    this.form.update(f => (f ? { ...f, lines: f.lines.map((l, i) => (i === index ? { ...l, [field]: value } : l)) } : f));
  }

  protected addLine(): void {
    this.form.update(f => (f ? { ...f, lines: [...f.lines, blankLine()] } : f));
  }

  protected removeLine(index: number): void {
    this.form.update(f => (f ? { ...f, lines: f.lines.filter((_, i) => i !== index) } : f));
  }

  protected async save(): Promise<void> {
    const f = this.form();
    if (!f || !this.canSave() || this.busy()) return;
    this.busy.set(true);
    try {
      const body = { name: f.name.trim(), category: f.category, lines: completeLines(f.lines), advice: f.advice.trim() || undefined, active: f.active };
      if (f.id) await this.api.updateTemplate(f.id, body);
      else await this.api.createTemplate(body);
      this.form.set(null);
      await this.reload();
    } catch (e) {
      this.errors.report(e);
    } finally {
      this.busy.set(false);
    }
  }

  protected async review(t: PrescriptionTemplate): Promise<void> {
    if (!(await this.confirm.confirm(this.translate.instant('RX.VALIDATE_CONFIRM', { name: t.name }),
      { title: this.translate.instant('RX.VALIDATE') }))) {
      return;
    }
    try {
      await this.api.reviewTemplate(t.id);
      await this.templates.load(() => this.api.templates(true));
    } catch (e) {
      this.errors.report(e);
    }
  }

  protected async remove(t: PrescriptionTemplate): Promise<void> {
    if (!(await this.confirm.confirm(this.translate.instant('RX.DELETE_CONFIRM', { name: t.name }),
      { title: this.translate.instant('COMMON.DELETE'), danger: true }))) {
      return;
    }
    try {
      await this.api.deleteTemplate(t.id);
      await this.reload();
    } catch (e) {
      this.errors.report(e);
    }
  }

  protected async adopt(e: PrescriptionLibraryEntry): Promise<void> {
    try {
      const t = await this.api.adopt(e.code);
      this.toast.success(this.translate.instant('RX.ADOPTED_TOAST', { name: t.name }));
      await this.reload();
    } catch (err) {
      this.errors.report(err);
    }
  }
}
