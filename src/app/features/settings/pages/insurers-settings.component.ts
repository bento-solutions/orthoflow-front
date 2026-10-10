import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ApiErrors } from '../../../core/services/api-error.service';
import { InsuranceFormLayout, InsuranceFormsApi } from '../../../core/services/insurance-forms-api.service';
import { loadable } from '../../../core/utils/loadable';
import { ModalComponent } from '../../../shared/ui/modal.component';
import { Insurer, PatientDirectoryApi } from '../../patients/patient-directory-api.service';

/** The form a code gets with no override: the layout that lists the code, else the generic statement. */
export function defaultLayout(code: string, layouts: readonly InsuranceFormLayout[]): InsuranceFormLayout | null {
  const upper = code.trim().toUpperCase();
  return layouts.find(l => l.insurerCodes.includes(upper)) ?? null;
}

interface InsurerForm {
  id: string | null;
  code: string;
  name: string;
  kind: 'PUBLIC' | 'PRIVATE';
  active: boolean;
  /** '' = the form OrthoFlow knows for the code; 'generic' = the statement of acts; else a layout code. */
  formCode: string;
}

/**
 * The insurers a patient can be attached to, and the paper form each one's patients need.
 * By default an insurer gets the form OrthoFlow knows for its code (CNOPS and the public
 * mutuals the CNOPS sheet, CNSS its 610-1-04); a clinic can point one elsewhere, or to the
 * statement of acts when its own sheet is not one OrthoFlow fills.
 */
@Component({
  selector: 'app-insurers-settings',
  standalone: true,
  imports: [FormsModule, TranslateModule, ModalComponent],
  template: `
    <section class="card">
      <div class="card-head">
        <div>
          <h2 class="text-lg font-bold text-ink-900">{{ 'SET.INSURERS.TITLE' | translate }}</h2>
          <p class="text-sm text-ink-500">{{ 'SET.INSURERS.HINT' | translate }}</p>
        </div>
        <button type="button" class="btn btn-primary btn-sm" (click)="openNew()">{{ 'SET.INSURERS.ADD' | translate }}</button>
      </div>
      <ul class="divide-y divide-ink-100">
        @for (i of insurers.data(); track i.id) {
          <li class="flex flex-wrap items-center gap-4 px-5 py-3">
            <div class="min-w-0 flex-1">
              <p class="font-semibold text-ink-900" [class.text-ink-500]="!i.active">{{ i.name }} <span class="mono text-2xs text-ink-400">{{ i.code }}</span>
                @if (!i.active) { <span class="pill pill-idle ms-1">{{ 'SET.INSURERS.INACTIVE' | translate }}</span> }</p>
              <p class="text-sm text-ink-600">{{ formLabel(i) }}</p>
            </div>
            <button type="button" class="btn btn-secondary btn-sm shrink-0" (click)="openEdit(i)">{{ 'COMMON.EDIT' | translate }}</button>
          </li>
        }
      </ul>
    </section>

    <app-modal [open]="form() !== null" [title]="(form()?.id ? 'SET.INSURERS.EDIT' : 'SET.INSURERS.ADD') | translate" size="md" [dismissable]="!busy()" (closed)="form.set(null)">
      @if (form(); as f) {
        <form id="insurer-form" class="space-y-4" (ngSubmit)="save()">
          <div class="grid gap-4 sm:grid-cols-3">
            <label class="field"><span class="label label-required">{{ 'SET.INSURERS.CODE' | translate }}</span>
              <input class="input" name="code" required maxlength="30" [disabled]="!!f.id" [ngModel]="f.code" (ngModelChange)="patch({ code: $event })" /></label>
            <label class="field sm:col-span-2"><span class="label label-required">{{ 'SET.INSURERS.NAME' | translate }}</span>
              <input class="input" name="name" required maxlength="150" [ngModel]="f.name" (ngModelChange)="patch({ name: $event })" /></label>
          </div>
          <label class="field"><span class="label">{{ 'SET.INSURERS.KIND' | translate }}</span>
            <select class="select" name="kind" [ngModel]="f.kind" (ngModelChange)="patch({ kind: $event })">
              <option value="PUBLIC">{{ 'SET.INSURERS.PUBLIC' | translate }}</option>
              <option value="PRIVATE">{{ 'SET.INSURERS.PRIVATE' | translate }}</option>
            </select></label>
          <label class="field"><span class="label">{{ 'SET.INSURERS.FORM' | translate }}</span>
            <select class="select" name="formCode" [ngModel]="f.formCode" (ngModelChange)="patch({ formCode: $event })">
              <option value="">{{ 'SET.INSURERS.FORM_DEFAULT' | translate: { form: defaultName(f.code) } }}</option>
              @for (l of layouts(); track l.code) { <option [value]="l.code">{{ l.name }}</option> }
              <option value="generic">{{ 'SET.INSURERS.FORM_GENERIC' | translate }}</option>
            </select>
            <span class="hint">{{ 'SET.INSURERS.FORM_HINT' | translate }}</span></label>
          <label class="flex items-center gap-2"><input type="checkbox" name="active" [ngModel]="f.active" (ngModelChange)="patch({ active: $event })" /> {{ 'SET.INSURERS.ACTIVE' | translate }}</label>
        </form>
      }
      <div modal-footer>
        <button type="button" class="btn btn-secondary" (click)="form.set(null)" [disabled]="busy()">{{ 'COMMON.CANCEL' | translate }}</button>
        <button type="submit" form="insurer-form" class="btn btn-primary" [disabled]="busy() || !form()?.code?.trim() || !form()?.name?.trim()">{{ 'COMMON.SAVE' | translate }}</button>
      </div>
    </app-modal>
  `,
})
export class InsurersSettingsComponent {
  private readonly directory = inject(PatientDirectoryApi);
  private readonly forms = inject(InsuranceFormsApi);
  private readonly errors = inject(ApiErrors);
  private readonly translate = inject(TranslateService);

  protected readonly insurers = loadable<Insurer[]>([]);
  protected readonly layouts = signal<InsuranceFormLayout[]>([]);
  protected readonly form = signal<InsurerForm | null>(null);
  protected readonly busy = signal(false);

  constructor() {
    void this.insurers.load(() => this.directory.insurers(true));
    this.forms.layouts().then(l => this.layouts.set(l)).catch(e => this.errors.report(e));
  }

  /** What the insurer's patients get, said plainly: the form's name, and whether the clinic chose it. */
  protected formLabel(i: Insurer): string {
    if (i.formCode === 'generic') return this.genericName();
    const chosen = i.formCode ? this.layouts().find(l => l.code === i.formCode) : null;
    return chosen?.name ?? defaultLayout(i.code, this.layouts())?.name ?? this.genericName();
  }

  protected defaultName(code: string): string {
    return defaultLayout(code ?? '', this.layouts())?.name ?? this.genericName();
  }

  private genericName(): string {
    return this.translate.instant('SET.INSURERS.FORM_GENERIC');
  }

  protected openNew(): void {
    this.form.set({ id: null, code: '', name: '', kind: 'PRIVATE', active: true, formCode: '' });
  }

  protected openEdit(i: Insurer): void {
    this.form.set({ id: i.id, code: i.code, name: i.name, kind: i.kind as 'PUBLIC' | 'PRIVATE', active: i.active, formCode: i.formCode ?? '' });
  }

  protected patch(change: Partial<InsurerForm>): void {
    this.form.update(f => (f ? { ...f, ...change } : f));
  }

  protected async save(): Promise<void> {
    const f = this.form();
    if (!f || this.busy()) return;
    this.busy.set(true);
    try {
      // '' clears an override on the server; the code itself never changes once made.
      const body = { code: f.code.trim(), name: f.name.trim(), kind: f.kind, active: f.active, formCode: f.formCode };
      if (f.id) await this.directory.updateInsurer(f.id, body);
      else await this.directory.createInsurer(body);
      this.form.set(null);
      await this.insurers.load(() => this.directory.insurers(true));
    } catch (e) {
      this.errors.report(e);
    } finally {
      this.busy.set(false);
    }
  }
}
