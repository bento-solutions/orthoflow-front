import { Injectable, OnDestroy, signal } from '@angular/core';
import { CellSite, ModeValue, PerioMode } from '../../../core/clinical/perio/perio.model';

export interface PerioTip {
  readonly tooth: string;
  readonly site: CellSite;
  readonly mode: PerioMode;
  readonly value: ModeValue;
  /** Where the cell is on the screen: the tip sits above its top edge. */
  readonly x: number;
  readonly y: number;
}

/** A tip appears after the pointer rests on a cell, and straight away when moving from one cell to the next. */
const OPEN_DELAY_MS = 200;
const SKIP_DELAY_MS = 80;

/** What the pointer is over, for the one tooltip the chart draws. Provided by the chart that owns it. */
@Injectable()
export class PerioTooltipService implements OnDestroy {
  private readonly current = signal<PerioTip | null>(null);
  readonly tip = this.current.asReadonly();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastClosedAt = 0;

  show(tip: PerioTip): void {
    this.cancelTimer();
    const delay = this.current() || Date.now() - this.lastClosedAt < SKIP_DELAY_MS * 2 ? SKIP_DELAY_MS : OPEN_DELAY_MS;
    this.timer = setTimeout(() => this.current.set(tip), this.current() ? 0 : delay);
  }

  hide(): void {
    this.cancelTimer();
    if (this.current()) this.lastClosedAt = Date.now();
    this.current.set(null);
  }

  ngOnDestroy(): void {
    this.cancelTimer();
  }

  private cancelTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
