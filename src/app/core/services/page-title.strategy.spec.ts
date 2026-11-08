import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Route, RouterStateSnapshot } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { describe, expect, it } from 'vitest';
import { routes } from '../../app.routes';
import { BILLING_ROUTES } from '../../features/billing/billing.routes';
import { TranslatedTitleStrategy, routeTitleKeys } from './page-title.strategy';

const load = (lang: string) => JSON.parse(readFileSync(join(process.cwd(), 'public', 'i18n', `${lang}.json`), 'utf-8'));

function exists(tree: unknown, key: string): boolean {
  const value = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], tree);
  return typeof value === 'string';
}

const flatten = (list: readonly Route[]): Route[] => list.flatMap((route) => [route, ...flatten(route.children ?? [])]);

/** A chain of snapshots as the router builds them, outermost first. */
const snapshot = (...titles: (string | undefined)[]) => {
  const build = (i: number): unknown => (i < titles.length ? { title: titles[i], firstChild: build(i + 1) } : null);
  return { root: build(0) } as unknown as RouterStateSnapshot;
};

describe('page titles', () => {
  it('every route that opens a screen has one', () => {
    const screens = flatten([...routes, ...BILLING_ROUTES]).filter((route) =>
      route.loadComponent && route.path !== '' && !route.children);
    const without = screens.filter((route) => !route.title).map((route) => route.path);
    expect(without).toEqual([]);
  });

  it('every title is translated in all three languages', () => {
    const keys = flatten([...routes, ...BILLING_ROUTES]).map((route) => route.title).filter((title): title is string => typeof title === 'string');
    expect(keys.length).toBeGreaterThan(50);
    for (const lang of ['fr', 'en', 'ar']) {
      const tree = load(lang);
      expect(keys.filter((key) => !exists(tree, key)), lang).toEqual([]);
    }
  });

  it('read from the most specific to the least, without the repeats that empty paths inherit', () => {
    expect(routeTitleKeys(snapshot(undefined, 'SETTINGS', 'SETTINGS', 'HOURS').root)).toEqual(['HOURS', 'SETTINGS']);
    expect(routeTitleKeys(snapshot(undefined).root)).toEqual([]);
  });
});

describe('TranslatedTitleStrategy', () => {
  const setup = () => {
    TestBed.configureTestingModule({
      providers: [provideTranslateService({ fallbackLang: 'fr' }), TranslatedTitleStrategy],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('fr', { HOURS: 'Horaires', SETTINGS: 'Paramètres' });
    translate.setTranslation('en', { HOURS: 'Hours', SETTINGS: 'Settings' });
    return { translate, strategy: TestBed.inject(TranslatedTitleStrategy), title: TestBed.inject(Title) };
  };

  it('says what the screen is, then where it is, then the product', () => {
    const { translate, strategy, title } = setup();
    translate.use('fr');
    strategy.updateTitle(snapshot('SETTINGS', 'HOURS'));
    expect(title.getTitle()).toBe('Horaires · Paramètres · OrthoFlow');
  });

  it('follows the language', () => {
    const { translate, strategy, title } = setup();
    translate.use('fr');
    strategy.updateTitle(snapshot('SETTINGS', 'HOURS'));
    translate.use('en');
    expect(title.getTitle()).toBe('Hours · Settings · OrthoFlow');
  });

  it('never shows a raw key: until translations arrive, the product name will do', () => {
    const { translate, strategy, title } = setup();
    translate.use('fr');
    strategy.updateTitle(snapshot('NOT_LOADED_YET'));
    expect(title.getTitle()).toBe('OrthoFlow');
  });
});
