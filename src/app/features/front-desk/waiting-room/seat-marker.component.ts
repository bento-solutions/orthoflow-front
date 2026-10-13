import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

/** "M", "F", or anything else (including nothing) for a patient whose gender was never recorded. */
export type SeatGender = string | null | undefined;

/**
 * The mark that says a seat is taken: a head and shoulders, three strokes, no face.
 *
 * <p>It is drawn over the furniture rather than inside it, so the same bench renders
 * identically whether anybody is sitting on it, and so the glyph can stay upright while
 * the module under it is turned.
 *
 * <p>Colour carries gender because that is what the room is read for at a glance — blue,
 * pink, or a neutral grey when it is not recorded. Neutral is a real state, not a
 * fallback to male.
 */
@Component({
  selector: 'g[appWrSeatMarker]',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg:g [attr.class]="'marker tone-' + tone">
      <svg:circle class="halo" [attr.r]="12" />
      <svg:circle class="head" [attr.cy]="-3.5" [attr.r]="4.2" />
      <svg:path class="body" d="M-6.4 7.2a6.4 6.4 0 0 1 12.8 0" />
    </svg:g>
  `,
  styles: [
    `
      .halo {
        fill: rgb(var(--ink-0, 255 255 255) / 0.92);
        stroke: none;
      }
      .head,
      .body {
        fill: none;
        stroke-width: 1.6;
        stroke-linecap: round;
        vector-effect: non-scaling-stroke;
      }
      .tone-male .head,
      .tone-male .body {
        stroke: rgb(37 99 235);
      }
      .tone-male .halo {
        fill: rgb(219 234 254 / 0.95);
      }
      .tone-female .head,
      .tone-female .body {
        stroke: rgb(219 39 119);
      }
      .tone-female .halo {
        fill: rgb(252 231 243 / 0.95);
      }
      .tone-neutral .head,
      .tone-neutral .body {
        stroke: rgb(var(--ink-600));
      }
      .tone-neutral .halo {
        fill: rgb(var(--ink-100) / 0.95);
      }
    `,
  ],
})
export class SeatMarkerComponent {
  @Input() gender: SeatGender;

  protected get tone(): 'male' | 'female' | 'neutral' {
    const g = (this.gender ?? '').trim().toUpperCase();
    return g === 'M' ? 'male' : g === 'F' ? 'female' : 'neutral';
  }
}
