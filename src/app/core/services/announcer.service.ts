import { Injectable, signal } from '@angular/core';

/**
 * Says something to a screen reader that focus alone would not: the page changed, the chart
 * closed in on a tooth, the finding was saved. Sighted people see these happen; WCAG 4.1.3 asks
 * that everyone hears of them, without focus having to move. `LiveRegionComponent` at the root of
 * the app is what speaks.
 */
@Injectable({ providedIn: 'root' })
export class AnnouncerService {
  /** Waits for the next idle moment: a screen reader finishes what it is saying. */
  readonly polite = signal('');
  /** Interrupts: for errors that stop the person from going on. */
  readonly assertive = signal('');

  private timer: ReturnType<typeof setTimeout> | undefined;

  announce(message: string, politeness: 'polite' | 'assertive' = 'polite'): void {
    const region = politeness === 'assertive' ? this.assertive : this.polite;
    // Screen readers only speak a change: the same words twice need a gap between them.
    region.set('');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => region.set(message), 60);
  }
}
