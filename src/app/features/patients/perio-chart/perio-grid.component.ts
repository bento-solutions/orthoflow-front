import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, OnInit, computed, effect, inject, input, output, signal, untracked, viewChild,
} from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { valueAt } from '../../../core/clinical/perio/perio-data';
import { ToothNumbering, toothLabel } from '../../../core/clinical/perio/perio-layout';
import { DigitBuffer, FURCATION_BY_KEY, InputRefusal, refuse } from '../../../core/clinical/perio/perio-input';
import { cellAfterModeChange, isSkipped, step } from '../../../core/clinical/perio/perio-navigation';
import {
  CellSite, ModeValue, PerioCell, PerioData, PerioMode, ToothStatusMap, isBooleanMode,
} from '../../../core/clinical/perio/perio.model';
import { PerioIconComponent } from './perio-icon.component';
import { PerioNumbersComponent, PerioStatusChange } from './perio-numbers.component';
import { modeKey } from './perio-palette';
import { PerioActivation, PerioRowComponent } from './perio-row.component';
import { PerioLocation, PerioTeethComponent } from './perio-teeth.component';
import { PerioTooltipService } from './perio-tooltip.service';

export interface PerioValueChange {
  readonly tooth: string;
  readonly mode: PerioMode;
  readonly site: CellSite;
  readonly value: ModeValue;
}

const FLAG_KEYS: Readonly<Record<string, PerioMode>> = { b: 'bleeding', p: 'plaque', s: 'suppuration' };
const ERROR_MS = 4000;

/**
 * The chart itself: both arches, every face, every measurement, on one sheet. The keyboard belongs to the
 * sheet as a whole. A click chooses a measurement and a site, then values are typed and the cursor walks
 * the mouth by itself, skipping teeth that are not there.
 */
@Component({
  selector: 'app-perio-grid',
  standalone: true,
  imports: [TranslateModule, PerioRowComponent, PerioTeethComponent, PerioNumbersComponent, PerioIconComponent],
  providers: [PerioTooltipService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sheet" #card tabindex="0" role="group" [attr.aria-label]="'PERIO.TITLE' | translate" (keydown)="onKeydown($event)">
      @if (error(); as e) {
        <div class="error-wrap"><div class="error" role="alert">{{ 'PERIO.VALIDATION.' + e.key | translate: e.params }}</div></div>
      }
      <div class="tip" role="note">
        <app-perio-icon name="info" [size]="16"/>
        <p>{{ 'PERIO.TIP' | translate }}</p>
      </div>
      <div class="chart">
        <div class="group flush">
          <app-perio-row kind="bleeding" arch="upper" face="buccal" [data]="data()" [cell]="cell()" [activeMode]="mode()" (activate)="activate($event)"/>
          <app-perio-row kind="plaque" arch="upper" face="buccal" [data]="data()" [cell]="cell()" [activeMode]="mode()" (activate)="activate($event)"/>
          <app-perio-row kind="suppuration" arch="upper" face="buccal" [data]="data()" [cell]="cell()" [activeMode]="mode()" (activate)="activate($event)"/>
          <app-perio-row kind="mobility" arch="upper" face="buccal" [data]="data()" [cell]="cell()" [activeMode]="mode()" (activate)="activate($event)"/>
          <app-perio-row kind="furcation" arch="upper" face="buccal" [data]="data()" [cell]="cell()" [activeMode]="mode()" (activate)="activate($event)"/>
          <app-perio-row kind="pocketDepth" arch="upper" face="buccal" [data]="data()" [cell]="cell()" [activeMode]="mode()" (activate)="activate($event)"/>
          <app-perio-row kind="recession" arch="upper" face="buccal" [data]="data()" [cell]="cell()" [activeMode]="mode()" (activate)="activate($event)"/>
        </div>
        <div class="mt-3"><app-perio-teeth arch="upper" face="buccal" [data]="data()" [status]="toothStatus()" (locate)="locate($event)"/></div>
        <div class="mt-half"><app-perio-numbers arch="upper" [data]="data()" [status]="toothStatus()" [numbering]="numbering()" (statusChange)="statusChange.emit($event)"/></div>
        <div class="mt-half"><app-perio-teeth arch="upper" face="lingual" [data]="data()" [status]="toothStatus()" (locate)="locate($event)"/></div>
        <div class="h-2"></div>
        <div class="group">
          <app-perio-row kind="recession" arch="upper" face="lingual" [data]="data()" [cell]="cell()" [activeMode]="mode()" (activate)="activate($event)"/>
          <app-perio-row kind="pocketDepth" arch="upper" face="lingual" [data]="data()" [cell]="cell()" [activeMode]="mode()" (activate)="activate($event)"/>
          <app-perio-row kind="furcation" arch="upper" face="lingual" [data]="data()" [cell]="cell()" [activeMode]="mode()" (activate)="activate($event)"/>
          <app-perio-row kind="suppuration" arch="upper" face="lingual" [data]="data()" [cell]="cell()" [activeMode]="mode()" (activate)="activate($event)"/>
          <app-perio-row kind="plaque" arch="upper" face="lingual" [data]="data()" [cell]="cell()" [activeMode]="mode()" (activate)="activate($event)"/>
          <app-perio-row kind="bleeding" arch="upper" face="lingual" [data]="data()" [cell]="cell()" [activeMode]="mode()" (activate)="activate($event)"/>
        </div>
        <div class="rule"></div>
        <div class="group">
          <app-perio-row kind="bleeding" arch="lower" face="lingual" [data]="data()" [cell]="cell()" [activeMode]="mode()" (activate)="activate($event)"/>
          <app-perio-row kind="plaque" arch="lower" face="lingual" [data]="data()" [cell]="cell()" [activeMode]="mode()" (activate)="activate($event)"/>
          <app-perio-row kind="suppuration" arch="lower" face="lingual" [data]="data()" [cell]="cell()" [activeMode]="mode()" (activate)="activate($event)"/>
          <app-perio-row kind="furcation" arch="lower" face="lingual" [data]="data()" [cell]="cell()" [activeMode]="mode()" (activate)="activate($event)"/>
          <app-perio-row kind="pocketDepth" arch="lower" face="lingual" [data]="data()" [cell]="cell()" [activeMode]="mode()" (activate)="activate($event)"/>
          <app-perio-row kind="recession" arch="lower" face="lingual" [data]="data()" [cell]="cell()" [activeMode]="mode()" (activate)="activate($event)"/>
        </div>
        <div class="mt-2"><app-perio-teeth arch="lower" face="lingual" [data]="data()" [status]="toothStatus()" (locate)="locate($event)"/></div>
        <div class="mt-half"><app-perio-numbers arch="lower" [data]="data()" [status]="toothStatus()" [numbering]="numbering()" (statusChange)="statusChange.emit($event)"/></div>
        <div class="mt-half"><app-perio-teeth arch="lower" face="buccal" [data]="data()" [status]="toothStatus()" (locate)="locate($event)"/></div>
        <div class="group mt-2">
          <app-perio-row kind="recession" arch="lower" face="buccal" [data]="data()" [cell]="cell()" [activeMode]="mode()" (activate)="activate($event)"/>
          <app-perio-row kind="pocketDepth" arch="lower" face="buccal" [data]="data()" [cell]="cell()" [activeMode]="mode()" (activate)="activate($event)"/>
          <app-perio-row kind="furcation" arch="lower" face="buccal" [data]="data()" [cell]="cell()" [activeMode]="mode()" (activate)="activate($event)"/>
          <app-perio-row kind="mobility" arch="lower" face="buccal" [data]="data()" [cell]="cell()" [activeMode]="mode()" (activate)="activate($event)"/>
          <app-perio-row kind="suppuration" arch="lower" face="buccal" [data]="data()" [cell]="cell()" [activeMode]="mode()" (activate)="activate($event)"/>
          <app-perio-row kind="plaque" arch="lower" face="buccal" [data]="data()" [cell]="cell()" [activeMode]="mode()" (activate)="activate($event)"/>
          <app-perio-row kind="bleeding" arch="lower" face="buccal" [data]="data()" [cell]="cell()" [activeMode]="mode()" (activate)="activate($event)"/>
        </div>
      </div>
      <p class="sr-only" aria-live="polite">{{ announcement() }}</p>
    </div>

    @if (tooltip.tip(); as t) {
      <div class="tooltip" role="tooltip" [style.left.px]="t.x" [style.top.px]="t.y - 8">
        <div class="line">
          <span class="strong">{{ 'PERIO.LABEL.' + keyOf(t.mode) | translate }}</span>
          <span class="tooth-no">#{{ label(t.tooth) }}</span>
        </div>
        <div class="line">
          <span class="muted">{{ 'PERIO.SITE.' + t.site.toUpperCase() | translate }}</span>
          <span class="tt-mono">{{ valueText(t.mode, t.value) }}</span>
        </div>
        <div class="range">
          <div class="line">
            <span class="muted">{{ 'PERIO.TOOLTIP.RANGE' | translate }}</span>
            <span class="tt-mono plain">{{ 'PERIO.RANGE.' + keyOf(t.mode) | translate }}{{ hasUnit(t.mode) ? ' mm' : '' }}</span>
          </div>
          @if (t.mode === mode()) { <div class="tt-hint">{{ 'PERIO.HINT.' + keyOf(t.mode) | translate }}</div> }
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: block; container-type: inline-size; }
    /* 16px of paper around the 968px chart; where the screen is a little short of 1000px the margin
       gives way (down to 8px) before the sheet has to scroll. */
    .sheet { border-radius: 8px; background: #fff; padding: 16px max(8px, min(16px, calc((100cqw - 968px) / 2))); overflow-x: auto; outline: none; }
    .sheet:focus-visible { box-shadow: 0 0 0 2px var(--perio-ring); }
    p { margin: 0; }
    .error-wrap { margin-bottom: 12px; display: flex; justify-content: center; }
    .error { background: hsl(0 84.2% 60.2%); color: hsl(0 0% 98%); font-size: 12px; line-height: 16px; font-weight: 600; padding: 4px 12px;
             border-radius: 6px; box-shadow: 0 10px 15px -3px rgb(0 0 0 / .1), 0 4px 6px -4px rgb(0 0 0 / .1); }
    .tip { margin-bottom: 8px; display: flex; align-items: center; gap: 6px; font-size: 12px; line-height: 16px; color: var(--perio-muted-fg); }
    .tip p { line-height: 1.375; }
    .tip app-perio-icon { flex-shrink: 0; }
    .chart { display: flex; flex-direction: column; width: 100%; min-width: max-content; }
    .group { display: flex; flex-direction: column; row-gap: 2px; }
    .group.flush { row-gap: 0; }
    .mt-3 { margin-top: 12px; } .mt-2 { margin-top: 8px; } .mt-half { margin-top: 2px; } .h-2 { height: 8px; }
    .rule { height: 1px; width: 100%; background: var(--perio-muted); margin: 12px 0; }
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
    .tooltip { position: fixed; z-index: 60; transform: translate(-50%, -100%); min-width: 160px; box-sizing: content-box; pointer-events: none;
               padding: 8px 12px; border: 1px solid rgba(228, 228, 231, 0.6); border-radius: 8px; background: rgba(255, 255, 255, 0.95);
               backdrop-filter: blur(4px); font-size: 12px; line-height: 1.625; color: var(--perio-fg); display: flex; flex-direction: column; gap: 4px;
               box-shadow: 0 0 0 1px rgba(228, 228, 231, 0.05), 0 8px 16px -4px rgb(0 0 0 / .12), 0 4px 6px -2px rgb(0 0 0 / .08); }
    .line { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
    .strong { font-weight: 600; } .muted { color: var(--perio-muted-fg); }
    .tooth-no { font-size: 10px; line-height: 16px; text-transform: uppercase; letter-spacing: 0.025em; color: var(--perio-muted-fg); }
    .tt-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-weight: 500; }
    .tt-mono.plain { font-weight: 400; }
    .range { margin-top: 4px; padding-top: 6px; border-top: 1px solid rgba(228, 228, 231, 0.6); display: flex; flex-direction: column; gap: 2px; }
    .tt-hint { font-size: 10px; line-height: 16px; color: var(--perio-muted-fg); }
  `],
})
export class PerioGridComponent implements OnInit {
  readonly data = input.required<PerioData>();
  readonly toothStatus = input<ToothStatusMap>({});
  readonly numbering = input<ToothNumbering>('FDI');
  readonly readonly = input(false);

  readonly valueChange = output<PerioValueChange>();
  readonly statusChange = output<PerioStatusChange>();
  readonly modeChange = output<PerioMode>();

  protected readonly tooltip = inject(PerioTooltipService);
  private readonly translate = inject(TranslateService);
  private readonly card = viewChild.required<ElementRef<HTMLElement>>('card');

  readonly mode = signal<PerioMode>('pocketDepth');
  protected readonly cell = signal<PerioCell | null>(null);
  protected readonly error = signal<InputRefusal | null>(null);
  private errorTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly digits = new DigitBuffer((value, tooth, site, mode) => this.commit(value, tooth, site, mode));

  protected readonly announcement = computed(() => {
    const cell = this.cell();
    if (!cell) return '';
    const label = this.translate.instant('PERIO.LABEL.' + modeKey(this.mode()));
    const site = this.translate.instant('PERIO.SITE.' + cell.site.toUpperCase());
    return `${label} — ${toothLabel(cell.tooth, this.numbering())} — ${site}`;
  });

  constructor() {
    // A tooth that was just marked missing is no place for the cursor.
    effect(() => {
      const status = this.toothStatus();
      const cell = untracked(this.cell);
      if (cell && isSkipped(cell.tooth, status)) {
        this.cell.set(cellAfterModeChange(cell, untracked(this.mode), status));
      }
    });
    inject(DestroyRef).onDestroy(() => {
      this.digits.cancel();
      if (this.errorTimer) clearTimeout(this.errorTimer);
    });
  }

  ngOnInit(): void {
    this.cell.set(step(null, this.mode(), 'next', this.toothStatus()));
  }

  /** Puts the keyboard on the chart: after a chart is opened, or created, the clinician can type at once. */
  focus(): void {
    this.card().nativeElement.focus({ preventScroll: true });
  }

  protected keyOf = modeKey;
  protected label = (tooth: string): string => toothLabel(tooth, this.numbering());
  protected hasUnit = (mode: PerioMode): boolean => mode === 'pocketDepth' || mode === 'recession';

  protected valueText(mode: PerioMode, value: ModeValue): string {
    if (value === null) return '—';
    return this.hasUnit(mode) ? `${value} mm` : String(value);
  }

  // ── choosing where ─────────────────────────────────────────────────────

  private setMode(mode: PerioMode): void {
    if (mode === this.mode()) return;
    this.mode.set(mode);
    this.modeChange.emit(mode);
    this.cell.set(cellAfterModeChange(this.cell(), mode, this.toothStatus()));
  }

  protected activate(a: PerioActivation): void {
    if (this.readonly() || isSkipped(a.tooth, this.toothStatus())) return;
    this.digits.flush();
    this.setMode(a.mode);
    if (isBooleanMode(a.mode)) {
      const now = valueAt(this.data(), a.tooth, a.mode, a.site) === true;
      this.valueChange.emit({ tooth: a.tooth, mode: a.mode, site: a.site, value: !now });
    }
    this.cell.set({ tooth: a.tooth, site: a.site });
    this.error.set(null);
    this.focus();
  }

  protected locate(l: PerioLocation): void {
    if (this.readonly() || isSkipped(l.tooth, this.toothStatus())) return;
    this.digits.flush();
    this.cell.set({ tooth: l.tooth, site: l.site });
    this.focus();
  }

  private advance(direction: 'next' | 'prev'): void {
    const status = this.toothStatus();
    const next = step(this.cell(), this.mode(), direction, status) ?? cellAfterModeChange(this.cell(), this.mode(), status);
    if (next) this.cell.set(next);
  }

  // ── entering values ────────────────────────────────────────────────────

  private fail(refusal: InputRefusal): void {
    this.error.set(refusal);
    if (this.errorTimer) clearTimeout(this.errorTimer);
    this.errorTimer = setTimeout(() => this.error.set(null), ERROR_MS);
  }

  /** Writes a value where the clinician is, then moves on. Returns false when the value was refused. */
  private commit(value: ModeValue, tooth?: string, site?: CellSite, mode?: PerioMode): boolean {
    const cell = this.cell();
    const at = { tooth: tooth ?? cell?.tooth, site: site ?? cell?.site };
    const kind = mode ?? this.mode();
    if (!at.tooth || !at.site) return false;
    const refusal = refuse(value, kind, at.tooth, at.site);
    if (refusal) {
      this.fail(refusal);
      return false;
    }
    this.valueChange.emit({ tooth: at.tooth, mode: kind, site: at.site, value });
    this.error.set(null);
    this.advance('next');
    return true;
  }

  protected onKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    // Buttons and fields inside the sheet (a tooth number, the menu) keep their own keys.
    if (target !== this.card().nativeElement && target.closest('button, input, select, textarea, [role="option"]')) return;
    const cell = this.cell();
    if (!cell || this.readonly() || event.ctrlKey || event.metaKey || event.altKey) return;
    const mode = this.mode();

    if (event.key === 'Enter' || event.key === 'ArrowRight') {
      this.digits.flush();
      this.advance('next');
      event.preventDefault();
      return;
    }
    if (event.key === 'ArrowLeft') {
      this.digits.flush();
      this.advance('prev');
      event.preventDefault();
      return;
    }
    if (event.key === 'Backspace') {
      this.digits.cancel();
      const empty: ModeValue = isBooleanMode(mode) ? false : null;
      this.valueChange.emit({ tooth: cell.tooth, mode, site: cell.site, value: empty });
      this.advance('prev');
      event.preventDefault();
      return;
    }
    if (/^[0-9]$/.test(event.key)) {
      const digit = Number.parseInt(event.key, 10);
      if (mode === 'mobility') {
        this.commit(digit);
      } else if (mode === 'pocketDepth' || mode === 'recession') {
        this.digits.type(digit, cell.tooth, cell.site, mode);
      } else if (mode === 'furcation') {
        const grade = FURCATION_BY_KEY[digit];
        if (grade) this.commit(grade);
      }
      event.preventDefault();
      return;
    }
    if ((event.key === '-' || event.key === 'Minus') && mode === 'recession') {
      this.digits.cancel();
      this.commit(-1);
      event.preventDefault();
      return;
    }
    if (isBooleanMode(mode) && FLAG_KEYS[event.key.toLowerCase()] === mode) {
      this.commit(valueAt(this.data(), cell.tooth, mode, cell.site) !== true);
      event.preventDefault();
    }
  }
}
