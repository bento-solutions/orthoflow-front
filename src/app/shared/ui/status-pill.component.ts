import { Component, Input, computed, signal } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

export type StatusTone = 'active' | 'done' | 'attention' | 'critical' | 'idle';

/**
 * The product's status vocabulary, in one place.
 *
 * Ten separate status enums exist across patients, appointments, treatments,
 * invoices, quotes, claims, purchase orders, delivery notes, sales orders
 * and count sessions. Before this, each screen invented its own colours for
 * them — six different `.status-badge` definitions, several of which styled
 * only one of their enum's values so the rest rendered as unstyled text
 * (a COMPLETED patient and an ON_HOLD patient were visually identical).
 *
 * Every domain token maps onto exactly five tones. Five is a deliberate
 * ceiling: a colour code a user has to *learn* is a colour code they will
 * get wrong under time pressure, and this is software used between
 * patients.
 *
 *   active     petrol  live and proceeding normally
 *   done       green   finished, settled, received — no action left
 *   attention  amber   needs a human soon, but nothing is broken yet
 *   critical   red     money lost, care blocked, or a hard stop
 *   idle       grey    not live: draft, cancelled, archived
 *
 * CANCELLED maps to `idle`, not `critical`. A cancelled invoice is a dead
 * record, not an emergency — colouring it red makes every list shout and
 * trains users to ignore red, which is exactly what must not happen to the
 * one colour that means "care is blocked".
 */
const TONE_BY_STATUS: Readonly<Record<string, StatusTone>> = {
  // live
  ACTIVE: 'active',
  IN_PROGRESS: 'active',
  SCHEDULED: 'active',
  PLANNED: 'active',
  PROPOSED: 'active',
  SENT: 'active',
  SUBMITTED: 'active',
  CONFIRMED: 'active',
  OPEN: 'active',
  IN_STOCK: 'active',
  DEPOSITED: 'active',
  ISSUED: 'active',

  // settled
  COMPLETED: 'done',
  PAID: 'done',
  RECEIVED: 'done',
  APPROVED: 'done',
  ACCEPTED: 'done',
  VALIDATED: 'done',
  FINALIZED: 'done',
  INVOICED: 'done',
  DELIVERED: 'done',
  CLOSED: 'done',
  CASHED: 'done',

  // needs a human
  PENDING: 'attention',
  PARTIALLY_PAID: 'attention',
  PARTIALLY_RECEIVED: 'attention',
  ON_HOLD: 'attention',
  AWAITING: 'attention',
  NO_SHOW: 'attention',
  EXPIRED: 'attention',
  REFUNDED: 'attention',
  LOW_STOCK: 'attention',
  LOW: 'attention',

  // blocked
  OVERDUE: 'critical',
  REJECTED: 'critical',
  OUT_OF_STOCK: 'critical',
  FAILED: 'critical',

  // not live
  DRAFT: 'idle',
  CANCELLED: 'idle',
  CANCELED: 'idle',
  ARCHIVED: 'idle',
  INACTIVE: 'idle',
  VOID: 'idle',
};

@Component({
  selector: 'app-status-pill',
  standalone: true,
  imports: [TranslateModule],
  template: `
    <span class="pill" [class]="'pill-' + tone()">{{ labelKey() | translate }}</span>
  `,
  styles: [':host { display: inline-flex; }'],
})
export class StatusPillComponent {
  private readonly _status = signal('');

  /** A domain status token, e.g. `PARTIALLY_PAID`. Case-insensitive. */
  @Input({ required: true })
  set status(value: string | null | undefined) {
    this._status.set((value ?? '').toString().trim().toUpperCase().replace(/[\s-]+/g, '_'));
  }

  /** Overrides the mapping when a screen needs a different reading. */
  @Input() tone_override?: StatusTone;

  readonly tone = computed<StatusTone>(
    () => this.tone_override ?? TONE_BY_STATUS[this._status()] ?? 'idle',
  );

  /* Falls back to the raw token so an unmapped status is still legible
     rather than rendering an empty pill. */
  readonly labelKey = computed(() => {
    const token = this._status();
    return token ? `STATUS.${token}` : 'STATUS.UNKNOWN';
  });
}
