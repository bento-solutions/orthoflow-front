import { Component, computed, input, model } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { Period, PeriodPreset, periodFor } from '../../core/utils/format';

const LABELS: Record<PeriodPreset, string> = {
  today: 'COMMON.TODAY',
  week: 'COMMON.THIS_WEEK',
  month: 'COMMON.THIS_MONTH',
  lastMonth: 'COMMON.LAST_MONTH',
  quarter: 'COMMON.THIS_QUARTER',
  year: 'COMMON.THIS_YEAR',
  lastYear: 'COMMON.LAST_YEAR',
};

/**
 * A from/to pair with the periods people actually ask for one press away. Two-way
 * bound: `<app-period-picker [(value)]="period" />`. A preset lights up only while
 * the dates still equal it, so editing a date by hand honestly un-selects it.
 */
@Component({
  selector: 'app-period-picker',
  standalone: true,
  imports: [TranslateModule],
  template: `
    <div class="flex flex-wrap items-end gap-3">
      <div class="seg" role="group" [attr.aria-label]="'COMMON.FILTER' | translate">
        @for (preset of presets(); track preset) {
          <button type="button" class="seg-item" [class.is-active]="active() === preset" [attr.aria-pressed]="active() === preset" (click)="choose(preset)">
            {{ labels[preset] | translate }}
          </button>
        }
      </div>
      <label class="field">
        <span class="label">{{ 'COMMON.FROM' | translate }}</span>
        <input type="date" class="input" [value]="value().from" [max]="value().to" (change)="edit('from', $any($event.target).value)" />
      </label>
      <label class="field">
        <span class="label">{{ 'COMMON.TO' | translate }}</span>
        <input type="date" class="input" [value]="value().to" [min]="value().from" (change)="edit('to', $any($event.target).value)" />
      </label>
    </div>
  `,
})
export class PeriodPickerComponent {
  readonly value = model.required<Period>();
  readonly presets = input<PeriodPreset[]>(['today', 'week', 'month', 'lastMonth', 'year']);
  protected readonly labels = LABELS;

  protected readonly active = computed<PeriodPreset | null>(() => {
    const { from, to } = this.value();
    return this.presets().find(p => {
      const range = periodFor(p);
      return range.from === from && range.to === to;
    }) ?? null;
  });

  protected choose(preset: PeriodPreset): void {
    this.value.set(periodFor(preset));
  }

  protected edit(side: 'from' | 'to', date: string): void {
    if (!date) {
      return;
    }
    const current = this.value();
    const next = { ...current, [side]: date };
    // Keep the pair ordered: moving "from" past "to" drags "to" along rather than producing an empty range.
    if (next.from > next.to) {
      next[side === 'from' ? 'to' : 'from'] = date;
    }
    this.value.set(next);
  }
}
