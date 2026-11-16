import { ActivatedRouteSnapshot } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { routeCrumbs } from './breadcrumbs.component';

/** Just the parts of a route snapshot the trail reads. */
function route(path: string, title?: string, child?: ActivatedRouteSnapshot): ActivatedRouteSnapshot {
  return {
    url: path ? path.split('/').map((p) => ({ path: p })) : [],
    routeConfig: title ? { title } : {},
    firstChild: child ?? null,
  } as unknown as ActivatedRouteSnapshot;
}

describe('routeCrumbs', () => {
  it('lists each titled route with the address that leads to it', () => {
    const root = route('', undefined, route('settings', 'COMMON.SETTINGS', route('hours', 'SET.TABS.HOURS')));
    expect(routeCrumbs(root)).toEqual([
      { key: 'COMMON.SETTINGS', url: '/settings' },
      { key: 'SET.TABS.HOURS', url: '/settings/hours' },
    ]);
  });

  it('gives a layout and its empty-path child one crumb', () => {
    const root = route('stock', 'STOCK.TITLE', route('', 'STOCK.TITLE'));
    expect(routeCrumbs(root)).toEqual([{ key: 'STOCK.TITLE', url: '/stock' }]);
  });

  it('skips routes without a title', () => {
    expect(routeCrumbs(route('', undefined, route('stock', 'STOCK.TITLE', route('', undefined))))).toEqual([
      { key: 'STOCK.TITLE', url: '/stock' },
    ]);
  });
});
