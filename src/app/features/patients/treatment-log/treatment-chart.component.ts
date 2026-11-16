import { formatDate } from '../../../core/utils/format';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { PassportChartEntry, PassportChartUse, TreatmentPassport } from '../../../core/api/contract';
import { findingLabel } from '../../../core/clinical/finding-options';
import { surfaceShorthand } from '../../../core/clinical/tooth-surfaces';
import { FAMILY_PAINT, ToothStatusFamily, TREATMENT_PLAN_INK, PLANNED_PAINT, odontogramPatternDefs } from '../../../core/clinical/tooth-status';
import { FindingKind, ToothFinding } from '../../../core/models/clinical-record.model';
import { DentalChartType, ToothState, ToothStatus } from '../../../core/models/patient.model';
import { DentalChartComponent } from '../../dental-chart/dental-chart.component';

/** How a legend symbol paints: which fill, and which ink around it. */
function swatchStyle(entry: Pick<PassportChartEntry, 'group' | 'symbol'>): { fill: string; stroke: string; dash: string | null; width: number } {
  const symbol = entry.symbol ?? '';
  const family: Exclude<ToothStatusFamily, 'sound'> = entry.group === 'DONE' ? 'existing' : entry.group === 'ABSENT' ? 'absent' : 'condition';
  const paint = FAMILY_PAINT[family];
  switch (symbol) {
    case 'ring': return { fill: 'transparent', stroke: TREATMENT_PLAN_INK.COMPLETED, dash: null, width: 2.2 };
    case 'dashed': return { fill: 'transparent', stroke: PLANNED_PAINT.ink, dash: '3 2', width: 2 };
    case 'dot': return { fill: 'transparent', stroke: '#334155', dash: null, width: 1 };
    case 'solid': return { fill: paint.ground, stroke: paint.ink, dash: null, width: 1.4 };
    default: return { fill: `url(#odo-${family}-${symbol})`, stroke: paint.ink, dash: null, width: 1.4 };
  }
}

interface LegendRow {
  readonly entry: PassportChartEntry;
  readonly label: string;
  readonly uses: readonly { readonly teeth: string; readonly detail: string }[];
  readonly teeth: readonly string[];
}

const GROUP_ORDER = ['DONE', 'CONDITION', 'PLANNED', 'WATCH', 'ABSENT'];

/**
 * The dental chart in the treatment summary: the 2D drawing, and a legend that says what was
 * administered, on which teeth, when and by whom. Each thing recorded has a letter, carried by
 * the teeth it concerns, so either can be read against the other; pointing at a line picks out
 * its teeth. It shows the passport's own data, so it is what the printed document will say.
 */
@Component({
  selector: 'app-treatment-chart',
  standalone: true,
  imports: [TranslateModule, DentalChartComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (chart(); as c) {
      <div class="layout">
        <div class="drawing">
          <div class="sides" aria-hidden="true">
            <span>{{ 'DENTAL_3D.PATIENT_RIGHT' | translate }}</span>
            <span>{{ 'DENTAL_3D.PATIENT_LEFT' | translate }}</span>
          </div>
          <app-dental-chart
            [chartType]="dentition()"
            [teeth]="teeth()"
            [findings]="findings()"
            [interactive]="false"
            [summary]="true"
            [toothKeys]="keys()"
            [toothNotes]="notes()"
            [doneTeeth]="doneTeeth()"
            [highlightTeeth]="highlighted()"
          />
        </div>

        <div class="legend">
          <h3>{{ 'TREATMENT_CHART.LEGEND' | translate }}</h3>
          <!-- The legend's patterns, for swatches shown before the chart's own have been painted. -->
          <svg class="defs" aria-hidden="true" width="0" height="0"><g [innerHTML]="patternDefs"></g></svg>
          @for (group of groups(); track group.key) {
            <section class="group">
              <h4 [attr.data-group]="group.key">{{ ('TREATMENT_CHART.GROUP.' + group.key) | translate }}</h4>
              <ul>
                @for (row of group.rows; track row.entry.key) {
                  <li (mouseenter)="highlighted.set(row.teeth)" (mouseleave)="highlighted.set([])"
                      (focusin)="highlighted.set(row.teeth)" (focusout)="highlighted.set([])" tabindex="0">
                    <span class="key">{{ row.entry.key }}</span>
                    <svg class="swatch" viewBox="0 0 16 16" aria-hidden="true">
                      <rect x="1.5" y="1.5" width="13" height="13" rx="2" fill="#ffffff" />
                      <rect x="1.5" y="1.5" width="13" height="13" rx="2"
                        [attr.fill]="swatch(row.entry).fill" [attr.stroke]="swatch(row.entry).stroke"
                        [attr.stroke-width]="swatch(row.entry).width" [attr.stroke-dasharray]="swatch(row.entry).dash" />
                      @if (row.entry.symbol === 'dot') { <circle cx="8" cy="8" r="3.2" [attr.fill]="dotColour" /> }
                    </svg>
                    <div class="text">
                      <span class="what">{{ row.label }}</span>
                      @for (use of row.uses; track $index) {
                        <span class="where"><b>{{ use.teeth }}</b>@if (use.detail) { <span> · {{ use.detail }}</span> }</span>
                      }
                    </div>
                  </li>
                }
              </ul>
            </section>
          } @empty {
            <p class="muted">{{ 'TREATMENT_CHART.NOTHING' | translate }}</p>
          }
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .layout { display: grid; grid-template-columns: minmax(0, 1fr); gap: 1.25rem; }
    @media (min-width: 900px) {
      .layout { grid-template-columns: minmax(0, 24rem) minmax(0, 1fr); align-items: start; }
      /* Stays in view below the dossier's header while a long legend is read against it. */
      .drawing { position: sticky; top: 15rem; }
    }
    .drawing { min-width: 0; }
    .sides { display: flex; justify-content: space-between; font-size: var(--text-xs); font-weight: 600; color: var(--text-muted); direction: ltr; }
    .defs { position: absolute; }
    h3 { margin: 0 0 .5rem; font-size: var(--text-base); }
    h4 { margin: 0 0 .25rem; font-size: var(--text-xs); font-weight: 700; letter-spacing: .03em; text-transform: uppercase; color: var(--text-muted); }
    h4[data-group='DONE'] { color: rgb(var(--petrol-700)); }
    h4[data-group='CONDITION'] { color: rgb(var(--critical-700)); }
    h4[data-group='PLANNED'] { color: rgb(var(--caution-700)); }
    .group { margin-bottom: .875rem; }
    ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
    li { display: grid; grid-template-columns: 1.5rem 1.125rem minmax(0, 1fr); gap: .5rem; align-items: start; padding: .3125rem .375rem; border-radius: var(--radius-sm); }
    li:hover, li:focus-visible { background: var(--surface-hover); outline: none; }
    li:focus-visible { box-shadow: 0 0 0 2px var(--focus-ring); }
    .key { display: inline-flex; align-items: center; justify-content: center; height: 1.125rem; font-size: var(--text-xs); font-weight: 800; color: var(--text); }
    .swatch { width: 1.125rem; height: 1.125rem; }
    .text { display: flex; flex-direction: column; gap: .0625rem; min-width: 0; }
    .what { font-size: var(--text-base); font-weight: 600; color: var(--text); }
    .where { font-size: var(--text-xs); color: var(--text-muted); }
    .where b { font-weight: 700; color: var(--text); font-variant-numeric: tabular-nums; }
    .muted { margin: 0; font-size: var(--text-base); color: var(--text-muted); }
  `],
})
export class TreatmentChartComponent {
  readonly passport = input.required<TreatmentPassport>();

  private readonly translate = inject(TranslateService);

  protected readonly highlighted = signal<readonly string[]>([]);
  /**
   * Trusted on purpose, as in DentalChartComponent: built only from constants (no input reaches it),
   * and Angular's sanitiser keeps no SVG elements, so bound as a plain string the <pattern>s were
   * stripped and the swatches lost the hatching that tells statuses apart without colour (WCAG 1.4.1).
   */
  protected readonly patternDefs: SafeHtml = inject(DomSanitizer).bypassSecurityTrustHtml(
    odontogramPatternDefs().replace(/<\/?defs[^>]*>/g, ''));
  protected readonly dotColour = FAMILY_PAINT.condition.solid;

  protected readonly chart = computed(() => this.passport().chart);
  protected readonly dentition = computed<DentalChartType>(() => (this.chart()?.dentition === 'child' ? 'child' : 'adult'));

  protected readonly teeth = computed<Record<string, ToothState>>(() => {
    const out: Record<string, ToothState> = {};
    for (const tooth of this.chart()?.teeth ?? []) {
      if (tooth.fdi) out[tooth.fdi] = { id: tooth.fdi, status: (tooth.status ?? 'present') as ToothStatus };
    }
    return out;
  });

  /** What the drawing's surface marks and dashed outlines are made from, in the shape it reads. */
  protected readonly findings = computed<ToothFinding[]>(() => {
    const p = this.passport();
    const fromTeeth = (p.teeth ?? []).map((t) => ({
      fdi: t.fdi, findingCode: t.findingCode, kind: t.kind as FindingKind, surface: (t.surfaces ?? []).join('-') || undefined, status: 'ACTIVE' as const,
    }));
    const fromPlan = (p.planned ?? []).filter((w) => w.outcome === 'REQUIRED').flatMap((w) => (w.teeth ?? []).map((fdi) => ({
      fdi, findingCode: w.code, kind: 'TREATMENT_REQUIRED' as const, surface: (w.surfaces ?? []).join('-') || undefined, status: 'ACTIVE' as const,
    })));
    return [...fromTeeth, ...fromPlan] as ToothFinding[];
  });

  protected readonly keys = computed<Record<string, readonly string[]>>(() =>
    Object.fromEntries((this.chart()?.teeth ?? []).filter((t) => t.keys?.length).map((t) => [t.fdi!, t.keys!])));

  protected readonly doneTeeth = computed(() => (this.chart()?.teeth ?? []).filter((t) => t.done).map((t) => t.fdi!));

  protected readonly groups = computed(() => {
    const rows = (this.chart()?.legend ?? []).map((entry) => this.row(entry));
    return GROUP_ORDER
      .map((key) => ({ key, rows: rows.filter((r) => r.entry.group === key) }))
      .filter((group) => group.rows.length);
  });

  /** What the legend says of each tooth, in words: the letters beside it mean nothing to a screen reader. */
  protected readonly notes = computed(() => {
    const byTooth: Record<string, string[]> = {};
    for (const group of this.groups()) {
      for (const row of group.rows) {
        for (const fdi of row.teeth) (byTooth[fdi] ??= []).push(row.label);
      }
    }
    return byTooth;
  });

  protected swatch(entry: PassportChartEntry) {
    return swatchStyle(entry);
  }

  private row(entry: PassportChartEntry): LegendRow {
    return {
      entry,
      label: this.labelOf(entry),
      uses: (entry.uses ?? []).map((use) => this.useOf(use)),
      teeth: (entry.uses ?? []).flatMap((use) => use.teeth ?? []),
    };
  }

  private labelOf(entry: PassportChartEntry): string {
    if (entry.name) {
      const act = entry.actCode ? ` [${entry.actCode}]` : '';
      const state = entry.outcome === 'IN_PROGRESS' ? ` — ${this.translate.instant('TREATMENT_CHART.IN_PROGRESS')}` : '';
      return `${entry.name}${act}${state}`;
    }
    const code = entry.code ?? '';
    if (entry.outcome === 'SUSPECTED') return `${findingLabel(this.translate, code)} — ${this.translate.instant('TREATMENT_CHART.SUSPECTED')}`;
    if (entry.outcome !== 'TREATED') return findingLabel(this.translate, code);
    const doneKey = `TREATMENT_CHART.DONE.${code.toUpperCase()}`;
    const done = this.translate.instant(doneKey);
    return done !== doneKey ? done : `${findingLabel(this.translate, code)} — ${this.translate.instant('TREATMENT_CHART.TREATED')}`;
  }

  private useOf(use: PassportChartUse): { teeth: string; detail: string } {
    const shorthand = surfaceShorthand((use.surfaces ?? []).join('-'));
    const where = use.teeth?.length ? use.teeth.join(', ') : this.translate.instant('TREATMENT_CHART.WHOLE_MOUTH');
    const details: string[] = [];
    if (use.date) details.push(formatDate(use.date, 'date', this.translate.currentLang || 'fr'));
    if (use.origin === 'EXTERNAL') details.push(this.translate.instant('TOOTH_DETAIL.ELSEWHERE'));
    if (use.provider) details.push(use.provider);
    return { teeth: shorthand ? `${where} (${shorthand})` : where, detail: details.join(', ') };
  }
}
