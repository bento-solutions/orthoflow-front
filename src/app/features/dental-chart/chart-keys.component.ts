import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

interface KeyHint {
  /** A key's name is translated when it has a word, like Entrée; arrows are the same everywhere. */
  readonly keys: readonly string[];
  readonly action: string;
}

const ARROWS = ['←', '→', '↑', '↓'];

/**
 * The keys that work on a chart right now, under the chart. Keys nobody knows about help nobody,
 * and they change between the whole mouth and a close-up. A screen reader gets the same help
 * through the chart's description, so this line is for the eyes only. A phone has no keys to
 * tell about, so it is hidden there.
 */
@Component({
  selector: 'app-chart-keys',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <p class="keys" aria-hidden="true">
      @for (hint of hints(); track hint.action) {
        <span class="hint">
          <span class="caps">
            @for (key of hint.keys; track key) { <kbd class="kbd">{{ key | translate }}</kbd> }
          </span>
          {{ hint.action | translate }}
        </span>
      }
    </p>
  `,
  styles: [`
    :host { display: block; }
    .keys { display: flex; flex-wrap: wrap; gap: .25rem .875rem; margin: 0; font-size: .75rem; color: var(--text-muted-on-tint); }
    .hint { display: inline-flex; align-items: center; gap: .3125rem; white-space: nowrap; }
    .caps { display: inline-flex; gap: .125rem; }
    @media (hover: none) { :host { display: none; } }
    @media print { :host { display: none; } }
  `],
})
export class ChartKeysComponent {
  /** Closed in on one tooth, where the arrows and Escape mean something else. */
  readonly closeUp = input(false);
  /** The letters of the faces that can be picked on the tooth in close-up. */
  readonly faces = input<readonly string[]>([]);
  /** There is a panel to go on to from the close-up. */
  readonly detail = input(false);
  /** The picture can be turned, which only a 3D one can. */
  readonly turnable = input(false);
  /** What Space does on a tooth, if it does anything. */
  readonly spaceAction = input<string | null>('TOOTH_KEYS.SELECT');

  protected readonly hints = computed<KeyHint[]>(() => {
    if (this.closeUp()) {
      return [
        { keys: ARROWS, action: 'TOOTH_KEYS.NEXT_TOOTH' },
        ...(this.faces().length ? [{ keys: this.faces(), action: 'TOOTH_KEYS.FACE' }] : []),
        ...(this.detail() ? [{ keys: ['TOOTH_KEYS.ENTER'], action: 'TOOTH_KEYS.DETAIL' }] : []),
        ...(this.turnable() ? [{ keys: ['TOOTH_KEYS.SHIFT', '←', '→'], action: 'TOOTH_KEYS.TURN' }] : []),
        { keys: ['TOOTH_KEYS.ESCAPE'], action: 'TOOTH_KEYS.WHOLE_MOUTH' },
      ];
    }
    return [
      { keys: ARROWS, action: 'TOOTH_KEYS.MOVE' },
      { keys: ['TOOTH_KEYS.ENTER'], action: 'TOOTH_KEYS.ZOOM' },
      ...(this.spaceAction() ? [{ keys: ['TOOTH_KEYS.SPACE'], action: this.spaceAction()! }] : []),
      { keys: ['16'], action: 'TOOTH_KEYS.TYPE' },
      ...(this.turnable() ? [{ keys: ['TOOTH_KEYS.SHIFT', '←', '→'], action: 'TOOTH_KEYS.TURN' }] : []),
    ];
  });
}
