import { Injectable, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { ActivatedRouteSnapshot, RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';

const APP_NAME = 'OrthoFlow';

/** The titles on the way to a route, the most specific first and without the repeats empty paths inherit. */
export function routeTitleKeys(root: ActivatedRouteSnapshot): string[] {
  const keys: string[] = [];
  for (let route: ActivatedRouteSnapshot | null = root; route; route = route.firstChild) {
    if (route.title && keys[0] !== route.title) keys.unshift(route.title);
  }
  return keys;
}

/**
 * Each screen says what it is in the browser tab, which is the first thing a screen reader reads
 * when a page opens (WCAG 2.4.2): "Horaires · Paramètres · OrthoFlow". A route's `title` is a
 * translation key. No patient is ever named here: the title stays in the browser's history on a
 * computer the whole practice shares.
 */
@Injectable()
export class TranslatedTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private readonly translate = inject(TranslateService);
  private keys: string[] = [];

  constructor() {
    super();
    // On the first load the translations arrive after the first navigation.
    this.translate.onLangChange.subscribe(() => this.apply());
  }

  override updateTitle(snapshot: RouterStateSnapshot): void {
    this.keys = routeTitleKeys(snapshot.root);
    this.apply();
  }

  private apply(): void {
    const parts = this.keys.map((key) => this.translate.instant(key) as string).filter((text, i) => text !== this.keys[i]);
    this.title.setTitle([...parts, APP_NAME].join(' · '));
  }
}
