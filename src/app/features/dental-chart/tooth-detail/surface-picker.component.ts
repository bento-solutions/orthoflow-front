import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import {
  MAX_SURFACE_PARTS, SURFACE_ZONES, SURFACE_ZONE_PATH, SurfaceZone, ToothSurface,
  formatSurface, parseSurface, surfaceShorthand, surfaceZone, zoneSurface,
} from '../../../core/clinical/tooth-surfaces';

/**
 * Five-part drawing of a tooth the doctor taps to say which surfaces a finding
 * is on. The mesial side is drawn toward the midline for the tooth in hand, so
 * what is tapped is what the dentist sees on the chart.
 */
@Component({
  selector: 'app-surface-picker',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="picker">
      <svg viewBox="0 0 30 30" class="glyph" role="group" [attr.aria-label]="'TOOTH_DETAIL.SURFACE_PICKER' | translate">
        @for (zone of zones; track zone) {
          <path
            [attr.d]="paths[zone]"
            class="zone"
            [class.on]="selectedZones().has(zone)"
            role="button"
            tabindex="0"
            [attr.aria-pressed]="selectedZones().has(zone)"
            [attr.aria-label]="('SURFACE.' + surfaceName(zone).toUpperCase()) | translate"
            (click)="toggle(zone)"
            (keydown.enter)="toggle(zone); $event.preventDefault()"
            (keydown.space)="toggle(zone); $event.preventDefault()" />
        }
        <!-- Sides and centre are only named once, so the doctor can read what they tapped -->
        <text x="15" y="16.2" class="letter" text-anchor="middle">{{ centreLetter() }}</text>
      </svg>
      <div class="readout">
        <span class="shorthand" [attr.aria-live]="'polite'">{{ shorthand() || '—' }}</span>
        <span class="hint">
          @if (shorthand()) { {{ 'TOOTH_DETAIL.SURFACES_SELECTED' | translate }} } @else { {{ 'TOOTH_DETAIL.WHOLE_TOOTH' | translate }} }
        </span>
        @if (value()) {
          <button type="button" class="clear" (click)="clear()">{{ 'COMMON.CLEAR' | translate }}</button>
        }
      </div>
    </div>
  `,
  styles: [`
    .picker { display: flex; align-items: center; gap: .75rem; }
    .glyph { width: 5.5rem; height: 5.5rem; flex: none; }
    .zone {
      fill: var(--surface, #fff); stroke: var(--border-strong); stroke-width: .8; stroke-linejoin: round;
      cursor: pointer; transition: fill .12s;
    }
    .zone:hover { fill: var(--action-tint); }
    .zone.on { fill: var(--action); stroke: var(--action-hover); }
    .zone:focus-visible { outline: none; stroke: var(--focus-ring); stroke-width: 1.8; }
    .letter { font: 700 5px var(--font-sans); fill: var(--text-muted); pointer-events: none; }
    .readout { display: flex; flex-direction: column; gap: .125rem; align-items: flex-start; }
    .shorthand { font-size: 1.25rem; font-weight: 700; letter-spacing: .08em; color: var(--text); }
    .hint { font-size: .75rem; color: var(--text-muted); }
    .clear { font-size: .75rem; color: var(--action-text); background: none; border: 0; padding: 0; cursor: pointer; text-decoration: underline; }
  `],
})
export class SurfacePickerComponent {
  readonly fdi = input.required<string>();
  /** Compound surface in the server's form ("mesial-occlusal"), or null for the whole tooth. */
  readonly value = input<string | null>(null);
  readonly valueChange = output<string | null>();

  protected readonly zones = SURFACE_ZONES;
  protected readonly paths = SURFACE_ZONE_PATH;

  private readonly selected = computed(() => parseSurface(this.value()));
  protected readonly selectedZones = computed(() => {
    const zones = new Set<SurfaceZone>();
    for (const surface of this.selected()) {
      const zone = surfaceZone(this.fdi(), surface);
      if (zone) zones.add(zone);
    }
    return zones;
  });
  protected readonly shorthand = computed(() => surfaceShorthand(this.value()));
  protected readonly centreLetter = computed(() => (this.fdi().charAt(1) <= '3' ? 'I' : 'O'));

  protected surfaceName(zone: SurfaceZone): ToothSurface {
    return zoneSurface(this.fdi(), zone);
  }

  protected toggle(zone: SurfaceZone): void {
    const surface = zoneSurface(this.fdi(), zone);
    const next = new Set<ToothSurface>(this.selected());
    if (next.has(surface)) next.delete(surface);
    else if (next.size < MAX_SURFACE_PARTS) next.add(surface);
    this.valueChange.emit(formatSurface(next));
  }

  protected clear(): void {
    this.valueChange.emit(null);
  }
}
