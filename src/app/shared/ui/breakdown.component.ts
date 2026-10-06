import { Component, computed, input } from '@angular/core';
import { MoneyPipe } from '../pipes/money.pipe';

export interface BreakdownRow {
  label: string;
  amount: number;
}

/**
 * A list of amounts as proportional bars, largest first, for "by method", "by category",
 * "by practitioner". Plain markup rather than a chart, so the figures are text a screen
 * reader reads and the bars are only decoration.
 */
@Component({
  selector: 'app-breakdown',
  standalone: true,
  imports: [MoneyPipe],
  template: `
    <ul class="space-y-2.5">
      @for (row of sorted(); track row.label) {
        <li>
          <div class="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span class="truncate text-ink-700">{{ row.label }}</span>
            <span class="font-semibold tabular-nums text-ink-900">{{ row.amount | money }}</span>
          </div>
          <div class="h-1.5 overflow-hidden rounded-full bg-ink-100" aria-hidden="true">
            <div class="h-full rounded-full bg-petrol-500" [style.width.%]="share(row.amount)"></div>
          </div>
        </li>
      } @empty {
        <li class="text-sm text-ink-500">—</li>
      }
    </ul>
  `,
})
export class BreakdownComponent {
  readonly rows = input.required<BreakdownRow[]>();

  protected readonly sorted = computed(() => [...this.rows()].sort((a, b) => b.amount - a.amount));
  private readonly max = computed(() => Math.max(...this.rows().map(r => r.amount), 0));

  protected share(amount: number): number {
    const max = this.max();
    return max > 0 ? Math.max((amount / max) * 100, amount > 0 ? 2 : 0) : 0;
  }
}
