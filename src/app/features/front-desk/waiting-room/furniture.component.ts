import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { FurnitureKind, MAX_SEATS, MIN_SEATS, moduleSize, seatCentres } from './furniture-geometry';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
}

/**
 * One seating module drawn as architectural line art: thin grey outlines, no fills worth
 * the name, nothing that pretends to be a photograph of a chair.
 *
 * <p>Pure geometry in, SVG out. It draws itself at its natural size and leaves placement,
 * rotation and selection to whatever puts it on the plan, so the same component serves
 * the room canvas and the thumbnails in the picker.
 *
 * <p>The seats it draws come from {@link seatCentres}, the same function the canvas uses
 * to place patient markers — one source of truth, so a marker always lands on a cushion.
 */
@Component({
  selector: 'g[appWrFurniture]',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg:g [class.is-muted]="muted">
      @if (kind === 'SOFA') {
        <!-- One continuous shell, so the arms read as part of the same piece. -->
        <svg:rect class="shell" [attr.x]="0.5" [attr.y]="0.5" [attr.width]="size.w - 1" [attr.height]="size.h - 1" rx="6" />
        <svg:path class="line" [attr.d]="sofaBack" />
        <svg:path class="line" [attr.d]="sofaArms" />
        @for (c of cushions; track $index) {
          <svg:rect class="cushion" [attr.x]="c.x" [attr.y]="c.y" [attr.width]="c.w" [attr.height]="c.h" [attr.rx]="c.r" />
        }
      } @else {
        @for (b of backs; track $index) {
          <svg:rect class="shell" [attr.x]="b.x" [attr.y]="b.y" [attr.width]="b.w" [attr.height]="b.h" [attr.rx]="b.r" />
        }
        @for (s of pads; track $index) {
          <svg:rect class="cushion" [attr.x]="s.x" [attr.y]="s.y" [attr.width]="s.w" [attr.height]="s.h" [attr.rx]="s.r" />
        }
        <!-- The rail the chairs are bolted to, and its feet: what makes it one bench. -->
        <svg:path class="line" [attr.d]="benchFrame" />
      }
    </svg:g>
  `,
  styles: [
    `
      .shell,
      .cushion,
      .line {
        fill: none;
        stroke: rgb(var(--ink-400));
        stroke-width: 1.25;
        vector-effect: non-scaling-stroke;
      }
      .cushion {
        stroke: rgb(var(--ink-300));
      }
      .shell {
        fill: rgb(var(--ink-50) / 0.7);
      }
      .line {
        stroke-linecap: round;
      }
      .is-muted .shell,
      .is-muted .cushion,
      .is-muted .line {
        stroke: rgb(var(--ink-300));
      }
    `,
  ],
})
export class WaitingRoomFurnitureComponent {
  @Input({ required: true }) kind!: FurnitureKind;
  @Input({ required: true }) seats!: number;
  /** Lighter outlines, for the previews in the picker. */
  @Input() muted = false;

  protected get count(): number {
    return Math.min(MAX_SEATS, Math.max(MIN_SEATS, this.seats));
  }

  protected get size() {
    return moduleSize(this.kind, this.count);
  }

  /** Each chair gets its own back, which is what distinguishes a bench from a sofa. */
  protected get backs(): Rect[] {
    return seatCentres('BENCH', this.count).map(c => ({ x: c.x - 18, y: 0.5, w: 36, h: 8, r: 2 }));
  }

  protected get pads(): Rect[] {
    return seatCentres('BENCH', this.count).map(c => ({ x: c.x - 17, y: 11, w: 34, h: 27, r: 3 }));
  }

  protected get benchFrame(): string {
    const { w, h } = this.size;
    const feet = seatCentres('BENCH', this.count)
      .map(c => `M${c.x - 14} ${h - 4.5}v4 M${c.x + 14} ${h - 4.5}v4`)
      .join(' ');
    return `M1 ${h - 4.5}H${w - 1} ${feet}`;
  }

  protected get sofaBack(): string {
    const { w } = this.size;
    return `M1 10.5H${w - 1}`;
  }

  protected get sofaArms(): string {
    const { w, h } = this.size;
    return `M11.5 10.5V${h - 1} M${w - 11.5} 10.5V${h - 1}`;
  }

  protected get cushions(): Rect[] {
    return seatCentres('SOFA', this.count).map(c => ({ x: c.x - 18, y: 13, w: 36, h: 30, r: 4 }));
  }
}
