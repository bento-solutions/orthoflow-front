import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { AnalyticsApi, INCOME_GROUPS, IncomeStatement } from '../../core/services/analytics-api.service';
import { LanguageService } from '../../core/services/language.service';
import { Period, periodFor } from '../../core/utils/format';
import { loadable } from '../../core/utils/loadable';
import { MoneyPipe } from '../../shared/pipes/money.pipe';
import { ExportMenuComponent } from '../../shared/ui/export-menu.component';
import { PeriodPickerComponent } from '../../shared/ui/period-picker.component';

type Row = IncomeStatement['rows'][number];

/** How a row of the statement looks: headings and totals stand out, the result most of all, sub-lines are indented by their level. */
export function rowClass(row: Pick<Row, 'kind'>): string {
  return { HEADING: 'bg-ink-50 font-bold text-ink-900', LINE: 'text-ink-800', SUBTOTAL: 'font-bold text-ink-900', RESULT: 'bg-petrol-50 font-extrabold text-petrol-800' }[row.kind];
}

/** The amounts a row has, or none: a heading has no figures. */
export function amountsOf(row: { amounts: readonly number[] | null }): readonly number[] {
  return row.amounts ?? [];
}

/**
 * The Moroccan income statement (CPC): operating income, operating expenses, the result, grouped
 * by day, week, month or year. Fees are the money received (cash basis) unless "produced" is
 * chosen; retrocessions to collaborating doctors can be included or left out. The wording of the
 * lines comes from the server in the language of the screen, so the PDF and this table agree.
 */
@Component({
  selector: 'app-income-statement',
  standalone: true,
  imports: [FormsModule, TranslateModule, MoneyPipe, ExportMenuComponent, PeriodPickerComponent],
  template: `
    <div class="mb-4 flex flex-wrap items-end gap-3">
      <app-period-picker [value]="period()" (valueChange)="period.set($event)" [presets]="presets" />
      <label class="field w-auto"><span class="label">{{ 'ANA.INC.GROUP' | translate }}</span>
        <select class="select w-auto" [ngModel]="group()" (ngModelChange)="group.set($event)">
          @for (g of groups; track g) { <option [value]="g">{{ 'ANA.INC.GROUPS.' + g | translate }}</option> }
        </select></label>
      <label class="field w-auto"><span class="label">{{ 'ANA.INC.BASIS' | translate }}</span>
        <select class="select w-auto" [ngModel]="basis()" (ngModelChange)="basis.set($event)">
          <option value="COLLECTED">{{ 'ANA.INC.COLLECTED' | translate }}</option><option value="PRODUCED">{{ 'ANA.INC.PRODUCED' | translate }}</option>
        </select></label>
      <label class="flex items-center gap-1.5 pb-2 text-sm font-semibold text-ink-700"><input type="checkbox" [ngModel]="retro()" (ngModelChange)="retro.set($event)" /> {{ 'ANA.INC.RETRO' | translate }}</label>
      <app-export-menu class="ms-auto" path="/analytics/income-statement/export" [query]="exportQuery()" fallbackName="income-statement" />
    </div>

    @if (data.data(); as d) {
      <div class="table-wrap" [attr.aria-busy]="data.loading()"><div class="table-scroll">
        <table class="data-table">
          <thead><tr>
            <th scope="col" class="sticky start-0 bg-surface">{{ 'ANA.INC.LINE' | translate }}</th>
            @for (p of d.periods; track p.key) { <th scope="col" class="cell-num whitespace-nowrap">{{ p.label }}</th> }
            @if (d.periods.length > 1) { <th scope="col" class="cell-num">{{ 'COMMON.TOTAL' | translate }}</th> }
          </tr></thead>
          <tbody>
            @for (r of d.rows; track r.code) {
              <tr [class]="cls(r)">
                <th scope="row" class="sticky start-0 text-start font-[inherit]" [class.bg-surface]="r.kind === 'LINE' || r.kind === 'SUBTOTAL'" [style.padding-inline-start.rem]="0.75 + r.level * 1.25">{{ r.label }}</th>
                @for (a of amounts(r); track $index) { <td class="cell-num">{{ a | money }}</td> }
                @if (r.kind === 'HEADING') { <td [attr.colspan]="d.periods.length + (d.periods.length > 1 ? 0 : 0)"></td> }
                @if (d.periods.length > 1 && r.total !== null) { <td class="cell-num font-semibold">{{ r.total | money }}</td> }
              </tr>
            }
          </tbody>
        </table>
      </div></div>
      @if (d.notes.length) { <ul class="mt-3 space-y-1 text-xs text-ink-500">@for (n of d.notes; track $index) { <li>{{ n }}</li> }</ul> }
    }
  `,
})
export class IncomeStatementComponent {
  private readonly api = inject(AnalyticsApi);
  private readonly language = inject(LanguageService);

  protected readonly groups = INCOME_GROUPS;
  protected readonly cls = rowClass;
  protected readonly amounts = amountsOf;
  protected readonly presets: ('month' | 'lastMonth' | 'quarter' | 'year' | 'lastYear')[] = ['month', 'lastMonth', 'quarter', 'year', 'lastYear'];
  protected readonly period = signal<Period>(periodFor('year'));
  protected readonly group = signal<string>('MONTH');
  protected readonly basis = signal('COLLECTED');
  protected readonly retro = signal(true);
  protected readonly data = loadable<IncomeStatement | null>(null);

  private readonly query = computed(() => ({
    ...this.period(), group: this.group(), basis: this.basis(), includeRetrocessions: this.retro(), lang: this.language.currentLang(),
  }));
  protected readonly exportQuery = computed(() => {
    const { lang: _lang, ...rest } = this.query();
    return rest;
  });

  constructor() {
    effect(() => {
      const query = this.query();
      untracked(() => void this.data.load(() => this.api.incomeStatement(query)));
    });
  }
}
