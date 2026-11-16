import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRouteSnapshot, NavigationEnd, Router, RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { filter, map, startWith } from 'rxjs/operators';
import { PageLabelService } from '../../core/services/page-label.service';
import { IconComponent } from '../../shared/ui/icon.component';

interface Crumb {
  /** Translation key of the route's own title. */
  key: string;
  url: string;
}

/** The titled routes on the way to the current screen, each with the address that leads to it. */
export function routeCrumbs(root: ActivatedRouteSnapshot): Crumb[] {
  const crumbs: Crumb[] = [];
  let url = '';
  for (let route: ActivatedRouteSnapshot | null = root; route; route = route.firstChild) {
    const segments = route.url.map((s) => s.path).join('/');
    if (segments) url += '/' + segments;
    const key = route.routeConfig?.title;
    // Empty-path children and layouts share their parent's address: one crumb for each title.
    if (typeof key === 'string' && crumbs[crumbs.length - 1]?.key !== key) crumbs.push({ key, url: url || '/' });
  }
  return crumbs;
}

/**
 * Where you are, in place of a page title: Overview › Settings › Hours. It is the only heading a
 * screen shows, so the one heading a screen reader needs is kept here, unseen.
 */
@Component({
  selector: 'app-breadcrumbs',
  standalone: true,
  imports: [RouterLink, TranslateModule, IconComponent],
  template: `
    <nav [attr.aria-label]="'NAV.BREADCRUMB' | translate" class="min-w-0">
      <ol class="flex min-w-0 flex-wrap items-center gap-x-1.5 text-sm text-ink-500">
        @for (crumb of trail(); track crumb.url; let last = $last; let first = $first) {
          <li class="flex min-w-0 items-center gap-x-1.5">
            @if (!first) {
              <app-icon name="chevron-right" [size]="14" class="shrink-0 text-ink-300 rtl:rotate-180" aria-hidden="true" />
            }
            @if (last) {
              <span class="truncate text-lg font-bold leading-tight tracking-[-0.014em] text-ink-900" aria-current="page">
                @if (crumb.label) { {{ crumb.label }} } @else { {{ crumb.key | translate }} }
              </span>
            } @else {
              <a [routerLink]="crumb.url" class="truncate rounded-sm font-medium hover:text-ink-900 hover:underline">{{ crumb.key | translate }}</a>
            }
          </li>
        }
      </ol>
    </nav>
    <h1 class="sr-only">@if (current().label) { {{ current().label }} } @else { {{ current().key | translate }} }</h1>
  `,
})
export class BreadcrumbsComponent {
  private readonly router = inject(Router);
  private readonly pageLabel = inject(PageLabelService);

  private readonly crumbs = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      startWith(null),
      map(() => routeCrumbs(this.router.routerState.snapshot.root)),
    ),
    { initialValue: [] as Crumb[] },
  );

  /** Overview first, then the screens down to this one; a screen that names its subject ends on that name. */
  protected readonly trail = computed(() => {
    const crumbs = this.crumbs();
    const home: Crumb = { key: 'COMMON.OVERVIEW', url: '/' };
    const list = crumbs[0]?.key === home.key ? crumbs : [home, ...crumbs];
    const label = this.pageLabel.label();
    return list.map((crumb, i) => ({ ...crumb, label: i === list.length - 1 ? label : null }));
  });

  protected readonly current = computed(() => this.trail()[this.trail().length - 1]);
}
