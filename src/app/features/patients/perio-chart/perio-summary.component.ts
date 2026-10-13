import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { PerioSummary } from '../../../core/clinical/perio/perio.model';

interface Figure {
  readonly label: string;
  readonly help: string;
  readonly value: string;
}

const percent = (value: number | null): string => (value === null || Number.isNaN(value) ? '—' : `${value.toFixed(1)}%`);
const millimetres = (value: number | null): string => (value === null || Number.isNaN(value) ? '—' : `${value.toFixed(1)} mm`);

/** The figures a periodontist reads off a chart, kept up to date as it is filled in. */
@Component({
  selector: 'app-perio-summary',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="sum-card" [attr.aria-label]="'PERIO.SUMMARY.TITLE' | translate">
      <header>
        <div>
          <h3 class="title">{{ 'PERIO.SUMMARY.TITLE' | translate }}</h3>
          <p class="description">{{ 'PERIO.SUMMARY.SUBTITLE' | translate }}</p>
        </div>
        @if (live()) {
          <span class="live"><span class="pulse" aria-hidden="true"></span>{{ 'PERIO.SUMMARY.LIVE' | translate }}</span>
        }
      </header>
      <div class="content">
        <div class="grid">
          @for (f of top(); track f.label) {
            <div class="figure">
              <p class="fig-label">{{ f.label | translate }}</p>
              <p class="value">{{ f.value }}</p>
              <p class="help">{{ f.help | translate }}</p>
            </div>
          }
        </div>
        <div class="grid">
          @for (f of bottom(); track f.label) {
            <div class="figure">
              <p class="fig-label">{{ f.label | translate }}</p>
              <p class="value">{{ f.value }}</p>
              <p class="help">{{ f.help | translate }}</p>
            </div>
          }
        </div>
      </div>
    </section>
  `,
  styles: [`
    :host { display: block; }
    p, h3 { margin: 0; }
    .sum-card { border: 1px solid var(--perio-border); border-radius: 8px; background: #fff; color: var(--perio-fg);
                box-shadow: 0 1px 6px 0 rgba(0, 0, 0, 0.1); }
    header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding: 24px 24px 16px; }
    .title { font-size: 16px; line-height: 24px; font-weight: 600; letter-spacing: -0.025em; color: var(--perio-fg); }
    .description { margin-top: 4px; font-size: 14px; line-height: 20px; color: var(--perio-muted-fg); }
    .live { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; line-height: 16px; color: var(--perio-muted-fg); }
    .pulse { width: 6px; height: 6px; border-radius: 9999px; background: #22c55e; }
    .content { display: flex; flex-direction: column; gap: 12px; padding: 0 24px 24px; }
    .grid { display: grid; gap: 12px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
    @media (max-width: 639px) { .grid { grid-template-columns: minmax(0, 1fr); } }
    .figure { border: 1px solid var(--perio-border); border-radius: 8px; background: rgba(244, 244, 245, 0.5); padding: 12px; }
    .fig-label { font-size: 12px; line-height: 16px; color: var(--perio-muted-fg); }
    .value { margin-top: 4px; font-size: 18px; line-height: 28px; font-weight: 600; font-variant-numeric: tabular-nums; }
    .help { margin-top: 2px; font-size: 11px; line-height: 1.25; color: rgba(113, 113, 122, 0.7); }
  `],
})
export class PerioSummaryComponent {
  readonly summary = input.required<PerioSummary>();
  readonly live = input(true);

  protected readonly top = computed<readonly Figure[]>(() => {
    const s = this.summary();
    return [
      { label: 'PERIO.SUMMARY.BLEEDING', help: 'PERIO.SUMMARY.BLEEDING_HELP', value: percent(s.bleedingPercent) },
      { label: 'PERIO.SUMMARY.PLAQUE', help: 'PERIO.SUMMARY.PLAQUE_HELP', value: percent(s.plaquePercent) },
      { label: 'PERIO.SUMMARY.SUPPURATION', help: 'PERIO.SUMMARY.SUPPURATION_HELP', value: percent(s.suppurationPercent) },
    ];
  });

  protected readonly bottom = computed<readonly Figure[]>(() => {
    const s = this.summary();
    return [
      { label: 'PERIO.SUMMARY.MEAN_DEPTH', help: 'PERIO.SUMMARY.MEAN_DEPTH_HELP', value: millimetres(s.meanPocketDepth) },
      { label: 'PERIO.SUMMARY.DEEP_SITES', help: 'PERIO.SUMMARY.DEEP_SITES_HELP', value: percent(s.pocketsAboveFourPercent) },
      { label: 'PERIO.SUMMARY.DEEPEST', help: 'PERIO.SUMMARY.DEEPEST_HELP', value: millimetres(s.deepestPocketDepth) },
    ];
  });
}
