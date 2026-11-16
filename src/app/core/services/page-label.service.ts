import { Injectable, inject } from '@angular/core';
import { NavigationStart, Router } from '@angular/router';
import { signal } from '@angular/core';
import { filter } from 'rxjs/operators';

/** The path of an address, without its query or fragment: `/patients/7?tab=chart` → `/patients/7`. */
export function pathOf(url: string): string {
  return url.split(/[?#]/)[0];
}

/**
 * A screen that is about one named thing (a patient) says so here, so the breadcrumb ends on that
 * name instead of a generic "Dossier". It lasts for one screen: a navigation to another address
 * clears it. A change of query alone (the patient file's `?tab=`) is the same screen and keeps it.
 *
 * The screen that set it clears it again when it is destroyed (`clear(owner)`), so a name can
 * never outlive its screen and become the title of the next one (UX audit P0-5).
 *
 * Only the on-screen breadcrumb reads it. The browser tab keeps the generic title on purpose,
 * because no patient is ever named in the history of a computer the whole practice shares.
 */
@Injectable({ providedIn: 'root' })
export class PageLabelService {
  private readonly _label = signal<string | null>(null);
  readonly label = this._label.asReadonly();
  private owner: object | null = null;
  private readonly router = inject(Router);

  constructor() {
    this.router.events
      .pipe(filter((e): e is NavigationStart => e instanceof NavigationStart))
      .subscribe((e) => {
        if (pathOf(e.url) !== pathOf(this.router.url)) this.reset();
      });
  }

  /** Names the current screen. `owner` is whoever may later clear it. */
  set(label: string | null, owner: object | null = null): void {
    this._label.set(label?.trim() || null);
    this.owner = owner;
  }

  /** Clears the label if `owner` set it; a label set since by another screen is left alone. */
  clear(owner: object): void {
    if (this.owner === owner) this.reset();
  }

  private reset(): void {
    this._label.set(null);
    this.owner = null;
  }
}
