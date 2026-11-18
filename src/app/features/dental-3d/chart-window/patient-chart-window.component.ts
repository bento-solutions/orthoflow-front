import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Patient } from '../../../core/models/patient.model';
import { PatientTreatment, PatientTreatmentStatus } from '../../../core/models/patient-treatment.model';
import { ToothFinding } from '../../../core/models/clinical-record.model';
import { Treatment } from '../../../core/models/stock.model';
import { findingLabel } from '../../../core/clinical/finding-options';
import { surfaceShorthand } from '../../../core/clinical/tooth-surfaces';
import { paintChart, ToothPaint } from '../../../core/clinical/tooth-paint';
import { toothGrid } from '../../../core/clinical/tooth-grid';
import { MouthGroupKind, summarizeMouth } from '../../../core/clinical/mouth-summary';
import { TREATMENT_PLAN_INK } from '../../../core/clinical/tooth-status';
import { PatientService } from '../../../core/services/patient.service';
import { DentalChartService } from '../../../core/services/dental-chart.service';
import { ClinicalRecordService } from '../../../core/services/clinical-record.service';
import { PatientTreatmentService } from '../../../core/services/patient-treatment.service';
import { StockService } from '../../../core/services/stock.service';
import { ThemeService } from '../../../core/services/theme.service';
import { ToastService } from '../../../core/services/toast.service';
import { Dental3dViewService } from '../../../core/services/dental-3d-view.service';
import { followChartChanges } from '../../../core/services/follow-chart-changes';
import { ModalComponent } from '../../../shared/ui/modal.component';
import { IconComponent } from '../../../shared/ui/icon.component';
import { AppDatePipe } from '../../../shared/pipes/app-date.pipe';
import { Dental3dChartComponent } from '../dental-3d-chart.component';
import { PatientImagingPaneComponent } from '../../patients/patient-dossier/patient-imaging-pane.component';

/** The four states the window counts, in the order the legend gives them. */
const TILES: readonly { kind: MouthGroupKind; key: string }[] = [
  { kind: 'condition', key: 'CHART_WINDOW.TILE.CONDITION' },
  { kind: 'planned', key: 'CHART_WINDOW.TILE.PLANNED' },
  { kind: 'existing', key: 'CHART_WINDOW.TILE.EXISTING' },
  { kind: 'absent', key: 'CHART_WINDOW.TILE.ABSENT' },
];

const STATUS_ORDER: Record<PatientTreatmentStatus, number> = { ACTIVE: 0, PLANNED: 1, COMPLETED: 2, CANCELLED: 3 };

/** Work to be done on a tooth, as the rail lists it. */
export interface ToDo {
  readonly id: string;
  readonly fdi: string;
  readonly what: string;
  /** What is wrong with the tooth that calls for it. */
  readonly why: string;
}

/** The age a date of birth gives today, or null without one. */
export function ageOn(dateOfBirth: string | null | undefined, today = new Date()): number | null {
  if (!dateOfBirth) return null;
  const born = new Date(dateOfBirth);
  if (Number.isNaN(born.getTime())) return null;
  let age = today.getFullYear() - born.getFullYear();
  const before = today.getMonth() < born.getMonth() || (today.getMonth() === born.getMonth() && today.getDate() < born.getDate());
  if (before) age--;
  return age;
}

/**
 * The patient's 3D chart in a window of its own, opened from the patient file and meant for a
 * second screen. Nothing of the app's frame: the patient, the state of the mouth and the
 * treatments on one side, the chart with the tooth in hand in the middle, the legend and the
 * keys below. Whatever is recorded here shows in the patient file, and the other way round.
 *
 * Always dark: the model and the X-rays read best on a dark ground, and the window is its own
 * page, so the patient file keeps the person's theme.
 */
@Component({
  selector: 'app-patient-chart-window',
  standalone: true,
  imports: [AppDatePipe, IconComponent, FormsModule, TranslateModule, ModalComponent, Dental3dChartComponent, PatientImagingPaneComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'chart-window', '(document:keydown.escape)': 'onEscape($event)' },
  template: `
    <header class="cw-head">
      @if (patient(); as p) {
        <div class="cw-who">
          <span class="cw-avatar" aria-hidden="true">{{ initials() }}</span>
          <div class="cw-who-text">
            <h1>{{ p.firstName }} {{ p.lastName }}</h1>
            <p>
              @if (age() !== null) { <span>{{ age() }} {{ 'PATIENTS.DOSSIER.YEARS' | translate }}</span> }
              @if (p.gender) { <span>{{ 'PATIENTS.DOSSIER.GENDER_' + p.gender | translate }}</span> }
              @if (p.cin) { <span dir="ltr">{{ p.cin }}</span> }
              @if (activeCount()) { <span class="cw-pill">{{ 'CHART_WINDOW.ACTIVE_TREATMENT' | translate }}</span> }
            </p>
          </div>
        </div>
      } @else {
        <p class="cw-loading" role="status">{{ 'COMMON.LOADING' | translate }}</p>
      }
      <div class="cw-actions">
        <button type="button" class="cw-btn" [class.on]="xrayBeside()" [attr.aria-pressed]="xrayBeside()" (click)="xrayBeside.set(!xrayBeside())"
          [title]="'CHART_WINDOW.XRAY_BESIDE_HINT' | translate">
          <app-icon class="mi" name="columns" size="1em" />{{ 'CHART_WINDOW.XRAY_BESIDE' | translate }}
        </button>
        <button type="button" class="cw-btn cw-icon" (click)="print()" [title]="'CHART_WINDOW.PRINT' | translate" [attr.aria-label]="'CHART_WINDOW.PRINT' | translate">
          <app-icon class="mi" name="print" size="1em" />
        </button>
        <button type="button" class="cw-btn cw-close" (click)="close()" [attr.aria-label]="'CHART_WINDOW.CLOSE' | translate">
          <app-icon class="mi" name="close" size="1em" />{{ 'COMMON.CLOSE' | translate }} <kbd>Esc</kbd>
        </button>
      </div>
    </header>

    <div class="cw-body">
      @if (xrayBeside() && patientId(); as id) {
        <section class="cw-side cw-xray" [attr.aria-label]="'PFILES.PANE_LABEL' | translate">
          <app-patient-imaging-pane class="cw-xray-pane" [patientId]="id" [patientName]="fullName()" [uploadLink]="false" [chartLink]="false" />
        </section>
      } @else {
        <aside class="cw-side cw-rail" [attr.aria-label]="'CHART_WINDOW.STATE' | translate">
          <section>
            <h2 class="cw-h">{{ 'CHART_WINDOW.STATE' | translate }}</h2>
            <div class="cw-tiles">
              @for (tile of tiles(); track tile.kind) {
                <div class="cw-tile" [attr.data-kind]="tile.kind">
                  <span class="cw-tile-name"><i [class]="'sw sw-' + tile.kind" aria-hidden="true"></i>{{ tile.key | translate }}</span>
                  <span class="cw-tile-count">{{ tile.teeth.length }}</span>
                  @if (tile.teeth.length) {
                    <span class="cw-tile-teeth">
                      @for (fdi of tile.teeth; track fdi) {
                        <button type="button" class="cw-tooth" [class.on]="selected() === fdi" (click)="pickTooth(fdi)"
                          [attr.aria-label]="fdi + ', ' + (('TOOTH_NAME.' + fdi) | translate)">{{ fdi }}</button>
                      }
                    </span>
                  }
                </div>
              }
            </div>
          </section>

          <section>
            <h2 class="cw-h">{{ 'CHART_WINDOW.TO_DO' | translate }}</h2>
            @for (item of toDo(); track item.id) {
              <button type="button" class="cw-row" [class.on]="selected() === item.fdi" (click)="pickTooth(item.fdi)">
                <span class="cw-fdi">{{ item.fdi }}</span>
                <span class="cw-row-text"><b>{{ item.what }}</b>@if (item.why) { <span>{{ item.why }}</span> }</span>
              </button>
            } @empty {
              <p class="cw-empty">{{ 'CHART_WINDOW.NOTHING_TO_DO' | translate }}</p>
            }
          </section>

          <section>
            <h2 class="cw-h">{{ 'CHART_WINDOW.TREATMENTS' | translate }}</h2>
            @for (t of plan(); track t.id) {
              <button type="button" class="cw-plan" (click)="pickTooth(firstTooth(t))" [disabled]="!firstTooth(t)">
                <span class="cw-plan-top"><b>{{ t.treatment?.name }}</b><span [style.color]="ink(t.status)">{{ t.status === 'COMPLETED' ? ('CHART_WINDOW.DONE' | translate) : (t.progress ?? 0) + '%' }}</span></span>
                <span class="cw-plan-sub">
                  @if (t.teeth) { <span dir="ltr">{{ teethOf(t) }}</span> · }
                  {{ 'CHART_WINDOW.STATUS.' + t.status | translate }}
                  @if (t.status === 'COMPLETED' && t.endDate) { · {{ t.endDate | appDate }} }
                </span>
                <span class="cw-bar" aria-hidden="true"><i [style.width.%]="t.status === 'COMPLETED' ? 100 : (t.progress ?? 0)" [style.background]="ink(t.status)"></i></span>
              </button>
            } @empty {
              <p class="cw-empty">{{ 'CHART_WINDOW.NO_TREATMENTS' | translate }}</p>
            }
          </section>
        </aside>
      }

      <main class="cw-chart" [attr.aria-label]="'DENTAL_3D.TITLE' | translate">
        @if (chart(); as c) {
          <app-dental-3d-chart
            [chart]="c"
            [findings]="records.findings()"
            [treatments]="treatments()"
            [fill]="true"
            [summaryInPanel]="false"
            [(selected)]="selected"
            (assignTreatment)="openAssign($event)"
          />
        }
      </main>
    </div>

    <app-modal [open]="assignOpen()" [title]="'DENTAL_3D.ASSIGN' | translate: { fdi: assignTeeth || '' }" size="md" (closed)="assignOpen.set(false)">
      <form class="cw-form" (ngSubmit)="saveAssign()" id="cw-assign-form">
        <label>
          <span>{{ 'PATIENTS.DOSSIER.UI.CHOOSE_TREATMENT' | translate }}</span>
          <select class="input" name="treatment" [(ngModel)]="assignTreatmentId" required>
            <option value="" disabled>{{ 'PATIENTS.DOSSIER.UI.CHOOSE_TREATMENT' | translate }}</option>
            @for (t of catalogue(); track t.id) { <option [value]="t.id">{{ t.name }}</option> }
          </select>
        </label>
        <div class="cw-form-row">
          <label>
            <span>{{ 'PATIENTS.DOSSIER.UI.ASSIGNED_TEETH' | translate }}</span>
            <input class="input" name="teeth" [(ngModel)]="assignTeeth" dir="ltr" />
          </label>
          <label>
            <span>{{ 'COMMON.STATUS' | translate }}</span>
            <select class="input" name="status" [(ngModel)]="assignStatus">
              @for (s of statuses; track s) { <option [value]="s">{{ 'CHART_WINDOW.STATUS.' + s | translate }}</option> }
            </select>
          </label>
          <label>
            <span>{{ 'PATIENTS.DOSSIER.UI.START_DATE' | translate }}</span>
            <input class="input" type="date" name="start" [(ngModel)]="assignStart" />
          </label>
        </div>
        <label>
          <span>{{ 'PATIENTS.DOSSIER.UI.CLINICAL_NOTES' | translate }}</span>
          <textarea class="input" rows="3" name="notes" [(ngModel)]="assignNotes"></textarea>
        </label>
        <p class="cw-hint">{{ 'CHART_WINDOW.ASSIGN_MATERIALS' | translate }}</p>
      </form>
      <div modal-footer class="cw-form-actions">
        <button type="button" class="btn btn-secondary" (click)="assignOpen.set(false)">{{ 'COMMON.CANCEL' | translate }}</button>
        <button type="submit" form="cw-assign-form" class="btn btn-primary" [disabled]="!assignTreatmentId || saving()">{{ 'COMMON.SAVE' | translate }}</button>
      </div>
    </app-modal>
  `,
  styles: [`
    :host {
      display: grid; grid-template-rows: auto minmax(0, 1fr); height: 100vh; height: 100dvh; overflow: hidden;
      background: rgb(var(--ink-50)); color: var(--text);
    }
    .cw-head {
      display: flex; flex-wrap: wrap; align-items: center; gap: .75rem 1.25rem; padding: .625rem 1.125rem;
      background: var(--surface); border-bottom: 1px solid var(--border);
    }
    .cw-who { display: flex; align-items: center; gap: .75rem; min-width: 0; margin-inline-end: auto; }
    .cw-avatar {
      display: inline-flex; align-items: center; justify-content: center; width: 2.5rem; height: 2.5rem; flex: none; border-radius: 50%;
      background: rgb(var(--petrol-600)); color: var(--text-inverse); font-weight: 700; font-size: var(--text-base);
    }
    .cw-who-text { min-width: 0; }
    .cw-who h1 { margin: 0; font-size: var(--text-md); font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cw-who p { display: flex; flex-wrap: wrap; align-items: center; gap: .125rem .5rem; margin: .125rem 0 0; font-size: var(--text-xs); color: var(--text-muted); }
    .cw-who p > span + span:not(.cw-pill)::before { content: '·'; margin-inline-end: .5rem; }
    .cw-pill { padding: .0625rem .5rem; border-radius: var(--radius-full); background: rgb(var(--positive-100)); color: rgb(var(--positive-700)); font-weight: 600; }
    .cw-loading { margin: 0 auto 0 0; color: var(--text-muted); }
    .cw-actions { display: flex; flex-wrap: wrap; align-items: center; gap: .375rem; }
    .cw-btn {
      display: inline-flex; align-items: center; gap: .375rem; height: 2.25rem; padding: 0 .75rem; font: inherit; font-size: var(--text-sm); font-weight: 600;
      border: 1px solid var(--border-strong); border-radius: var(--radius-md); background: var(--surface); color: var(--text); cursor: pointer;
    }
    .cw-btn:hover { background: var(--surface-hover); }
    .cw-btn.on { background: var(--action); border-color: var(--action); color: var(--text-inverse); }
    .cw-btn app-icon.mi { font-size: var(--text-lg); }
    .cw-icon { width: 2.25rem; padding: 0; justify-content: center; }
    .cw-close { border-color: var(--action); background: transparent; }
    .cw-close kbd { padding: .0625rem .3125rem; border: 1px solid var(--border-strong); border-bottom-width: 2px; border-radius: var(--radius-xs); font: inherit; font-size: var(--text-xs); color: var(--text-muted); }
    .cw-btn:focus-visible, .cw-row:focus-visible, .cw-plan:focus-visible, .cw-tooth:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }

    .cw-body { display: grid; grid-template-columns: 19rem minmax(0, 1fr); min-height: 0; }
    .cw-body:has(.cw-xray) { grid-template-columns: minmax(22rem, 34%) minmax(0, 1fr); }
    .cw-side { min-height: 0; background: var(--surface); border-inline-end: 1px solid var(--border); }
    .cw-rail { overflow-y: auto; padding: 1rem; display: flex; flex-direction: column; gap: 1.375rem; }
    .cw-xray { display: flex; padding: .75rem; }
    .cw-xray-pane { flex: 1; }
    .cw-chart { min-width: 0; min-height: 0; }

    .cw-h { margin: 0 0 .625rem; font-size: var(--text-xs); font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--text-muted); }
    .cw-tiles { display: grid; grid-template-columns: 1fr 1fr; gap: .5rem; }
    .cw-tile { display: flex; flex-direction: column; gap: .25rem; padding: .625rem; border-radius: var(--radius-md); border: 1px solid var(--border); background: rgb(var(--ink-50)); min-width: 0; }
    .cw-tile[data-kind='condition'] { border-color: rgb(var(--critical-200)); background: rgb(var(--critical-50)); }
    .cw-tile[data-kind='planned'] { border-color: rgb(var(--caution-200)); background: rgb(var(--caution-50)); }
    .cw-tile[data-kind='existing'] { border-color: rgb(var(--petrol-200)); background: rgb(var(--petrol-50)); }
    .cw-tile-name { display: inline-flex; align-items: center; gap: .375rem; font-size: var(--text-xs); font-weight: 600; }
    .cw-tile[data-kind='condition'] .cw-tile-name { color: rgb(var(--critical-700)); }
    .cw-tile[data-kind='planned'] .cw-tile-name { color: rgb(var(--caution-700)); }
    .cw-tile[data-kind='existing'] .cw-tile-name { color: rgb(var(--petrol-700)); }
    .cw-tile-count { font-size: 1.5rem; font-weight: 700; line-height: 1.1; font-variant-numeric: tabular-nums; }
    .cw-tile-teeth { display: flex; flex-wrap: wrap; gap: .1875rem; }
    .cw-tooth {
      min-width: 1.75rem; height: 1.375rem; padding: 0 .25rem; font: inherit; font-size: var(--text-xs); font-weight: 700; font-variant-numeric: tabular-nums;
      border: 1px solid var(--border-strong); border-radius: var(--radius-xs); background: var(--surface); color: var(--text); cursor: pointer;
    }
    .cw-tooth:hover { background: var(--action-tint); }
    .cw-tooth.on { background: var(--action); border-color: var(--action); color: var(--text-inverse); }
    .sw { display: inline-block; width: .75rem; height: .75rem; border-radius: var(--radius-xs); border: 1px solid transparent; flex: none; }
    .sw-existing { background: repeating-linear-gradient(135deg, rgb(var(--petrol-500)) 0 2px, rgb(var(--petrol-50)) 2px 4px); border-color: rgb(var(--petrol-500)); }
    .sw-condition { background: radial-gradient(rgb(var(--critical-500)) 1.2px, rgb(var(--critical-50)) 1.4px) 0 0 / 4px 4px; border-color: rgb(var(--critical-500)); }
    .sw-planned { background: repeating-linear-gradient(135deg, rgb(var(--caution-500)) 0 2px, rgb(var(--caution-50)) 2px 5px); border-color: rgb(var(--caution-500)); }
    .sw-absent { background: var(--surface); border: 1px dashed var(--text-muted); }

    .cw-row {
      display: flex; align-items: flex-start; gap: .625rem; width: 100%; padding: .5rem .625rem; margin-bottom: .25rem; text-align: start;
      font: inherit; border: 1px solid transparent; border-radius: var(--radius-md); background: transparent; color: inherit; cursor: pointer;
    }
    .cw-row:hover { background: var(--surface-hover); }
    .cw-row.on { border-color: var(--action); background: var(--action-tint); }
    .cw-fdi {
      display: inline-flex; align-items: center; justify-content: center; min-width: 1.875rem; height: 1.5rem; flex: none; border-radius: var(--radius-full);
      font-size: var(--text-xs); font-weight: 700; font-variant-numeric: tabular-nums; background: var(--text); color: var(--surface);
    }
    .cw-row.on .cw-fdi { background: var(--action); color: var(--text-inverse); }
    .cw-row-text { display: flex; flex-direction: column; gap: .125rem; min-width: 0; font-size: var(--text-sm); }
    .cw-row-text span { font-size: var(--text-xs); color: var(--text-muted); }
    .cw-plan {
      display: flex; flex-direction: column; gap: .25rem; width: 100%; padding: .5rem .625rem; margin-bottom: .375rem; text-align: start;
      font: inherit; font-size: var(--text-sm); border: 1px solid transparent; border-radius: var(--radius-md); background: transparent; color: inherit; cursor: pointer;
    }
    .cw-plan:hover:not(:disabled) { background: var(--surface-hover); }
    .cw-plan:disabled { cursor: default; }
    .cw-plan-top { display: flex; justify-content: space-between; gap: .5rem; }
    .cw-plan-top span { font-weight: 700; flex: none; }
    .cw-plan-sub { font-size: var(--text-xs); color: var(--text-muted); }
    .cw-bar { display: block; height: .375rem; border-radius: var(--radius-full); background: rgb(var(--ink-200)); overflow: hidden; }
    .cw-bar i { display: block; height: 100%; min-width: .25rem; border-radius: var(--radius-full); }
    .cw-empty { margin: 0; font-size: var(--text-sm); color: var(--text-muted); }

    .cw-form { display: flex; flex-direction: column; gap: .875rem; }
    .cw-form label { display: flex; flex-direction: column; gap: .25rem; font-size: var(--text-sm); font-weight: 600; min-width: 0; }
    .cw-form-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .75rem; }
    .cw-hint { margin: 0; font-size: var(--text-xs); color: var(--text-muted); }
    .cw-form-actions { display: flex; justify-content: flex-end; gap: .5rem; }

    @media (max-width: 900px) {
      .cw-body, .cw-body:has(.cw-xray) { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
      .cw-side { max-height: 32vh; border-inline-end: 0; border-bottom: 1px solid var(--border); }
      .cw-form-row { grid-template-columns: minmax(0, 1fr); }
    }
    @media print {
      :host { height: auto; display: block; background: white; }
      .cw-actions, .cw-side { display: none; }
    }
  `],
})
export class PatientChartWindowComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly patients = inject(PatientService);
  private readonly charts = inject(DentalChartService);
  protected readonly records = inject(ClinicalRecordService);
  private readonly treatmentApi = inject(PatientTreatmentService);
  private readonly stock = inject(StockService);
  private readonly translate = inject(TranslateService);
  private readonly toast = inject(ToastService);
  private readonly title = inject(Title);

  readonly patientId = toSignal(this.route.paramMap.pipe(map((params) => params.get('id'))), { initialValue: null });
  readonly patient = signal<Patient | null>(null);
  readonly treatments = signal<PatientTreatment[]>([]);
  readonly catalogue = signal<Treatment[]>([]);
  readonly selected = signal<string | null>(null);
  readonly xrayBeside = signal(false);

  /** The chart this window is for, never the last one another screen of this window loaded. */
  readonly chart = computed(() => {
    const chart = this.charts.currentChart();
    return chart && chart.patientId === this.patientId() ? chart : null;
  });

  readonly fullName = computed(() => {
    const p = this.patient();
    return p ? `${p.firstName} ${p.lastName}` : '';
  });
  readonly initials = computed(() => {
    const p = this.patient();
    return p ? `${p.firstName?.charAt(0) ?? ''}${p.lastName?.charAt(0) ?? ''}`.toUpperCase() : '';
  });
  readonly age = computed(() => ageOn(this.patient()?.dateOfBirth));
  readonly activeCount = computed(() => this.treatments().filter((t) => t.status === 'ACTIVE').length);

  private readonly paints = computed(() => {
    const chart = this.chart();
    return chart ? paintChart(chart.teeth, this.records.findings(), [], this.treatments()) : [];
  });
  private readonly order = computed(() => {
    const chart = this.chart();
    return chart ? toothGrid(chart.chartType).flat() : [];
  });

  /** How many teeth are in each state, and which: the window's answer to "how is this mouth". */
  readonly tiles = computed(() => {
    const groups = summarizeMouth(this.order(), new Map<string, ToothPaint>(this.paints().map((p) => [p.fdi, p])));
    return TILES.map((tile) => ({ ...tile, teeth: groups.find((g) => g.kind === tile.kind)?.teeth ?? [] }));
  });

  /** Every piece of work to be done, tooth by tooth in chart order, with what calls for it. */
  readonly toDo = computed<ToDo[]>(() => {
    const active = this.records.findings().filter((f) => f.status === 'ACTIVE' && !!f.fdi);
    const order = this.order();
    const rank = (fdi: string) => {
      const at = order.indexOf(fdi);
      return at < 0 ? order.length : at;
    };
    return active
      .filter((f) => f.kind === 'TREATMENT_REQUIRED')
      .sort((a, b) => rank(a.fdi!) - rank(b.fdi!))
      .map((f) => ({
        id: f.id,
        fdi: f.fdi!,
        what: this.findingText(f),
        why: active.filter((c) => c.fdi === f.fdi && c.kind === 'CONDITION').map((c) => this.conditionText(c)).join(' · '),
      }));
  });

  /** The treatments assigned, those under way first; cancelled ones are left out. */
  readonly plan = computed(() =>
    this.treatments()
      .filter((t) => t.status !== 'CANCELLED')
      .sort((a, b) => STATUS_ORDER[a.status ?? 'PLANNED'] - STATUS_ORDER[b.status ?? 'PLANNED']));

  readonly statuses: readonly PatientTreatmentStatus[] = ['PLANNED', 'ACTIVE', 'COMPLETED'];
  readonly assignOpen = signal(false);
  readonly saving = signal(false);
  assignTreatmentId = '';
  assignTeeth = '';
  assignStatus: PatientTreatmentStatus = 'PLANNED';
  assignStart = '';
  assignNotes = '';

  constructor() {
    const theme = inject(ThemeService);
    theme.force('dark');
    const view = inject(Dental3dViewService);
    inject(DestroyRef).onDestroy(() => theme.force(null));

    effect(() => {
      const id = this.patientId();
      if (!id) return;
      untracked(() => this.load(id));
    });
    effect(() => {
      const name = this.fullName();
      if (name) this.title.setTitle(`${name} · ${this.translate.instant('CHART_WINDOW.TITLE')}`);
    });
    // Each window starts on the whole mouth, whatever the patient file was looking at.
    view.reset();

    followChartChanges(() => this.patientId(), (id) => this.loadTreatments(id));
    this.records.loadCatalogOnce();
    this.stock.getTreatments().pipe(takeUntilDestroyed()).subscribe({ next: (list) => this.catalogue.set(list), error: () => undefined });
  }

  private load(id: string): void {
    this.selected.set(null);
    this.patients.setCurrentPatient(id).subscribe({
      next: (patient) => {
        this.patient.set(patient);
        this.charts.loadChart(patient.id, patient.dateOfBirth);
      },
      error: () => this.toast.error(this.translate.instant('CHART_WINDOW.LOAD_FAILED')),
    });
    this.records.refresh(id);
    this.records.loadPeriodontal(id);
    this.loadTreatments(id);
  }

  private loadTreatments(id: string): void {
    this.treatmentApi.getPatientTreatments(id).subscribe({ next: (list) => this.treatments.set(list), error: () => undefined });
  }

  pickTooth(fdi: string | null): void {
    if (fdi) this.selected.set(fdi);
  }

  /** "13, 12, 11": the teeth as written, easier to read. */
  protected teethOf(t: PatientTreatment): string {
    return (t.teeth ?? '').split(',').map((x) => x.trim()).filter(Boolean).join(', ');
  }

  protected firstTooth(t: PatientTreatment): string | null {
    return (t.teeth ?? '').split(',').map((x) => x.trim()).find((x) => /^\d{2}$/.test(x)) ?? null;
  }

  protected ink(status: string | undefined): string {
    return TREATMENT_PLAN_INK[status as keyof typeof TREATMENT_PLAN_INK] ?? 'rgb(var(--petrol-500))';
  }

  private findingText(f: ToothFinding): string {
    const label = findingLabel(this.translate, f.findingCode ?? '');
    return f.surface ? `${label}, ${surfaceShorthand(f.surface)}` : label;
  }

  private conditionText(f: ToothFinding): string {
    const text = this.findingText(f);
    return f.severity ? `${text} · ${this.translate.instant('PATIENTS.DOSSIER.UI.' + f.severity).toLowerCase()}` : text;
  }

  /* ── Assigning a treatment ────────────────────────────────────────────── */

  openAssign(fdi: string): void {
    this.assignTreatmentId = '';
    this.assignTeeth = fdi;
    this.assignStatus = 'PLANNED';
    this.assignStart = new Date().toISOString().split('T')[0];
    this.assignNotes = '';
    this.assignOpen.set(true);
  }

  /** As the patient file assigns one: the materials the catalogue lists for it come with it. */
  saveAssign(): void {
    const id = this.patientId();
    const treatment = this.catalogue().find((t) => t.id === this.assignTreatmentId);
    if (!id || !treatment?.id) {
      this.toast.error(this.translate.instant('PATIENTS.DOSSIER.UI.SELECT_VALID_TREATMENT'));
      return;
    }
    this.saving.set(true);
    this.treatmentApi.createPatientTreatment(id, {
      treatmentId: treatment.id,
      teeth: this.assignTeeth,
      status: this.assignStatus,
      progress: this.assignStatus === 'COMPLETED' ? 100 : 0,
      notes: this.assignNotes,
      startDate: this.assignStart || undefined,
      consumables: (treatment.consumables ?? []).filter((c) => !!c.stockItem?.id).map((c) => ({ stockItemId: c.stockItem!.id!, quantityUsed: c.quantityUsed ?? 1 })),
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.assignOpen.set(false);
        this.loadTreatments(id);
      },
      error: (err) => {
        this.saving.set(false);
        this.toast.error(err?.error?.detail || err?.error?.message || this.translate.instant('CHART_WINDOW.ASSIGN_FAILED'));
      },
    });
  }

  /* ── The window ───────────────────────────────────────────────────────── */

  print(): void {
    window.print();
  }

  /**
   * Back to the patient file: the window closes when the patient file opened it; opened in the
   * tab itself (the browser refused a new window), the tab goes back to the patient file.
   */
  close(): void {
    if (window.opener) {
      window.close();
      return;
    }
    const id = this.patientId();
    void this.router.navigate(id ? ['/patients', id] : ['/patients']);
  }

  /**
   * Escape that nothing inside wanted: first lets go of the tooth in hand, then closes the
   * window. The chart, a dialog and the X-ray viewer each stop the Escape they use.
   */
  protected onEscape(event: Event): void {
    if (event.defaultPrevented || this.assignOpen()) return;
    const target = event.target;
    if (target instanceof Element && target.closest('input, textarea, select, [role="dialog"]')) return;
    if (this.selected()) {
      this.selected.set(null);
      return;
    }
    this.close();
  }
}
