import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { ApiErrors } from '../../core/services/api-error.service';
import { IntakeApi, SurveyReport } from '../../core/services/intake-api.service';
import { refreshOnLive } from '../../core/services/live-refresh';
import { Period, periodFor } from '../../core/utils/format';
import { loadable } from '../../core/utils/loadable';
import { NumPipe } from '../../shared/pipes/money.pipe';
import { PeriodPickerComponent } from '../../shared/ui/period-picker.component';

/** Five characters for a rating out of five: "★★★☆☆". The number is always beside it, since a glyph alone says little to a screen reader. */
export function stars(rating: number | null | undefined): string {
  const n = Math.max(0, Math.min(5, Math.round(rating ?? 0)));
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

/** Each rating's share of all answers, as whole percentages for bar widths. */
export function shares(distribution: readonly number[]): number[] {
  const total = distribution.reduce((s, n) => s + n, 0);
  return distribution.map(n => (total === 0 ? 0 : Math.round((n / total) * 100)));
}

/**
 * What patients said after their visit. The average and the spread of ratings first, then each
 * answer, with the ones who asked to be called back set apart until someone has dealt with them.
 */
@Component({
  selector: 'app-surveys',
  standalone: true,
  imports: [DatePipe, FormsModule, RouterLink, TranslateModule, NumPipe, PeriodPickerComponent],
  template: `
    <div class="anim-rise">
      <header class="page-head">
        <div>
          <h1 class="page-title">{{ 'NAV.SURVEYS' | translate }}</h1>
          <p class="page-sub">{{ 'SURV.SUBTITLE' | translate }}</p>
        </div>
      </header>

      <div class="mb-4 flex flex-wrap items-end gap-3">
        <app-period-picker [value]="period()" (valueChange)="period.set($event)" [presets]="presets" />
        <label class="field w-auto"><span class="label">{{ 'SURV.MAX_RATING' | translate }}</span>
          <select class="select w-auto" [ngModel]="maxRating()" (ngModelChange)="maxRating.set(+$event)">
            <option [ngValue]="5">{{ 'SURV.ANY' | translate }}</option>
            @for (r of [1, 2, 3, 4]; track r) { <option [ngValue]="r">{{ 'SURV.UP_TO' | translate: { rating: r } }}</option> }
          </select></label>
        <label class="flex items-center gap-1.5 pb-2 text-sm font-semibold text-ink-700"><input type="checkbox" [ngModel]="callMeOnly()" (ngModelChange)="callMeOnly.set($event)" /> {{ 'SURV.CALL_ME_ONLY' | translate }}</label>
        <label class="flex items-center gap-1.5 pb-2 text-sm font-semibold text-ink-700"><input type="checkbox" [ngModel]="unhandledOnly()" (ngModelChange)="unhandledOnly.set($event)" /> {{ 'SURV.UNHANDLED_ONLY' | translate }}</label>
      </div>

      @if (report.data(); as r) {
        <section class="mb-5 grid gap-3 md:grid-cols-3" [attr.aria-busy]="report.loading()">
          <div class="tile p-4"><p class="kpi-label">{{ 'SURV.RESPONSES' | translate }}</p><p class="kpi-value">{{ r.summary.responses | num: 0 }}</p></div>
          <div class="tile p-4"><p class="kpi-label">{{ 'SURV.AVERAGE' | translate }}</p>
            <p class="kpi-value">{{ r.summary.average | num: 1 }} <span class="text-base font-normal text-ink-500">/ 5</span></p><p class="text-lg text-caution-500" aria-hidden="true">{{ stars(r.summary.average) }}</p></div>
          <div class="tile p-4"><p class="kpi-label">{{ 'SURV.CALLBACKS' | translate }}</p><p class="kpi-value" [class.text-critical-700]="r.summary.callBacksPending > 0">{{ r.summary.callBacksPending | num: 0 }}</p></div>
        </section>
        <section class="card mb-5 p-4" [attr.aria-label]="'SURV.SPREAD' | translate">
          <ul class="space-y-1.5">
            @for (n of [5, 4, 3, 2, 1]; track n) {
              <li class="flex items-center gap-3 text-sm">
                <span class="w-14 shrink-0 tabular-nums text-ink-700">{{ n }} ★</span>
                <span class="h-2 flex-1 overflow-hidden rounded-full bg-ink-100" aria-hidden="true"><span class="block h-full rounded-full bg-caution-400" [style.width.%]="spread()[n - 1]"></span></span>
                <span class="w-16 shrink-0 text-end tabular-nums text-ink-600">{{ r.summary.distribution[n - 1] ?? 0 }} · {{ spread()[n - 1] }}%</span>
              </li>
            }
          </ul>
        </section>

        <ul class="card divide-y divide-ink-100">
          @for (row of r.rows; track row.id) {
            <li class="flex items-start gap-3 px-4 py-3">
              <div class="min-w-0 flex-1">
                <p class="flex flex-wrap items-center gap-x-2 text-sm">
                  <span class="text-lg text-caution-500" aria-hidden="true">{{ stars(row.rating) }}</span><span class="sr-only">{{ row.rating }} / 5</span>
                  @if (row.patientId) { <a class="font-semibold text-ink-900 no-underline hover:text-petrol-700" [routerLink]="['/patients', row.patientId]">{{ row.patientName }}</a> } @else { <span class="font-semibold">{{ row.patientName }}</span> }
                  @if (row.practitionerName) { <span class="text-ink-500">· {{ row.practitionerName }}</span> }
                  @if (row.callMe) { <span class="pill pill-critical pill-nodot">{{ 'SURV.CALL_ME' | translate }}</span> }
                </p>
                @if (row.comment) { <p class="mt-0.5 whitespace-pre-line text-sm text-ink-700">{{ row.comment }}</p> }
                <p class="text-2xs text-ink-500">{{ row.submittedAt | date: 'medium' }}@if (row.handledAt) { · {{ 'COM.INBOX.HANDLED_AT' | translate: { at: (row.handledAt | date: 'short') } }} }</p>
              </div>
              @if (row.callMe && !row.handledAt) {
                <button type="button" class="btn btn-secondary btn-sm shrink-0" [disabled]="busy()" (click)="handled(row.id)">{{ 'COM.INBOX.MARK_HANDLED' | translate }}</button>
              }
            </li>
          } @empty {
            <li class="py-8 text-center text-ink-500">{{ 'SURV.EMPTY' | translate }}</li>
          }
        </ul>
      }
    </div>
  `,
  styles: [`
    .kpi-label { font-size: var(--text-2xs); font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-muted); }
    .kpi-value { margin-top: 0.25rem; font-size: var(--text-2xl); font-weight: 800; color: var(--text); font-variant-numeric: tabular-nums; }
  `],
})
export class SurveysComponent {
  private readonly api = inject(IntakeApi);
  private readonly errors = inject(ApiErrors);

  protected readonly stars = stars;
  protected readonly presets: ('month' | 'lastMonth' | 'quarter' | 'year' | 'lastYear')[] = ['month', 'lastMonth', 'quarter', 'year', 'lastYear'];
  protected readonly period = signal<Period>(periodFor('quarter'));
  protected readonly maxRating = signal(5);
  protected readonly callMeOnly = signal(false);
  protected readonly unhandledOnly = signal(false);
  protected readonly report = loadable<SurveyReport | null>(null);
  protected readonly busy = signal(false);
  protected readonly spread = computed(() => shares(this.report.data()?.summary.distribution ?? []));

  private readonly query = computed(() => ({
    ...this.period(), maxRating: this.maxRating() < 5 ? this.maxRating() : undefined, callMeOnly: this.callMeOnly() || undefined, unhandledOnly: this.unhandledOnly() || undefined,
  }));

  constructor() {
    effect(() => {
      const query = this.query();
      untracked(() => void this.report.load(() => this.api.surveys(query)));
    });
    refreshOnLive(['survey'], () => void this.report.load(() => this.api.surveys(this.query())));
  }

  protected async handled(id: string): Promise<void> {
    this.busy.set(true);
    try {
      await this.api.surveyHandled(id);
      await this.report.load(() => this.api.surveys(this.query()));
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.busy.set(false);
    }
  }
}
