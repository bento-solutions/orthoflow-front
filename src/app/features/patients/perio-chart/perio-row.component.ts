import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { valueAt } from '../../../core/clinical/perio/perio-data';
import {
  archWidth, furcationSitesOf, palatalFurcationsOf, probingSitesOf, slotsOf,
} from '../../../core/clinical/perio/perio-layout';
import { MOBILITY_SITE } from '../../../core/clinical/perio/perio-navigation';
import {
  Arch, BooleanMode, CellSite, Face, FurcationSite, ModeValue, PerioCell, PerioData, PerioMode, isBooleanMode,
} from '../../../core/clinical/perio/perio.model';
import { FLAG_COLORS, PERIO, ROW_HEIGHT, modeKey } from './perio-palette';
import { PerioTooltipService } from './perio-tooltip.service';

/** A click on a cell of a row: which tooth, which site, and the measurement the row is about. */
export interface PerioActivation {
  readonly tooth: string;
  readonly site: CellSite;
  readonly mode: PerioMode;
}

type Shape = 'flag' | 'pill' | 'mobility' | 'furcation' | 'palatal-furcation';

interface SiteView {
  readonly site: CellSite;
  readonly x: number;
  readonly on: boolean;
  readonly focused: boolean;
  readonly text: string;
  readonly small: boolean;
  readonly bold: boolean;
  readonly fill: string;
  readonly width: number;
  readonly height: number;
  readonly y: number;
  readonly tooth: string;
}

interface ToothView {
  readonly code: string;
  readonly filled: boolean;
  readonly sites: readonly SiteView[];
}

/**
 * One row of the chart: a measurement across the 16 teeth of an arch, as drawn on the paper chart. Flags
 * (bleeding, plaque, suppuration) are three dots per tooth; probing depth and recession are three cells
 * in a pill; mobility and furcation are one cell per tooth (furcation only where roots fork). Cells are
 * not tab stops: the chart is driven from the keyboard as a whole, and a click only chooses where.
 */
@Component({
  selector: 'app-perio-row',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="row">
      <div class="row-label">{{ 'PERIO.LABEL.' + labelKey() | translate }}</div>
      <div class="track" [style.width.px]="width()" [style.height.px]="height()">
        <svg [attr.width]="width()" [attr.height]="height()" [attr.viewBox]="'0 0 ' + width() + ' ' + height()"
             aria-hidden="true" focusable="false"
             (click)="onClick($event)" (pointerover)="onOver($event)" (pointerleave)="onLeave()">
          @switch (shape()) {
            @case ('flag') {
              @for (t of views(); track t.code) {
                <g>
                  @for (s of t.sites; track s.site) {
                    <g class="perio-bool-site" [attr.data-tooth]="t.code" [attr.data-site]="s.site">
                      <circle class="hit" [attr.cx]="s.x" cy="6" r="8" fill="transparent" stroke="transparent" stroke-width="2"/>
                      <circle class="perio-bool-halo" [attr.cx]="s.x" cy="6" r="7" [attr.fill]="flag().base" fill-opacity="0.12" pointer-events="none"/>
                      @if (s.focused) {
                        <circle [attr.cx]="s.x" cy="6" r="7" [attr.fill]="p.focusFill" [attr.stroke]="p.focusStroke" stroke-width="1"/>
                      }
                      @if (s.on) {
                        <circle class="perio-bool-dot dot-on" [attr.cx]="s.x" cy="6" r="4" [attr.fill]="flag().base" pointer-events="none"/>
                      } @else {
                        <circle class="perio-bool-dot" [attr.cx]="s.x" cy="6" r="3" fill="transparent" [attr.stroke]="flag().ring" stroke-width="1.25" pointer-events="none"/>
                      }
                    </g>
                  }
                </g>
              }
              <rect [attr.x]="midGapX()" y="0" width="12" height="12" fill="transparent"/>
            }
            @case ('pill') {
              @for (t of views(); track t.code) {
                <g>
                  <rect class="cells-pill" [class.cells-pill-filled]="t.filled" [attr.x]="t.sites[1].x - 18" y="2" width="36" height="16" rx="2"
                        [attr.fill]="t.filled ? pillTint() : p.emptyFill" [attr.stroke]="t.filled ? pillColor() : p.emptyStroke"
                        [attr.stroke-width]="t.filled ? 1.5 : 1"/>
                  @for (s of t.sites; track s.site) {
                    <g class="perio-cell" [attr.data-tooth]="t.code" [attr.data-site]="s.site">
                      <rect class="perio-cell-bg" [attr.x]="s.x - 8" y="2" width="16" height="16" rx="2" fill="transparent"/>
                      @if (s.focused) {
                        <rect [attr.x]="s.x - 8" y="2" width="16" height="16" rx="2" [attr.fill]="p.focusFill" [attr.stroke]="p.focusStroke" stroke-width="1"/>
                      }
                      <text [attr.x]="s.x" y="13" [attr.font-size]="s.small ? 7 : 9" [attr.font-weight]="s.bold ? 600 : 400"
                            text-anchor="middle" [attr.fill]="s.fill">{{ s.text }}</text>
                    </g>
                  }
                </g>
              }
            }
            @case ('mobility') {
              @for (t of views(); track t.code) {
                @for (s of t.sites; track s.site) {
                  <g class="perio-cell" [attr.data-tooth]="t.code" [attr.data-site]="s.site">
                    <rect class="perio-cell-bg" [attr.x]="s.x - 12" y="2" width="24" height="18" rx="4"
                          [attr.fill]="s.bold ? p.mobilityTint : p.emptyFill" [attr.stroke]="s.bold ? p.mobility : p.emptyStroke"
                          [attr.stroke-width]="s.bold ? 2 : 1" [attr.filter]="s.bold ? shadow : null"/>
                    @if (s.focused) {
                      <rect [attr.x]="s.x - 12" y="2" width="24" height="18" rx="4" [attr.fill]="p.focusFill" [attr.stroke]="p.focusStroke" stroke-width="1"/>
                    }
                    <text [attr.x]="s.x" y="16" font-size="11" [attr.font-weight]="s.bold ? 600 : 400" text-anchor="middle" [attr.fill]="s.fill">{{ s.text }}</text>
                  </g>
                }
              }
            }
            @case ('furcation') {
              @for (t of views(); track t.code) {
                @for (s of t.sites; track s.site) {
                  <g class="perio-cell" [attr.data-tooth]="t.code" [attr.data-site]="s.site">
                    <rect class="perio-cell-bg" [attr.x]="s.x - 12" y="2" width="24" height="18" rx="4"
                          [attr.fill]="s.bold ? p.furcationTint : p.emptyFill" [attr.stroke]="s.bold ? p.furcation : p.emptyStroke"
                          [attr.stroke-width]="s.bold ? 2 : 1" [attr.filter]="s.bold ? shadow : null"/>
                    @if (s.focused) {
                      <rect [attr.x]="s.x - 12" y="2" width="24" height="18" rx="4" [attr.fill]="p.focusFill" [attr.stroke]="p.focusStroke" stroke-width="1"/>
                    }
                    <text [attr.x]="s.x" y="16" font-size="11" [attr.font-weight]="s.bold ? 600 : 400" text-anchor="middle" [attr.fill]="s.fill">{{ s.text }}</text>
                  </g>
                }
              }
            }
            @case ('palatal-furcation') {
              @for (t of views(); track t.code) {
                @for (s of t.sites; track s.site) {
                  <g class="perio-cell" [attr.data-tooth]="t.code" [attr.data-site]="s.site">
                    <rect class="perio-cell-bg" [attr.x]="s.x - 10" y="4" width="20" height="16" rx="3"
                          [attr.fill]="s.bold ? p.furcationTint : p.emptyFill" [attr.stroke]="s.bold ? p.furcation : p.emptyStroke"
                          [attr.stroke-width]="s.bold ? 2 : 1" [attr.filter]="s.bold ? shadow : null"/>
                    @if (s.focused) {
                      <rect [attr.x]="s.x - 10" y="4" width="20" height="16" rx="3" [attr.fill]="p.focusFill" [attr.stroke]="p.focusStroke" stroke-width="1"/>
                    }
                    <text [attr.x]="s.x" y="15" font-size="10" [attr.font-weight]="s.bold ? 600 : 400" text-anchor="middle" [attr.fill]="s.fill">{{ s.text }}</text>
                  </g>
                }
              }
            }
          }
        </svg>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .row { display: flex; align-items: center; gap: 8px; }
    .row-label { width: 112px; flex-shrink: 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.025em; color: var(--perio-muted-fg); }
    .track { position: relative; }
    svg { display: block; vertical-align: middle; }
    .cells-pill-filled { filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.1)); }
    .perio-cell { cursor: pointer; transition: transform .14s ease-out; transform-box: fill-box; transform-origin: center; }
    .perio-cell-bg { transition: fill .14s ease-out, stroke .14s ease-out, opacity .14s ease-out; }
    .perio-cell:hover { transform: scale(1.08); }
    .perio-cell:hover .perio-cell-bg { fill: var(--perio-accent); stroke: rgba(9, 9, 11, 0.35); }
    .perio-bool-site { cursor: pointer; }
    .hit { cursor: pointer; }
    .perio-bool-dot { transition: transform .14s ease-out; transform-box: fill-box; transform-origin: center; }
    .perio-bool-halo { opacity: 0; transition: opacity .14s ease-out; }
    .perio-bool-site:hover .perio-bool-dot { transform: scale(1.25); }
    .perio-bool-site:hover .perio-bool-halo { opacity: 1; }
    .dot-on { animation: perio-dot-in 160ms ease-out; }
    @keyframes perio-dot-in { 0% { transform: scale(.4); opacity: 0; } 60% { transform: scale(1.15); opacity: 1; } to { transform: scale(1); opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .dot-on { animation: none; } .perio-cell, .perio-bool-dot { transition: none; } }
  `],
})
export class PerioRowComponent {
  readonly kind = input.required<PerioMode>();
  readonly arch = input.required<Arch>();
  readonly face = input.required<Face>();
  readonly data = input.required<PerioData>();
  /** The cell the keyboard is on, and the measurement it is in. */
  readonly cell = input<PerioCell | null>(null);
  readonly activeMode = input<PerioMode>('pocketDepth');

  readonly activate = output<PerioActivation>();

  private readonly tooltip = inject(PerioTooltipService, { optional: true });

  protected readonly p = PERIO;
  protected readonly shadow = 'drop-shadow(0 1px 3px rgba(0,0,0,0.1))';
  protected readonly labelKey = computed(() => modeKey(this.kind()));
  protected readonly width = computed(() => archWidth(this.arch()));
  /** Where the gap between the two halves of the arch starts: right after the eighth tooth. */
  protected readonly midGapX = computed(() => {
    const eighth = slotsOf(this.arch())[7];
    return eighth.x + eighth.width;
  });
  protected readonly flag = computed(() => FLAG_COLORS[(isBooleanMode(this.kind()) ? this.kind() : 'bleeding') as BooleanMode]);
  protected readonly pillColor = computed(() => (this.kind() === 'recession' ? PERIO.recession : PERIO.probing));
  protected readonly pillTint = computed(() => (this.kind() === 'recession' ? PERIO.recessionTint : PERIO.probingTint));

  protected readonly shape = computed<Shape>(() => {
    const kind = this.kind();
    if (isBooleanMode(kind)) return 'flag';
    if (kind === 'pocketDepth' || kind === 'recession') return 'pill';
    if (kind === 'mobility') return 'mobility';
    return this.arch() === 'upper' && this.face() === 'lingual' ? 'palatal-furcation' : 'furcation';
  });

  protected readonly height = computed(() => {
    switch (this.shape()) {
      case 'flag': return ROW_HEIGHT.flag;
      case 'pill': return ROW_HEIGHT.cells;
      case 'mobility': return ROW_HEIGHT.mobility;
      default: return ROW_HEIGHT.furcation;
    }
  });

  protected readonly views = computed<readonly ToothView[]>(() => {
    const kind = this.kind();
    const face = this.face();
    const data = this.data();
    const cell = this.cell();
    const focusedMode = this.activeMode() === kind;
    const focusedAt = (tooth: string, site: CellSite): boolean =>
      focusedMode && cell !== null && cell.tooth === tooth && cell.site === site;
    const shape = this.shape();
    const views: ToothView[] = [];

    for (const slot of slotsOf(this.arch())) {
      const code = slot.code;
      switch (shape) {
        case 'flag':
        case 'pill': {
          const sites = probingSitesOf(code, face);
          const siteViews = sites.map((site, i): SiteView => {
            const value = valueAt(data, code, kind, site);
            const on = !!value;
            const recession = kind === 'recession';
            const number = typeof value === 'number' ? value : null;
            return {
              site, tooth: code, x: slot.siteX[i], on, focused: focusedAt(code, site),
              text: number === null ? '—' : String(number),
              small: number !== null && Math.abs(number) >= 10,
              bold: on,
              fill: on ? (recession ? PERIO.recession : PERIO.probing) : PERIO.emptyText,
              width: 16, height: 16, y: 2,
            };
          });
          views.push({ code, filled: siteViews.some((s) => s.on), sites: siteViews });
          break;
        }
        case 'mobility': {
          const value = data[code]?.mobility ?? null;
          views.push({
            code, filled: !!value,
            sites: [{
              site: MOBILITY_SITE, tooth: code, x: slot.center, on: !!value, focused: focusedAt(code, MOBILITY_SITE),
              text: String(value ?? 0), small: false, bold: !!value,
              fill: value ? PERIO.mobilityText : PERIO.emptyText, width: 24, height: 18, y: 2,
            }],
          });
          break;
        }
        case 'furcation': {
          const available = furcationSitesOf(code);
          if (!available.length) break;
          const site: FurcationSite = available.includes(face as FurcationSite) ? (face as FurcationSite)
            : available.includes('buccal') ? 'buccal' : available.includes('lingual') ? 'lingual' : available[0];
          const grade = data[code]?.furcation[site] ?? null;
          views.push({
            code, filled: !!grade,
            sites: [{
              site, tooth: code, x: slot.center, on: !!grade, focused: focusedAt(code, site),
              text: grade ?? '0', small: false, bold: !!grade,
              fill: grade ? PERIO.furcationText : PERIO.emptyText, width: 24, height: 18, y: 2,
            }],
          });
          break;
        }
        case 'palatal-furcation': {
          const sites = palatalFurcationsOf(code);
          if (!sites.length) break;
          const count = sites.length;
          const total = count * 20 + (count - 1) * 4;
          views.push({
            code, filled: false,
            sites: sites.map((site, i): SiteView => {
              const grade = data[code]?.furcation[site] ?? null;
              return {
                site, tooth: code, x: slot.x + (slot.width - total) / 2 + i * 24 + 10, on: !!grade, focused: focusedAt(code, site),
                text: grade ?? '0', small: false, bold: !!grade,
                fill: grade ? PERIO.furcationText : PERIO.emptyText, width: 20, height: 16, y: 4,
              };
            }),
          });
          break;
        }
      }
    }
    return views;
  });

  private cellOf(event: Event): { tooth: string; site: CellSite; el: Element } | null {
    const el = (event.target as Element | null)?.closest('[data-site]');
    const tooth = el?.getAttribute('data-tooth');
    const site = el?.getAttribute('data-site');
    return el && tooth && site ? { tooth, site: site as CellSite, el } : null;
  }

  protected onClick(event: Event): void {
    const hit = this.cellOf(event);
    if (hit) this.activate.emit({ tooth: hit.tooth, site: hit.site, mode: this.kind() });
  }

  protected onOver(event: PointerEvent): void {
    if (!this.tooltip || isBooleanMode(this.kind())) return;
    const hit = this.cellOf(event);
    if (!hit) {
      this.tooltip.hide();
      return;
    }
    const rect = hit.el.getBoundingClientRect();
    const value: ModeValue = valueAt(this.data(), hit.tooth, this.kind(), hit.site);
    this.tooltip.show({
      tooth: hit.tooth, site: hit.site, mode: this.kind(), value, x: rect.left + rect.width / 2, y: rect.top,
    });
  }

  protected onLeave(): void {
    this.tooltip?.hide();
  }
}

