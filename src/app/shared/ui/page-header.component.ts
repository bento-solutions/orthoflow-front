import { Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRouteSnapshot, NavigationEnd, Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { filter, map, startWith } from 'rxjs/operators';

/** The title key of the deepest route that has one: the screen's own name. */
function routeTitle(root: ActivatedRouteSnapshot): string | null {
  let key: string | null = null;
  for (let r: ActivatedRouteSnapshot | null = root; r; r = r.firstChild) {
    if (typeof r.routeConfig?.title === 'string') key = r.routeConfig.title;
  }
  return key;
}

/**
 * The one page frame (UX audit P2-5, P2-6): a visible title as the page's heading (the screen's
 * route title unless one is given), an optional line under it, the page's main action at the top
 * right (`[page-actions]`), and the filters underneath (`[page-filters]`). Every list page starts
 * with it, so the main action is always in the same place and every page has a heading.
 *
 * ```html
 * <app-page-header>
 *   <button page-actions class="btn btn-primary">…</button>
 *   <div page-filters>…</div>
 * </app-page-header>
 * ```
 */
@Component({
  selector: 'app-page-header',
  standalone: true,
  imports: [TranslateModule],
  template: `
    <header class="page-header">
      <div class="page-header-row">
        <div class="min-w-0">
          <h2 class="page-header-title">@if (title()) { {{ title() }} } @else if (titleKey()) { {{ titleKey()! | translate }} }</h2>
          @if (subtitle()) { <p class="page-subtitle">{{ subtitle() }}</p> }
        </div>
        <div class="page-actions"><ng-content select="[page-actions]" /></div>
      </div>
      <div class="page-filters"><ng-content select="[page-filters]" /></div>
    </header>
  `,
  styles: [':host { display: block; }'],
})
export class PageHeaderComponent {
  readonly title = input<string | null>(null);
  readonly subtitle = input<string | null>(null);

  private readonly router = inject(Router, { optional: true });
  private readonly routeKey = toSignal((this.router?.events ?? of(null)).pipe(
    filter((e) => e === null || e instanceof NavigationEnd),
    startWith(null),
    map(() => {
      const root = this.router?.routerState?.snapshot?.root;
      return root ? routeTitle(root) : null;
    }),
  ), { initialValue: null });
  protected readonly titleKey = computed(() => this.routeKey());
}
