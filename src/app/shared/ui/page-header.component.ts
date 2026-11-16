import { Component, input } from '@angular/core';

/**
 * The one page frame (UX audit P2-5, P2-6): a visible title as the page's heading, a one-line
 * description, the page's main action at the top right (`[page-actions]`), and the filters
 * underneath (`[page-filters]`). Every list page starts with it, so the action is always in the
 * same place and every page has a heading.
 *
 * ```html
 * <app-page-header [title]="'NAV.LAB_ORDERS' | translate" [subtitle]="…">
 *   <button page-actions class="btn btn-primary">…</button>
 *   <div page-filters>…</div>
 * </app-page-header>
 * ```
 */
@Component({
  selector: 'app-page-header',
  standalone: true,
  template: `
    <header class="page-header">
      <div class="page-header-row">
        <div class="min-w-0">
          <h2 class="page-title">{{ title() }}</h2>
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
  readonly title = input.required<string>();
  readonly subtitle = input<string | null>(null);
}
