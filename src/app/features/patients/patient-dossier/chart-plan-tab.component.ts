import { Component, computed, inject, input, model, output, signal, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { findingLabel } from '../../../core/clinical/finding-options';
import { StagedFinding } from '../../../core/clinical/tooth-paint';
import { ClinicalNote, Severity, ToothFinding } from '../../../core/models/clinical-record.model';
import { DentalChartState, Patient } from '../../../core/models/patient.model';
import { PatientTreatment } from '../../../core/models/patient-treatment.model';
import { ClinicalRecordService } from '../../../core/services/clinical-record.service';
import { PermissionService } from '../../../core/services/permission.service';
import { ToastService } from '../../../core/services/toast.service';
import { MoneyPipe } from '../../../shared/pipes/money.pipe';
import { EmptyStateComponent } from '../../../shared/ui/empty-state.component';
import { IconComponent } from '../../../shared/ui/icon.component';
import { Dental3dChartComponent } from '../../dental-3d/dental-3d-chart.component';
import { GumStatusComponent } from '../gum-status/gum-status.component';
import { AssignedTreatmentsComponent } from './assigned-treatments.component';
import { reportVisits } from './consultation-report.component';

interface ToothGroup {
  fdi: string;
  findings: ToothFinding[];
}

/**
 * Chart & plan: the one place the chart is edited (P1-1). The chart with its tooth panel, the
 * findings tooth by tooth, the treatment plan with its prices, the treatments assigned, and the
 * gums. A plan a consultation proposed is shown as proposed until a treatment is assigned from it,
 * so the plan, the badge and the summary no longer contradict each other (P1-3).
 */
@Component({
  selector: 'app-chart-plan-tab',
  standalone: true,
  imports: [NgTemplateOutlet, FormsModule, TranslateModule, MoneyPipe, EmptyStateComponent, IconComponent, Dental3dChartComponent, GumStatusComponent, AssignedTreatmentsComponent],
  template: `
    <h2 class="sr-only">{{ 'PATIENTS.DOSSIER.TAB.CHART' | translate }}</h2>
    <div class="cp-chart">
      @if (chart(); as c) {
        @defer (on viewport; prefetch on idle) {
          <app-dental-3d-chart
            [chart]="c"
            [findings]="findings()"
            [treatments]="treatments()"
            [staged]="staged()"
            [focusFdi]="focusFdi()"
            [(selected)]="selected"
            (assignTreatment)="assigned().open(undefined, $event)"
          />
        } @placeholder {
          <div class="cp-placeholder" aria-hidden="true"></div>
        }
      }
    </div>

    <div class="cp-grid">
      <!-- Findings, tooth by tooth -->
      <section class="card p-5" aria-labelledby="cp-findings">
        <header class="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 id="cp-findings" class="text-lg font-bold">{{ 'PATIENTS.DOSSIER.FINDINGS_BY_TOOTH' | translate }}</h3>
          @if (canWrite() && form() !== 'diagnostic') {
            <button type="button" class="btn btn-secondary btn-sm" (click)="openForm('diagnostic')"><app-icon name="plus" [size]="14" /> {{ 'COMMON.ADD' | translate }}</button>
          }
        </header>
        @if (form() === 'diagnostic') { <ng-container [ngTemplateOutlet]="findingForm" /> }
        @if (byTooth().length) {
          <ul class="space-y-2">
            @for (g of byTooth(); track g.fdi) {
              <li class="flex gap-3 rounded-lg border border-ink-200 px-3 py-2">
                <button type="button" class="cp-fdi" (click)="selected.set(g.fdi)" [attr.aria-label]="'DENTAL_3D.ZOOM_TOOTH' | translate: { fdi: g.fdi }">{{ g.fdi }}</button>
                <ul class="min-w-0 flex-1 space-y-1">
                  @for (f of g.findings; track f.id) {
                    <li class="flex flex-wrap items-center justify-between gap-2">
                      <span class="font-semibold text-ink-900">{{ name(f.findingCode) }}
                        @if (f.severity) { <span class="pill pill-attention ms-1">{{ 'PATIENTS.DOSSIER.UI.' + f.severity | translate }}</span> }
                      </span>
                      @if (canWrite()) {
                        <button type="button" class="btn btn-ghost btn-sm" (click)="resolve(f)">
                          <app-icon name="check-circle" [size]="14" /> {{ 'PATIENTS.DOSSIER.UI.MARK_RESOLVED' | translate }}
                        </button>
                      }
                      @if (f.note) { <p class="w-full text-sm text-ink-600">{{ f.note }}</p> }
                    </li>
                  }
                </ul>
              </li>
            }
          </ul>
        } @else if (form() !== 'diagnostic') {
          <app-empty-state icon="tooth" [compact]="true" [title]="'PATIENTS.DOSSIER.NO_DIAGNOSTICS' | translate"
            [text]="'PATIENTS.DOSSIER.EMPTY.FINDINGS' | translate"
            [actionLabel]="canWrite() ? ('PATIENTS.DOSSIER.EMPTY.ADD_FINDING' | translate) : null" (action)="openForm('diagnostic')" />
        }
      </section>

      <!-- The treatment plan, with prices -->
      <section class="card p-5" aria-labelledby="cp-plan">
        <header class="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 id="cp-plan" class="text-lg font-bold">{{ 'PATIENTS.DOSSIER.TREATMENT_PLAN' | translate }}</h3>
          @if (canWrite() && form() !== 'plan') {
            <button type="button" class="btn btn-secondary btn-sm" (click)="openForm('plan')"><app-icon name="plus" [size]="14" /> {{ 'COMMON.ADD' | translate }}</button>
          }
        </header>
        @if (form() === 'plan') { <ng-container [ngTemplateOutlet]="findingForm" /> }

        @if (planned().length) {
          <table class="w-full text-sm">
            <caption class="sr-only">{{ 'PATIENTS.DOSSIER.TREATMENT_PLAN' | translate }}</caption>
            <thead><tr class="text-start text-xs text-ink-500">
              <th scope="col" class="py-1 text-start font-semibold">{{ 'PATIENTS.DOSSIER.UI.TREATMENT_SETUP' | translate }}</th>
              <th scope="col" class="py-1 text-start font-semibold">{{ 'PATIENTS.DOSSIER.UI.ASSIGNED_TEETH' | translate }}</th>
              <th scope="col" class="py-1 text-end font-semibold">{{ 'PATIENTS.DOSSIER.PRICE' | translate }}</th>
            </tr></thead>
            <tbody>
              @for (t of planned(); track t.id) {
                <tr class="border-t border-ink-100">
                  <td class="py-2 font-semibold">{{ t.treatment.name }}</td>
                  <td class="py-2">{{ t.teeth }}</td>
                  <td class="py-2 text-end tnum">{{ t.treatment.basePrice | money }}</td>
                </tr>
              }
            </tbody>
            <tfoot><tr class="border-t border-ink-200 font-bold">
              <td class="py-2" colspan="2">{{ 'PATIENTS.DOSSIER.PLAN_TOTAL' | translate }}</td>
              <td class="py-2 text-end tnum">{{ plannedTotal() | money }}</td>
            </tr></tfoot>
          </table>
        }

        @if (required().length) {
          <h4 class="mb-1 mt-4 text-xs font-bold uppercase tracking-wide text-ink-500">{{ 'PATIENTS.DOSSIER.TO_DO_BY_TOOTH' | translate }}</h4>
          <ul class="space-y-1">
            @for (f of required(); track f.id) {
              <li class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-caution-200 bg-caution-50 px-3 py-1.5">
                <span><b class="me-1">{{ f.fdi }}</b>{{ name(f.findingCode) }}</span>
                @if (canWrite()) {
                  <button type="button" class="btn btn-ghost btn-sm" (click)="resolve(f)"><app-icon name="check" [size]="14" /> {{ 'TOOTH_DETAIL.MARK_TREATED' | translate }}</button>
                }
              </li>
            }
          </ul>
        }

        @if (proposed(); as p) {
          <div class="mt-4 rounded-lg border border-dashed border-ink-300 p-3">
            <p class="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-ink-500">
              {{ 'PATIENTS.DOSSIER.PROPOSED_PLAN' | translate }} <span class="pill pill-idle">{{ 'PATIENTS.DOSSIER.NOT_ACCEPTED' | translate }}</span>
            </p>
            <p class="whitespace-pre-line text-sm text-ink-800">{{ p.content }}</p>
          </div>
        }

        @if (!planned().length && !required().length && !proposed() && form() !== 'plan') {
          <app-empty-state icon="clipboard" [compact]="true" [title]="'PATIENTS.DOSSIER.NO_TREATMENT_PLAN' | translate"
            [text]="'PATIENTS.DOSSIER.EMPTY.PLAN' | translate"
            [actionLabel]="canWrite() ? ('PATIENTS.DOSSIER.UI.ASSIGN_FIRST' | translate) : null" (action)="assigned().open(undefined, selected())" />
        }
      </section>
    </div>

    <app-assigned-treatments class="mt-4 block" [patientId]="patient().id" [treatments]="treatments()" (changed)="treatmentsChanged.emit()" />

    <section class="card mt-4 p-5">
      <app-gum-status [patientId]="patient().id" [patientName]="patient().firstName + ' ' + patient().lastName" [patientBirthDate]="patient().dateOfBirth ?? null" />
    </section>

    <ng-template #findingForm>
      <form class="mb-3 grid gap-2 rounded-lg border border-ink-200 bg-ink-50 p-3 sm:grid-cols-2" (ngSubmit)="submit()">
        <label class="field">
          <span class="label label-required">{{ 'PATIENTS.DOSSIER.UI.TOOTH_FDI' | translate }}</span>
          <input class="input" name="fdi" required maxlength="2" inputmode="numeric" [(ngModel)]="draft.fdi" autocomplete="off" />
        </label>
        <label class="field">
          <span class="label label-required">{{ (form() === 'plan' ? 'PATIENTS.DOSSIER.UI.SELECT_REQUIRED' : 'PATIENTS.DOSSIER.UI.SELECT_FINDING') | translate }}</span>
          <select class="select" name="code" required [(ngModel)]="draft.findingCode">
            <option value="" disabled>—</option>
            @for (def of (form() === 'plan' ? requiredCodes() : diagnosticCodes()); track def.code) { <option [value]="def.code">{{ name(def.code) }}</option> }
          </select>
        </label>
        @if (form() === 'diagnostic') {
          <label class="field">
            <span class="label">{{ 'PATIENTS.DOSSIER.UI.SEVERITY' | translate }}</span>
            <select class="select" name="severity" [(ngModel)]="draft.severity">
              <option value="">{{ 'PATIENTS.DOSSIER.UI.NO_SEVERITY' | translate }}</option>
              <option value="MILD">{{ 'PATIENTS.DOSSIER.UI.MILD' | translate }}</option>
              <option value="MODERATE">{{ 'PATIENTS.DOSSIER.UI.MODERATE' | translate }}</option>
              <option value="SEVERE">{{ 'PATIENTS.DOSSIER.UI.SEVERE' | translate }}</option>
            </select>
          </label>
        }
        <label class="field sm:col-span-2">
          <span class="label">{{ 'PATIENTS.DOSSIER.UI.NOTE_OPTIONAL' | translate }}</span>
          <textarea class="textarea" name="note" rows="2" [(ngModel)]="draft.note"></textarea>
        </label>
        <div class="flex justify-end gap-2 sm:col-span-2">
          <button type="button" class="btn btn-ghost btn-sm" (click)="form.set(null)">{{ 'COMMON.CANCEL' | translate }}</button>
          <button type="submit" class="btn btn-primary btn-sm" [disabled]="!draft.fdi || !draft.findingCode">{{ 'COMMON.SAVE' | translate }}</button>
        </div>
      </form>
    </ng-template>
  `,
  styles: [`
    :host { display: block; }
    .cp-chart { margin-bottom: 1rem; }
    .cp-placeholder { height: clamp(22rem, 58vh, 40rem); border-radius: var(--radius-lg); background: var(--surface-hover); }
    .cp-grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(22rem, 1fr)); }
    @media (max-width: 30rem) { .cp-grid { grid-template-columns: minmax(0, 1fr); } }
    .cp-fdi {
      flex: none; display: grid; place-items: center; width: 2.75rem; height: 2.75rem; border-radius: var(--radius-md);
      border: 0; background: rgb(var(--petrol-700)); color: rgb(var(--on-inverse)); font: inherit; font-weight: 800; cursor: pointer;
    }
  `],
})
export class ChartPlanTabComponent {
  readonly patient = input.required<Patient>();
  readonly chart = input<DentalChartState | null>(null);
  readonly findings = input<ToothFinding[]>([]);
  readonly notes = input<readonly ClinicalNote[]>([]);
  readonly treatments = input<PatientTreatment[]>([]);
  readonly staged = input<readonly StagedFinding[]>([]);
  readonly focusFdi = input<string | null>(null);
  readonly selected = model<string | null>(null);
  readonly treatmentsChanged = output<void>();

  private readonly records = inject(ClinicalRecordService);
  private readonly translate = inject(TranslateService);
  private readonly toast = inject(ToastService);
  private readonly permissions = inject(PermissionService);
  protected readonly assigned = viewChild.required(AssignedTreatmentsComponent);

  protected readonly canWrite = computed(() => this.permissions.can('CLINICAL_WRITE'));
  protected readonly form = signal<'diagnostic' | 'plan' | null>(null);
  protected draft: { fdi: string; findingCode: string; severity: Severity | ''; note: string } = { fdi: '', findingCode: '', severity: '', note: '' };

  protected readonly byTooth = computed<ToothGroup[]>(() => {
    const map = new Map<string, ToothFinding[]>();
    for (const f of this.findings()) {
      if (f.status !== 'ACTIVE' || (f.kind !== 'EXISTING' && f.kind !== 'CONDITION')) continue;
      map.set(f.fdi, [...(map.get(f.fdi) ?? []), f]);
    }
    return [...map].sort(([a], [b]) => Number(a) - Number(b)).map(([fdi, findings]) => ({ fdi, findings }));
  });
  protected readonly required = computed(() =>
    this.findings().filter(f => f.status === 'ACTIVE' && f.kind === 'TREATMENT_REQUIRED').sort((a, b) => Number(a.fdi) - Number(b.fdi)));
  protected readonly planned = computed(() => this.treatments().filter(t => t.status === 'PLANNED' || t.status === 'ACTIVE'));
  protected readonly plannedTotal = computed(() => this.planned().reduce((sum, t) => sum + (t.treatment.basePrice ?? 0), 0));
  /** The plan the last consultation proposed, while nothing has been planned or started from it. */
  protected readonly proposed = computed(() => (this.planned().length ? null : reportVisits(this.notes())[0]?.plan ?? null));

  protected readonly diagnosticCodes = computed(() =>
    (this.records.catalog()?.definitions ?? []).filter(d => d.kind === 'EXISTING' || d.kind === 'CONDITION'));
  protected readonly requiredCodes = computed(() =>
    (this.records.catalog()?.definitions ?? []).filter(d => d.kind === 'TREATMENT_REQUIRED'));

  protected name(code: string): string {
    return findingLabel(this.translate, code);
  }

  protected openForm(which: 'diagnostic' | 'plan'): void {
    this.draft = { fdi: this.selected() ?? '', findingCode: '', severity: '', note: '' };
    this.form.set(which);
  }

  protected submit(): void {
    if (!this.draft.fdi || !this.draft.findingCode) return;
    this.records.addFinding(this.patient().id, this.draft.fdi, {
      findingCode: this.draft.findingCode,
      severity: this.draft.severity || undefined,
      note: this.draft.note || undefined,
      source: 'manual',
    }).subscribe({
      next: () => {
        this.toast.success(this.translate.instant('PATIENTS.DOSSIER.UI.FINDING_RECORDED'));
        this.form.set(null);
      },
      error: (err) => this.toast.error(err.error?.detail || err.error?.message || this.translate.instant('COMMON.SAVE_FAILED')),
    });
  }

  protected resolve(f: ToothFinding): void {
    this.records.changeFindingStatus(this.patient().id, f.id, 'RESOLVED').subscribe({
      next: () => this.toast.success(this.translate.instant('PATIENTS.DOSSIER.UI.FINDING_RESOLVED')),
      error: (err) => this.toast.error(err.error?.detail || err.error?.message || this.translate.instant('COMMON.SAVE_FAILED')),
    });
  }
}
