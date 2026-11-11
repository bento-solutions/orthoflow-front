import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { CockpitLine, CockpitModelService } from '../../../../core/consultation/cockpit-model.service';
import { ConsultationFocusService, StageView } from '../../../../core/consultation/consultation-focus.service';

/**
 * One section on the stage, read-only: what is **on record** for the patient,
 * then what **this consultation** adds, each new line with how it came to be
 * (dicté · proposé · à confirmer) and the words it was taken from. Deciding is
 * for the review; this is for seeing, while the hands are busy.
 */
@Component({
  selector: 'app-cockpit-section',
  standalone: true,
  imports: [TranslateModule, DecimalPipe, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="ck-sec" [attr.data-section]="view()">
      <h2 class="ck-sec-title">{{ 'COCKPIT.VIEW.' + view().toUpperCase() | translate }}</h2>
      @switch (view()) {
        @case ('allergies') {
          <ng-container *ngTemplateOutlet="twoLists; context: { record: model.allergiesOnRecord(), now: model.allergiesNow() }" />
        }
        @case ('history') {
          <ng-container *ngTemplateOutlet="twoLists; context: { record: model.historyOnRecord(), now: model.historyNow() }" />
        }
        @case ('treatments') {
          <ng-container *ngTemplateOutlet="twoLists; context: { record: model.treatmentsOnRecord(), now: model.treatmentsNow() }" />
        }
        @case ('findings') {
          <ng-container *ngTemplateOutlet="twoLists; context: { record: [], now: model.chartLines(), hideRecord: true }" />
        }
        @case ('plan') {
          @if (model.planNow().length === 0) { <p class="ck-empty">{{ 'COCKPIT.EMPTY_PLAN' | translate }}</p> }
          <ul class="ck-list">
            @for (line of model.planNow(); track line.key) {
              <li class="ck-row" [class.hl]="isHighlighted(line.key)" [attr.data-key]="line.key">
                <span class="ck-row-main">{{ line.label }}@if (line.teeth) { <span class="ck-muted"> · {{ line.teeth }}</span> }</span>
                <span class="ck-row-side">
                  @if (line.price !== null) { {{ line.price * (line.quantity || 1) | number: '1.0-0' }} DH }
                </span>
                <span class="ck-chip-status" [attr.data-status]="line.status">{{ 'COCKPIT.LINE.' + statusKey(line.status) | translate }}</span>
                @if (line.quote) { <span class="ck-quote">« {{ line.quote }} »</span> }
              </li>
            }
          </ul>
          @if (model.planNow().length) {
            <p class="ck-total">{{ 'COCKPIT.TOTAL' | translate }} : <strong>{{ model.planSummary().total | number: '1.0-0' }} DH</strong>
              @if (!model.planSummary().complete) { <span class="ck-muted"> · {{ 'COCKPIT.UNPRICED' | translate }}</span> }
            </p>
          }
        }
        @case ('appointment') {
          @if (model.appointment(); as a) {
            <p class="ck-big">{{ a.date }} · {{ a.time }}</p>
            <span class="ck-chip-status" data-status="dictated">{{ 'COCKPIT.LINE.SET' | translate }}</span>
          } @else if (model.appointmentSuggestion(); as s) {
            <p class="ck-big">{{ s.date ?? '' }} {{ s.time ?? '' }}</p>
            <span class="ck-chip-status" data-status="proposed">{{ 'COCKPIT.LINE.PROPOSED' | translate }}</span>
            @if (s.quote) { <p class="ck-quote">« {{ s.quote }} »</p> }
          } @else {
            <p class="ck-empty">{{ 'COCKPIT.EMPTY_APPOINTMENT' | translate }}</p>
          }
        }
        @case ('patient') {
          <dl class="ck-fields">
            @for (f of model.patientFields(); track f.name) {
              @if (f.record !== null || f.now !== null) {
                <div class="ck-field" [class.hl]="isHighlighted(f.name)">
                  <dt>{{ 'COCKPIT.FIELD.' + f.name.toUpperCase() | translate }}</dt>
                  <dd>
                    <span>{{ f.record ?? '—' }}</span>
                    @if (f.now !== null && f.now !== f.record) {
                      <span class="ck-new-value">→ {{ f.now }}</span>
                      <span class="ck-chip-status" [attr.data-status]="f.status">{{ 'COCKPIT.LINE.' + statusKey(f.status) | translate }}</span>
                    }
                  </dd>
                </div>
              }
            }
          </dl>
        }
        @case ('summary') {
          @if (model.complaint(); as complaint) {
            <h3 class="ck-sub">{{ 'COCKPIT.COMPLAINT' | translate }}</h3>
            <p>{{ complaint.text }}</p>
          }
          <h3 class="ck-sub">{{ 'COCKPIT.NOTES' | translate }}</h3>
          @if (model.noteLines().length === 0 && !model.complaint()) { <p class="ck-empty">{{ 'COCKPIT.EMPTY_SUMMARY' | translate }}</p> }
          <ul class="ck-list">
            @for (line of model.noteLines(); track line.key) {
              <li class="ck-row"><span class="ck-row-main">{{ line.label }}</span></li>
            }
          </ul>
          @if (model.mentions().length) {
            <h3 class="ck-sub">{{ 'COCKPIT.MENTIONS' | translate }}</h3>
            <ul class="ck-list">
              @for (m of model.mentions(); track m.quote) {
                <li class="ck-row"><span class="ck-row-main">{{ m.teeth ?? '' }} {{ m.finding }}</span><span class="ck-quote">« {{ m.quote }} »</span></li>
              }
            </ul>
          }
          <h3 class="ck-sub">{{ 'COCKPIT.VIEW.CHART' | translate }}</h3>
          <ul class="ck-list">
            @for (line of model.chartLines(); track line.key) {
              <li class="ck-row"><span class="ck-row-main">{{ line.label }}</span></li>
            }
          </ul>
        }
      }
    </section>

    <ng-template #twoLists let-record="record" let-now="now" let-hideRecord="hideRecord">
      @if (!hideRecord) {
        <h3 class="ck-sub">{{ 'COCKPIT.ON_RECORD' | translate }}</h3>
        @if (record.length === 0) { <p class="ck-empty">{{ 'COCKPIT.NONE_ON_RECORD' | translate }}</p> }
        <ul class="ck-list">
          @for (line of asLines(record); track line.key) {
            <li class="ck-row"><span class="ck-row-main">{{ line.label }}</span>@if (line.detail) { <span class="ck-muted"> · {{ line.detail }}</span> }</li>
          }
        </ul>
      }
      <h3 class="ck-sub">{{ 'COCKPIT.THIS_CONSULTATION' | translate }}</h3>
      @if (now.length === 0) { <p class="ck-empty">{{ 'COCKPIT.NOTHING_YET' | translate }}</p> }
      <ul class="ck-list">
        @for (line of asLines(now); track line.key) {
          <li class="ck-row" [class.hl]="isHighlighted(line.key)" [attr.data-key]="line.key">
            <span class="ck-row-main">{{ line.label }}</span>
            @if (line.detail) { <span class="ck-muted">{{ line.detail }}</span> }
            @if (line.status) { <span class="ck-chip-status" [attr.data-status]="line.status">{{ 'COCKPIT.LINE.' + statusKey(line.status) | translate }}</span> }
            @if (line.quote) { <span class="ck-quote">« {{ line.quote }} »</span> }
          </li>
        }
      </ul>
    </ng-template>
  `,
  styles: [`
    :host { display: block; }
    .ck-sec { padding: 1rem 1.25rem; }
    .ck-sec-title { margin: 0 0 .75rem; font-size: 1.25rem; font-weight: 800; color: rgb(var(--ink-900)); }
    .ck-sub { margin: 1rem 0 .375rem; font-size: .75rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: rgb(var(--ink-600)); }
    .ck-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .375rem; }
    .ck-row { display: flex; flex-wrap: wrap; align-items: baseline; gap: .25rem .5rem; padding: .5rem .625rem; border-radius: .5rem; background: rgb(var(--ink-50)); font-size: 1rem; color: rgb(var(--ink-900)); }
    .ck-row-main { font-weight: 600; }
    .ck-row-side { margin-inline-start: auto; font-variant-numeric: tabular-nums; font-weight: 700; }
    .ck-muted { color: rgb(var(--ink-600)); }
    .ck-quote { flex-basis: 100%; font-size: .8125rem; font-style: italic; color: rgb(var(--ink-600)); }
    .ck-chip-status { font-size: .75rem; font-weight: 700; padding: 0 .45rem; border-radius: 999px; background: rgb(var(--positive-100)); color: rgb(var(--positive-900)); }
    .ck-chip-status[data-status='proposed'] { background: rgb(var(--petrol-50)); color: rgb(var(--petrol-900)); }
    .ck-chip-status[data-status='to-confirm'] { background: rgb(var(--caution-100)); color: rgb(var(--caution-900)); }
    .hl { outline: 3px solid rgb(var(--positive-500)); outline-offset: 1px; animation: ck-flash 4s ease-out; }
    @keyframes ck-flash { from { background: rgb(var(--positive-100)); } to { background: rgb(var(--ink-50)); } }
    @media (prefers-reduced-motion: reduce) { .hl { animation: none; } }
    .ck-empty { color: rgb(var(--ink-600)); font-size: .9rem; margin: 0; }
    .ck-total { margin: .75rem 0 0; font-size: 1rem; }
    .ck-big { font-size: 1.5rem; font-weight: 800; margin: 0 0 .25rem; }
    .ck-fields { display: grid; grid-template-columns: minmax(8rem, auto) 1fr; gap: .375rem 1rem; margin: 0; }
    .ck-field { display: contents; }
    .ck-field dt { color: rgb(var(--ink-600)); font-size: .875rem; }
    .ck-field dd { margin: 0; display: flex; flex-wrap: wrap; gap: .375rem; align-items: baseline; font-weight: 600; }
    .ck-new-value { color: rgb(var(--petrol-800)); }
  `],
})
export class CockpitSectionComponent {
  protected readonly model = inject(CockpitModelService);
  private readonly focus = inject(ConsultationFocusService);

  readonly view = input.required<StageView>();

  private readonly highlighted = computed(() => {
    const highlight = this.focus.highlight();
    return highlight && highlight.view === this.view() ? highlight.itemKey ?? null : null;
  });

  protected isHighlighted(key: string): boolean {
    return this.highlighted() === key;
  }

  protected asLines(value: unknown): CockpitLine[] {
    return value as CockpitLine[];
  }

  protected statusKey(status: string | null): string {
    return (status ?? 'validated').replace('-', '_').toUpperCase();
  }
}
