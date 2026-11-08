import { Injectable, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

const SCROLLERS = '.table-scroll, .overflow-x-auto, .overflow-y-auto, .overflow-auto';
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const MARK = 'data-scroll-region';

/**
 * Something that scrolls has to be reachable from the keyboard, or what is past its edge cannot
 * be read without a mouse (WCAG 2.1.1). A table wider than a phone is the usual case, and the same
 * table on a desktop screen has nothing to scroll and should not be a stop on the way through the
 * page. So this looks at what each scroller holds right now, for every table in the app without
 * each screen having to ask: when it overflows and nothing inside it can take focus, it can take
 * focus itself, and it says what it is.
 */
@Injectable({ providedIn: 'root' })
export class ScrollRegionsService {
  private readonly translate = inject(TranslateService);
  private readonly watched = new Set<HTMLElement>();
  private resizes: ResizeObserver | null = null;
  private queued = false;

  start(): void {
    if (this.resizes || typeof ResizeObserver === 'undefined' || typeof MutationObserver === 'undefined') return;
    this.resizes = new ResizeObserver((entries) => entries.forEach((entry) => this.update(entry.target as HTMLElement)));
    new MutationObserver(() => this.queue()).observe(document.body, { childList: true, subtree: true });
    this.queue();
  }

  /** Mutations come in bursts while a screen renders: once per frame is plenty. */
  private queue(): void {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      document.querySelectorAll<HTMLElement>(SCROLLERS).forEach((el) => {
        if (this.watched.has(el)) return;
        this.watched.add(el);
        this.resizes?.observe(el);
      });
      for (const el of this.watched) {
        if (el.isConnected) {
          this.update(el);
        } else {
          this.watched.delete(el);
          this.resizes?.unobserve(el);
        }
      }
    });
  }

  private update(el: HTMLElement): void {
    const overflows = el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
    const needsStop = overflows && !el.querySelector(FOCUSABLE);
    if (needsStop === el.hasAttribute(MARK)) return;
    if (needsStop) {
      el.setAttribute(MARK, '');
      el.tabIndex = 0;
      // A group, not a region: a page can have several, and landmarks must each have their own name.
      el.setAttribute('role', 'group');
      el.setAttribute('aria-label', this.translate.instant('COMMON.SCROLLABLE'));
    } else {
      el.removeAttribute(MARK);
      el.removeAttribute('tabindex');
      el.removeAttribute('role');
      el.removeAttribute('aria-label');
    }
  }
}
