import { Injectable, inject } from '@angular/core';
import { NavigationStart, Router } from '@angular/router';
import { signal } from '@angular/core';
import { filter } from 'rxjs/operators';

/**
 * A screen that is about one named thing (a patient) says so here, so the breadcrumb ends on that
 * name instead of a generic "Dossier". It lasts for one screen: the next navigation clears it.
 *
 * Only the on-screen breadcrumb reads it. The browser tab keeps the generic title on purpose,
 * because no patient is ever named in the history of a computer the whole practice shares.
 */
@Injectable({ providedIn: 'root' })
export class PageLabelService {
  private readonly _label = signal<string | null>(null);
  readonly label = this._label.asReadonly();

  constructor() {
    inject(Router).events
      .pipe(filter((e) => e instanceof NavigationStart))
      .subscribe(() => this._label.set(null));
  }

  set(label: string | null): void {
    this._label.set(label?.trim() || null);
  }
}
