import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { AnalyticsApi, DoctorTime } from '../../core/services/analytics-api.service';
import { LanguageService } from '../../core/services/language.service';
import { PractitionerService } from '../../core/services/practitioner.service';
import { Period, formatMinutes, periodFor } from '../../core/utils/format';
import { loadable } from '../../core/utils/loadable';
import { NumPipe } from '../../shared/pipes/money.pipe';
import { PeriodPickerComponent } from '../../shared/ui/period-picker.component';

/** The appointments the figures are based on, as a share: how much of the data was usable. */
export function usableShare(quality: { considered: number; valid: number }): number {
  return quality.considered > 0 ? Math.round((quality.valid / quality.considered) * 100) : 100;
}

/**
 * How long doctors really spend in the chair, per doctor and per kind of appointment, from the
 * moments staff mark "in the chair" and "finished". Appointments with a missing, reversed or
 * implausible time are left out of the averages and counted in the data-quality panel, so a
 * figure is never quietly built from bad timestamps.
 */
@Component({
  selector: 'app-doctor-time',
  standalone: true,
  imports: [FormsModule, TranslateModule, NumPipe, PeriodPickerComponent],
  template: `
    <div class="mb-4 flex flex-wrap items-end gap-3">
      <app-period-picker [value]="period()" (valueChange)="period.set($event)" [presets]="presets" />
      <label class="field w-auto"><span class="label">{{ 'COMMON.PRACTITIONER' | translate }}</span>
        <select class="select w-auto" [ngModel]="practitionerId()" (ngModelChange)="practitionerId.set($event)">
          <option value="">{{ 'COMMON.ALL_PRACTITIONERS' | translate }}</option>
          @for (p of practitioners.active(); track p.id) { <option [value]="p.id">{{ p.displayName }}</option> }
        </select></label>
      <label class="field w-28"><span class="label">{{ 'ANA.TIME.MIN' | translate }}</span><input class="input" type="number" min="0" [ngModel]="minMinutes()" (ngModelChange)="minMinutes.set($event)" /></label>
      <label class="field w-28"><span class="label">{{ 'ANA.TIME.MAX' | translate }}</span><input class="input" type="number" min="1" [ngModel]="maxMinutes()" (ngModelChange)="maxMinutes.set($event)" /></label>
    </div>
    <p class="mb-4 text-sm text-ink-600">{{ 'ANA.TIME.HINT' | translate }}</p>

    @if (data.data(); as d) {
      <div [attr.aria-busy]="data.loading()">
        @for (block of blocks(); track block.key) {
          <section class="card mb-5">
            <div class="card-head"><h2 class="card-title">{{ block.title | translate }}</h2></div>
            <div class="table-scroll">
              <table class="data-table">
                <thead><tr>
                  <th scope="col">{{ block.firstColumn | translate }}</th>
                  <th scope="col" class="cell-num">{{ 'ANA.TIME.APPOINTMENTS' | translate }}</th><th scope="col" class="cell-num">{{ 'ANA.TIME.ACTIVE' | translate }}</th>
                  <th scope="col" class="cell-num">{{ 'ANA.TIME.AVERAGE' | translate }}</th><th scope="col" class="cell-num">{{ 'ANA.TIME.MEDIAN' | translate }}</th>
                  <th scope="col" class="cell-num">{{ 'ANA.TIME.PLANNED' | translate }}</th><th scope="col" class="cell-num">{{ 'ANA.TIME.WAIT' | translate }}</th>
                </tr></thead>
                <tbody>
                  @for (r of block.rows; track $index) {
                    <tr>
                      <td class="font-semibold">{{ block.key === 'doctor' ? r.practitionerName : (r.appointmentType || '—') }}@if (block.key === 'procedure' && r.practitionerName) { <span class="block text-xs font-normal text-ink-500">{{ r.practitionerName }}</span> }</td>
                      <td class="cell-num">{{ r.appointments | num: 0 }}</td><td class="cell-num">{{ minutes(r.activeMinutes) }}</td>
                      <td class="cell-num">{{ minutes(r.averageMinutes) }}</td><td class="cell-num">{{ minutes(r.medianMinutes) }}</td>
                      <td class="cell-num">{{ minutes(r.plannedAverageMinutes) }}</td><td class="cell-num">{{ minutes(r.averageWaitMinutes) }}</td>
                    </tr>
                  } @empty { <tr><td colspan="7" class="py-6 text-center text-ink-500">{{ 'ANA.TIME.EMPTY' | translate }}</td></tr> }
                </tbody>
              </table>
            </div>
          </section>
        }

        <section class="card" aria-labelledby="quality-title">
          <div class="card-head"><h2 id="quality-title" class="card-title">{{ 'ANA.TIME.QUALITY' | translate }}</h2>
            <span class="text-sm text-ink-600">{{ 'ANA.TIME.USABLE' | translate: { valid: d.quality.valid, considered: d.quality.considered, percent: share() } }}</span></div>
          <dl class="grid grid-cols-2 gap-x-6 gap-y-2 p-4 text-sm sm:grid-cols-3">
            @for (q of qualityRows(); track q.key) { <div><dt class="text-ink-500">{{ 'ANA.TIME.ISSUES.' + q.key | translate }}</dt><dd class="font-semibold tabular-nums" [class.text-critical-700]="q.count > 0">{{ q.count | num: 0 }}</dd></div> }
          </dl>
          <p class="px-4 pb-4 text-xs text-ink-500">{{ 'ANA.TIME.QUALITY_HINT' | translate }}</p>
        </section>
      </div>
    }
  `,
  styles: [`.card-title { font-size: var(--text-md); font-weight: 700; color: var(--text); }`],
})
export class DoctorTimeComponent {
  private readonly api = inject(AnalyticsApi);
  private readonly language = inject(LanguageService);
  protected readonly practitioners = inject(PractitionerService);

  protected readonly presets: ('week' | 'month' | 'lastMonth' | 'quarter' | 'year')[] = ['week', 'month', 'lastMonth', 'quarter', 'year'];
  protected readonly period = signal<Period>(periodFor('month'));
  protected readonly practitionerId = signal('');
  protected readonly minMinutes = signal<number | null>(null);
  protected readonly maxMinutes = signal<number | null>(null);
  protected readonly data = loadable<DoctorTime | null>(null);
  protected readonly minutes = formatMinutes;

  protected readonly share = computed(() => usableShare(this.data.data()?.quality ?? { considered: 0, valid: 0 }));
  protected readonly blocks = computed(() => {
    const d = this.data.data();
    return d ? [
      { key: 'doctor', title: 'ANA.TIME.BY_DOCTOR', firstColumn: 'COMMON.PRACTITIONER', rows: d.byPractitioner },
      { key: 'procedure', title: 'ANA.TIME.BY_PROCEDURE', firstColumn: 'ANA.TIME.PROCEDURE', rows: d.byProcedure },
    ] : [];
  });
  protected readonly qualityRows = computed(() => {
    const q = this.data.data()?.quality;
    return q ? [
      { key: 'missingEnd', count: q.missingEnd }, { key: 'missingStart', count: q.missingStart }, { key: 'tooShort', count: q.tooShort },
      { key: 'tooLong', count: q.tooLong }, { key: 'invalidOrder', count: q.invalidOrder }, { key: 'completedWithoutTimes', count: q.completedWithoutTimes },
    ] : [];
  });

  private readonly query = computed(() => ({
    ...this.period(), practitionerId: this.practitionerId() || undefined, minMinutes: this.minMinutes() ?? undefined, maxMinutes: this.maxMinutes() ?? undefined, lang: this.language.currentLang(),
  }));

  constructor() {
    effect(() => {
      const query = this.query();
      untracked(() => void this.data.load(() => this.api.doctorTime(query)));
    });
  }
}
