import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ClinicalRecordService } from '../../../core/services/clinical-record.service';
import { ToastService } from '../../../core/services/toast.service';
import {
  PERIO_REGIONS, PerioCondition, PerioRegion, PeriodontalAssessment,
} from '../../../core/models/clinical-record.model';

const CONDITIONS: readonly PerioCondition[] = ['HEALTHY', 'GINGIVITIS', 'PERIODONTITIS'];
/** The mouth as the dentist faces the patient: the patient's right is on the left. */
const MOUTH_ROWS: readonly (readonly PerioRegion[])[] = [
  ['UPPER_RIGHT', 'UPPER_FRONT', 'UPPER_LEFT'],
  ['LOWER_RIGHT', 'LOWER_FRONT', 'LOWER_LEFT'],
];

/**
 * The state of the gums, by area of the mouth. Gums are rarely uniform:
 * "periodontitis" on a mouth whose front teeth are healthy would misinform the
 * next practitioner, so each of the six sextants (and the mouth as a whole) has
 * its own latest assessment, and every earlier one is kept.
 */
@Component({
  selector: 'app-gum-status',
  standalone: true,
  imports: [FormsModule, DatePipe, NgTemplateOutlet, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="head">
      <h2>{{ 'GUMS.TITLE' | translate }}</h2>
      <p class="sub">{{ 'GUMS.SUBTITLE' | translate }}</p>
    </header>

    <div class="map" role="group" [attr.aria-label]="'GUMS.TITLE' | translate">
      <button type="button" class="tile whole" [class.sel]="region() === 'WHOLE_MOUTH'"
        [attr.data-state]="stateOf('WHOLE_MOUTH')?.condition ?? 'NONE'" (click)="region.set('WHOLE_MOUTH')">
        <ng-container [ngTemplateOutlet]="tileBody" [ngTemplateOutletContext]="{ r: 'WHOLE_MOUTH' }" />
      </button>
      @for (row of rows; track $index) {
        <div class="row">
          @for (r of row; track r) {
            <button type="button" class="tile" [class.sel]="region() === r"
              [attr.data-state]="stateOf(r)?.condition ?? 'NONE'" (click)="region.set(r)">
              <ng-container [ngTemplateOutlet]="tileBody" [ngTemplateOutletContext]="{ r: r }" />
            </button>
          }
        </div>
      }
    </div>

    <ng-template #tileBody let-r="r">
      <span class="tile-region">{{ ('GUMS.REGION.' + r) | translate }}</span>
      @if (stateOf(r); as s) {
        <span class="tile-state">
          {{ ('GUMS.CONDITION.' + s.condition) | translate }}
          @if (s.stage) { · {{ 'GUMS.STAGE_N' | translate: { n: s.stage } }} }
        </span>
        <span class="tile-date">{{ s.assessedOn | date: 'mediumDate' }}</span>
      } @else {
        <span class="tile-state muted">{{ 'GUMS.NOT_ASSESSED' | translate }}</span>
      }
    </ng-template>

    <form class="form" (ngSubmit)="save()">
      <h3>{{ 'GUMS.RECORD' | translate }}</h3>
      <label class="field">
        <span>{{ 'GUMS.AREA' | translate }}</span>
        <select class="control" name="region" [ngModel]="region()" (ngModelChange)="region.set($event)">
          @for (r of allRegions; track r) { <option [value]="r">{{ ('GUMS.REGION.' + r) | translate }}</option> }
        </select>
      </label>

      <fieldset class="field">
        <legend>{{ 'GUMS.STATE' | translate }}</legend>
        <div class="seg" role="radiogroup">
          @for (c of conditions; track c) {
            <button type="button" role="radio" [attr.aria-checked]="condition() === c" [attr.data-state]="c"
              [class.on]="condition() === c" (click)="setCondition(c)">{{ ('GUMS.CONDITION.' + c) | translate }}</button>
          }
        </div>
      </fieldset>

      @if (condition() === 'PERIODONTITIS') {
        <label class="field">
          <span>{{ 'GUMS.STAGE' | translate }}</span>
          <select class="control" name="stage" [ngModel]="stage()" (ngModelChange)="stage.set($event)">
            <option [ngValue]="null">{{ 'GUMS.STAGE_UNSPECIFIED' | translate }}</option>
            @for (n of stages; track n) { <option [ngValue]="n">{{ 'GUMS.STAGE_N' | translate: { n: n } }}</option> }
          </select>
        </label>
      }

      <label class="field">
        <span>{{ 'GUMS.DATE' | translate }}</span>
        <input class="control" type="date" name="date" [max]="today" [(ngModel)]="assessedOn" />
      </label>
      <label class="field">
        <span>{{ 'GUMS.NOTE' | translate }}</span>
        <input class="control" type="text" name="note" maxlength="500" [(ngModel)]="note"
          [placeholder]="'GUMS.NOTE_PLACEHOLDER' | translate" />
      </label>
      <button type="submit" class="save" [disabled]="!condition() || saving()">{{ 'GUMS.SAVE' | translate }}</button>
    </form>

    <section class="history">
      <h3>{{ 'GUMS.HISTORY' | translate }}</h3>
      @if (earlier().length) {
        <ul>
          @for (a of earlier(); track a.id) {
            <li [attr.data-state]="a.condition">
              <span class="h-date">{{ a.assessedOn | date: 'mediumDate' }}</span>
              <span class="h-region">{{ ('GUMS.REGION.' + a.region) | translate }}</span>
              <span class="h-state">
                {{ ('GUMS.CONDITION.' + a.condition) | translate }}
                @if (a.stage) { · {{ 'GUMS.STAGE_N' | translate: { n: a.stage } }} }
              </span>
              @if (a.note) { <span class="h-note">{{ a.note }}</span> }
            </li>
          }
        </ul>
      } @else {
        <p class="muted">{{ 'GUMS.NO_HISTORY' | translate }}</p>
      }
    </section>
  `,
  styles: [`
    :host { display: block; max-width: 44rem; }
    .head h2 { margin: 0; font-size: 1.125rem; }
    .sub { margin: .25rem 0 1rem; color: var(--text-muted); font-size: .875rem; }
    .map { display: flex; flex-direction: column; gap: .5rem; margin-bottom: 1.25rem; }
    /* The mouth is laid out as the dentist faces the patient, in every language: the patient's right on the left, like the chart. */
    .row { display: grid; grid-template-columns: repeat(3, 1fr); gap: .5rem; direction: ltr; }
    :host-context([dir='rtl']) .tile { direction: rtl; }
    .tile { display: flex; flex-direction: column; gap: .125rem; align-items: flex-start; text-align: start; padding: .625rem .75rem; border: 1px solid var(--border); border-inline-start-width: 4px; border-radius: .5rem; background: var(--surface, #fff); color: var(--text); cursor: pointer; font: inherit; }
    .tile.whole { width: 100%; }
    .tile.sel { box-shadow: 0 0 0 2px var(--focus-ring); }
    .tile:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
    .tile[data-state='HEALTHY'] { border-inline-start-color: var(--status-done); }
    .tile[data-state='GINGIVITIS'] { border-inline-start-color: var(--status-attention); }
    .tile[data-state='PERIODONTITIS'] { border-inline-start-color: var(--status-critical); }
    .tile[data-state='NONE'] { border-inline-start-color: var(--border-strong); }
    .tile-region { font-size: .75rem; font-weight: 700; color: var(--text-muted); }
    .tile-state { font-size: .875rem; font-weight: 600; }
    .tile[data-state='HEALTHY'] .tile-state { color: var(--status-done-text); }
    .tile[data-state='GINGIVITIS'] .tile-state { color: var(--status-attention-text); }
    .tile[data-state='PERIODONTITIS'] .tile-state { color: var(--status-critical-text); }
    .tile-date { font-size: .6875rem; color: var(--text-muted); }
    .muted { color: var(--text-muted); font-weight: 400; }
    .form { display: grid; gap: .75rem; padding: 1rem; border: 1px solid var(--border); border-radius: .75rem; background: var(--surface, #fff); }
    .form h3, .history h3 { margin: 0; font-size: .9375rem; }
    .field { display: flex; flex-direction: column; gap: .25rem; font-size: .8125rem; font-weight: 600; border: 0; padding: 0; margin: 0; }
    .field legend { padding: 0; margin-bottom: .25rem; }
    .control { padding: .4375rem .5rem; font: inherit; font-weight: 400; border: 1px solid var(--border-strong); border-radius: .375rem; background: var(--surface, #fff); color: var(--text); }
    .control:focus-visible, .seg button:focus-visible, .save:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 1px; }
    .seg { display: flex; flex-wrap: wrap; border: 1px solid var(--border-strong); border-radius: .375rem; overflow: hidden; align-self: flex-start; }
    .seg button { padding: .4375rem .875rem; font: inherit; font-size: .8125rem; font-weight: 500; border: 0; background: var(--surface, #fff); color: var(--text); cursor: pointer; }
    .seg button + button { border-inline-start: 1px solid var(--border-strong); }
    .seg button.on[data-state='HEALTHY'] { background: var(--status-done-tint); color: var(--status-done-text); font-weight: 700; }
    .seg button.on[data-state='GINGIVITIS'] { background: var(--status-attention-tint); color: var(--status-attention-text); font-weight: 700; }
    .seg button.on[data-state='PERIODONTITIS'] { background: var(--status-critical-tint); color: var(--status-critical-text); font-weight: 700; }
    .save { justify-self: start; padding: .5rem 1rem; font: inherit; font-weight: 600; border: 0; border-radius: .375rem; background: var(--action); color: var(--text-inverse); cursor: pointer; }
    .save:disabled { opacity: .5; cursor: not-allowed; }
    .history { margin-top: 1.25rem; }
    .history ul { list-style: none; margin: .5rem 0 0; padding: 0; display: flex; flex-direction: column; gap: .375rem; }
    .history li { display: grid; grid-template-columns: 7rem 1fr 1fr; gap: .5rem; padding: .375rem .625rem; border-inline-start: 3px solid var(--border-strong); background: var(--status-idle-tint); border-radius: .25rem; font-size: .8125rem; }
    .history li[data-state='HEALTHY'] { border-inline-start-color: var(--status-done); }
    .history li[data-state='GINGIVITIS'] { border-inline-start-color: var(--status-attention); }
    .history li[data-state='PERIODONTITIS'] { border-inline-start-color: var(--status-critical); }
    .h-date { color: var(--text-muted-on-tint); }
    .h-state { font-weight: 600; }
    .h-note { grid-column: 2 / -1; color: var(--text); }
    @media (max-width: 560px) { .row { grid-template-columns: 1fr; } .history li { grid-template-columns: 1fr; } .h-note { grid-column: auto; } }
  `],
})
export class GumStatusComponent {
  readonly patientId = input.required<string>();

  private readonly records = inject(ClinicalRecordService);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);

  protected readonly rows = MOUTH_ROWS;
  protected readonly allRegions = PERIO_REGIONS;
  protected readonly conditions = CONDITIONS;
  protected readonly stages = [1, 2, 3, 4];
  protected readonly today = new Date().toISOString().slice(0, 10);

  protected readonly region = signal<PerioRegion>('WHOLE_MOUTH');
  protected readonly condition = signal<PerioCondition | null>(null);
  protected readonly stage = signal<number | null>(null);
  protected assessedOn = this.today;
  protected note = '';
  protected readonly saving = signal(false);

  private readonly status = this.records.periodontal;
  private readonly currentByRegion = computed(() =>
    new Map<PerioRegion, PeriodontalAssessment>((this.status()?.current ?? []).map((a) => [a.region, a])));
  /** Everything but the assessments that are a region's current state. */
  protected readonly earlier = computed(() => {
    const current = new Set((this.status()?.current ?? []).map((a) => a.id));
    return (this.status()?.history ?? []).filter((a) => !current.has(a.id));
  });

  constructor() {
    effect(() => {
      const id = this.patientId();
      if (id) this.records.loadPeriodontal(id);
    });
  }

  protected stateOf(region: PerioRegion): PeriodontalAssessment | undefined {
    return this.currentByRegion().get(region);
  }

  protected setCondition(c: PerioCondition): void {
    this.condition.set(c);
    if (c !== 'PERIODONTITIS') this.stage.set(null);
  }

  protected save(): void {
    const condition = this.condition();
    if (!condition || this.saving()) return;
    this.saving.set(true);
    this.records.recordPeriodontal(this.patientId(), {
      region: this.region(),
      condition,
      source: 'manual',
      ...(condition === 'PERIODONTITIS' && this.stage() ? { stage: this.stage()! } : {}),
      ...(this.assessedOn ? { assessedOn: this.assessedOn } : {}),
      ...(this.note.trim() ? { note: this.note.trim() } : {}),
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.condition.set(null);
        this.stage.set(null);
        this.note = '';
        this.toast.success(this.translate.instant('GUMS.SAVED'));
      },
      error: (err) => {
        this.saving.set(false);
        console.error('Gum assessment failed', err);
        this.toast.error(this.translate.instant('GUMS.FAILED'));
      },
    });
  }
}
