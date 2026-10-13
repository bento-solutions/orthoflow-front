import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import {
  MID_GAP, TOOTH_HEIGHT, archWidth, dotXs, isMirrored, marginOf, marginY, pocketY, probingSitesOf, rulerLines,
  slotsOf, toothImageUrl,
} from '../../../core/clinical/perio/perio-layout';
import { Arch, Face, PerioData, ProbingSite, ToothStatusMap } from '../../../core/clinical/perio/perio.model';
import { PERIO } from './perio-palette';

/** A click on a tooth drawing, at one of its three sites of this face. */
export interface PerioLocation {
  readonly tooth: string;
  readonly site: ProbingSite;
}

interface DotView {
  readonly site: ProbingSite;
  readonly x: number;
  readonly margin: number | null;
  readonly pocket: number | null;
  readonly hitY: number;
}

interface ImplantView {
  readonly clip: string;
  readonly collar: { x: number; y: number; width: number; height: number };
  readonly body: { x: number; y: number; width: number; height: number };
  readonly tip: string;
  readonly threads: readonly number[];
  readonly left: number;
  readonly right: number;
}

interface ToothTile {
  readonly code: string;
  readonly width: number;
  readonly url: string;
  readonly mirrored: boolean;
  readonly absent: boolean;
  readonly implant: ImplantView | null;
  readonly dots: readonly DotView[];
  readonly gapAfter: boolean;
}

const COLLAR_HEIGHT = 5;
const TIP_LENGTH = 8;
const IMPLANT_FILL = '#cbd5e1';
const IMPLANT_COLLAR = '#94a3b8';
const IMPLANT_STROKE = '#64748b';

/**
 * The tooth drawings of one face of one arch, with what was probed drawn over them: a millimetre ruling
 * behind, the gum margin (red) and the bottom of the pocket (blue) joined from site to site across the
 * teeth, and a dot at each site. A missing tooth or a bridge pontic is faded out; an implant is drawn as
 * a crown on a fixture. A click on a site chooses it for the keyboard.
 */
@Component({
  selector: 'app-perio-teeth',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="row">
      <div class="spacer"></div>
      <div class="teeth" [style.width.px]="width()" [style.height.px]="height">
        <svg class="ruler" [attr.width]="width()" [attr.height]="height" [attr.viewBox]="'0 0 ' + width() + ' ' + height" aria-hidden="true">
          @for (y of ruler(); track y) {
            <line x1="0" [attr.x2]="width()" [attr.y1]="y" [attr.y2]="y" [attr.stroke]="p.ruler" stroke-width="1" opacity="0.1"/>
          }
        </svg>
        <svg class="lines" [attr.width]="width()" [attr.height]="height" [attr.viewBox]="'0 0 ' + width() + ' ' + height" aria-hidden="true">
          @for (line of lines().pocket; track $index) {
            <polyline [attr.points]="line" fill="none" [attr.stroke]="p.probing" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>
          }
          @for (line of lines().recession; track $index) {
            <polyline [attr.points]="line" fill="none" [attr.stroke]="p.recession" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.95"/>
          }
        </svg>
        <div class="tiles">
          @for (t of tiles(); track t.code) {
            <div class="tooth" [class.absent]="t.absent" [style.width.px]="t.width" [style.height.px]="height">
              <img [src]="t.url" alt="" aria-hidden="true" draggable="false" [class.mirrored]="t.mirrored"
                   [class.implant]="t.implant !== null" [style.clip-path]="t.implant ? t.implant.clip : null"/>
              @if (t.implant; as im) {
                <svg class="fixture" [attr.width]="t.width" [attr.height]="height" [attr.viewBox]="'0 0 ' + t.width + ' ' + height" aria-hidden="true">
                  <rect [attr.x]="im.body.x" [attr.y]="im.body.y" [attr.width]="im.body.width" [attr.height]="im.body.height" rx="3" ry="3" [attr.fill]="implantFill" [attr.stroke]="implantStroke" stroke-width="1"/>
                  <polygon [attr.points]="im.tip" [attr.fill]="implantFill" [attr.stroke]="implantStroke" stroke-width="1"/>
                  @for (y of im.threads; track y) {
                    <line [attr.x1]="im.left" [attr.x2]="im.right" [attr.y1]="y" [attr.y2]="y" [attr.stroke]="implantStroke" stroke-width="0.8" opacity="0.7"/>
                  }
                  <rect [attr.x]="im.collar.x" [attr.y]="im.collar.y" [attr.width]="im.collar.width" [attr.height]="im.collar.height" [attr.fill]="implantCollar" [attr.stroke]="implantStroke" stroke-width="1"/>
                </svg>
              }
              <svg class="dots" [attr.width]="t.width" [attr.height]="height" [attr.viewBox]="'0 0 ' + t.width + ' ' + height" aria-hidden="true" (click)="onClick($event)">
                @for (d of t.dots; track d.site) {
                  <g class="site" [attr.data-tooth]="t.code" [attr.data-site]="d.site">
                    <rect [attr.x]="d.x - 12" [attr.y]="d.hitY" width="24" height="32" fill="transparent"/>
                    @if (d.margin !== null) {
                      <circle [attr.cx]="d.x" [attr.cy]="d.margin" r="3.5" [attr.fill]="p.recession" stroke="#ffffff" stroke-width="1"/>
                    }
                    @if (d.pocket !== null) {
                      <circle [attr.cx]="d.x" [attr.cy]="d.pocket" r="3.5" [attr.fill]="p.probing" stroke="#ffffff" stroke-width="1"/>
                    }
                  </g>
                }
              </svg>
            </div>
            @if (t.gapAfter) { <div class="mid-gap" [style.width.px]="midGap"></div> }
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .row { display: flex; align-items: center; gap: 8px; }
    .spacer { width: 112px; flex-shrink: 0; }
    .teeth { position: relative; isolation: isolate; }
    .ruler, .lines, .dots, .fixture { position: absolute; top: 0; left: 0; }
    .ruler { z-index: 20; }
    .lines { z-index: 25; pointer-events: none; }
    .tiles { display: flex; flex-direction: row; }
    .tooth { position: relative; flex-shrink: 0; }
    .tooth img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; z-index: 10; user-select: none; pointer-events: none; }
    .tooth img.mirrored { transform: scaleX(-1); transform-origin: center; }
    .fixture { z-index: 20; pointer-events: none; }
    .dots { z-index: 30; }
    .site { cursor: default; }
    .absent { opacity: .4; filter: grayscale(1); pointer-events: none; }
    svg { display: block; }
  `],
})
export class PerioTeethComponent {
  readonly arch = input.required<Arch>();
  readonly face = input.required<Face>();
  readonly data = input.required<PerioData>();
  readonly status = input<ToothStatusMap>({});

  readonly locate = output<PerioLocation>();

  protected readonly p = PERIO;
  protected readonly height = TOOTH_HEIGHT;
  protected readonly midGap = MID_GAP;
  protected readonly implantFill = IMPLANT_FILL;
  protected readonly implantCollar = IMPLANT_COLLAR;
  protected readonly implantStroke = IMPLANT_STROKE;

  protected readonly width = computed(() => archWidth(this.arch()));
  private readonly margin = computed(() => marginOf(this.arch(), this.face()));

  /** The ruling behind the teeth: a line a millimetre, from the junction toward the root. */
  protected readonly ruler = computed(() =>
    rulerLines(this.margin().baseY, this.margin().direction, this.arch() === 'upper' && this.face() === 'lingual' ? 30 : 16));

  protected readonly tiles = computed<readonly ToothTile[]>(() => {
    const arch = this.arch();
    const face = this.face();
    const data = this.data();
    const status = this.status();
    const { baseY, direction } = this.margin();

    return slotsOf(arch).map((slot): ToothTile => {
      const code = slot.code;
      const tooth = data[code];
      const dotX = dotXs(slot.width);
      const dots = probingSitesOf(code, face).map((site, i): DotView => {
        const margin = marginY(baseY, direction, tooth?.recession[site] ?? null);
        return {
          site, x: dotX[i], margin,
          pocket: pocketY(baseY, direction, margin, tooth?.pocketDepth[site] ?? null),
          hitY: Math.min(baseY, baseY + direction * 12) - 16,
        };
      });
      const state = status[code];
      return {
        code, width: slot.width, url: toothImageUrl(code, arch, face), mirrored: isMirrored(code),
        absent: state === 'missing' || state === 'pontic',
        implant: state === 'implant' ? this.implantOf(slot.width, baseY, direction) : null,
        dots, gapAfter: slot.index === 7,
      };
    });
  });

  /** Joined from site to site along the arch; a site with no value breaks the line. */
  protected readonly lines = computed(() => {
    const data = this.data();
    const { baseY, direction } = this.margin();
    const face = this.face();
    const pocket: (string | null)[] = [];
    const recession: (string | null)[] = [];
    for (const slot of slotsOf(this.arch())) {
      const tooth = data[slot.code];
      probingSitesOf(slot.code, face).forEach((site, i) => {
        const margin = marginY(baseY, direction, tooth?.recession[site] ?? null);
        const bottom = pocketY(baseY, direction, margin, tooth?.pocketDepth[site] ?? null);
        pocket.push(bottom === null ? null : `${slot.siteX[i]},${bottom}`);
        recession.push(margin === null ? null : `${slot.siteX[i]},${margin}`);
      });
    }
    return { pocket: segments(pocket), recession: segments(recession) };
  });

  /** The fixture of an implant: collar at the gum, threaded body toward the root, rounded tip. */
  private implantOf(width: number, baseY: number, direction: 1 | -1): ImplantView {
    const rootward = -direction;
    const crownEnd = direction === 1 ? TOOTH_HEIGHT : 0;
    const rootEnd = direction === 1 ? 0 : TOOTH_HEIGHT;
    const clipTop = Math.min(baseY, crownEnd);
    const clipBottom = TOOTH_HEIGHT - Math.max(baseY, crownEnd);
    const center = width / 2;
    const collarWidth = Math.min(width * 0.38, 14);
    const bodyTop = baseY + rootward * COLLAR_HEIGHT;
    const room = Math.abs(rootEnd - bodyTop) - 4;
    const length = Math.max(28, room - 8);
    const bodyWidth = Math.min(width * 0.5, 18);
    const bodyEnd = bodyTop + rootward * length;
    const tipPoint = bodyEnd + rootward * TIP_LENGTH;
    const threadCount = Math.max(3, Math.floor(length / 10));
    const step = Math.abs(bodyEnd - bodyTop) / (threadCount + 1);
    return {
      clip: `inset(${clipTop}px 0px ${clipBottom}px 0px)`,
      collar: { x: center - collarWidth / 2, y: Math.min(baseY, bodyTop), width: collarWidth, height: COLLAR_HEIGHT },
      body: { x: center - bodyWidth / 2, y: Math.min(bodyTop, bodyEnd), width: bodyWidth, height: Math.abs(bodyEnd - bodyTop) },
      tip: `${center - bodyWidth / 2},${bodyEnd} ${center + bodyWidth / 2},${bodyEnd} ${center},${tipPoint}`,
      threads: Array.from({ length: threadCount }, (_, i) => bodyTop + rootward * step * (i + 1)),
      left: center - bodyWidth / 2 + 1,
      right: center + bodyWidth / 2 - 1,
    };
  }

  protected onClick(event: Event): void {
    const el = (event.target as Element | null)?.closest('[data-site]');
    const tooth = el?.getAttribute('data-tooth');
    const site = el?.getAttribute('data-site');
    if (tooth && site) this.locate.emit({ tooth, site: site as ProbingSite });
  }
}

/** Runs of consecutive points, each of at least two: a single point is a dot, not a line. */
function segments(points: readonly (string | null)[]): string[] {
  const result: string[] = [];
  let run: string[] = [];
  for (const point of points) {
    if (point) {
      run.push(point);
    } else {
      if (run.length >= 2) result.push(run.join(' '));
      run = [];
    }
  }
  if (run.length >= 2) result.push(run.join(' '));
  return result;
}

