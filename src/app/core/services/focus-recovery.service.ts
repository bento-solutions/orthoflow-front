import { Injectable } from '@angular/core';

/**
 * Deleting a row takes the button that was pressed with it, and the browser then starts the
 * keyboard over from the top of the page, rail and all, every time (WCAG 2.4.3). When what had
 * focus is gone and nothing else took it, this puts focus on the main content instead, so the
 * next Tab carries on from there. Screens that know better, like the charts, move focus themselves.
 */
@Injectable({ providedIn: 'root' })
export class FocusRecoveryService {
  private last: Element | null = null;

  start(): void {
    if (typeof MutationObserver === 'undefined') return;
    document.addEventListener('focusin', (event) => { this.last = event.target as Element; });
    new MutationObserver(() => {
      if (!this.last || this.last.isConnected || document.activeElement !== document.body) return;
      this.last = null;
      document.querySelector<HTMLElement>('main[tabindex="-1"]')?.focus({ preventScroll: true });
    }).observe(document.body, { childList: true, subtree: true });
  }
}
