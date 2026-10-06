import { DOCUMENT } from '@angular/common';
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { AuthService } from './auth.service';
import { UserPreferencesService } from './user-preferences.service';

export type ThemePreference = 'light' | 'dark' | 'system';
export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'orthoflow_theme';

function stored(): ThemePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

/**
 * Light, dark, or follow the system.
 *
 * The choice is applied as `data-theme` on <html> (the tokens re-theme from
 * there, see tokens.css) and remembered in two places: localStorage, so the
 * very next page load is correct before anything is fetched (index.html reads
 * it before the first paint), and the person's server-side preferences, so it
 * follows them to another device. The server copy is adopted at sign-in; a
 * failure to reach it never changes what the screen shows.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly auth = inject(AuthService);
  private readonly preferences = inject(UserPreferencesService);

  readonly preference = signal<ThemePreference>(stored());
  private readonly systemDark = signal(this.media()?.matches ?? false);
  readonly effective = computed<Theme>(() => {
    const preference = this.preference();
    return preference === 'system' ? (this.systemDark() ? 'dark' : 'light') : preference;
  });

  constructor() {
    this.media()?.addEventListener?.('change', event => this.systemDark.set(event.matches));
    effect(() => this.apply(this.effective()));
    effect(() => {
      if (this.auth.token()) {
        untracked(() => void this.adoptServerChoice());
      } else {
        untracked(() => this.preferences.clear());
      }
    });
  }

  set(preference: ThemePreference): void {
    this.preference.set(preference);
    try {
      localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      /* private mode: the choice lasts for this session only */
    }
    if (this.auth.token()) {
      this.preferences.patch({ theme: preference }).catch(() => undefined);
    }
  }

  /** Light to dark and back; the first press leaves "follow the system". */
  toggle(): void {
    this.set(this.effective() === 'dark' ? 'light' : 'dark');
  }

  private async adoptServerChoice(): Promise<void> {
    try {
      const saved = (await this.preferences.get())['theme'];
      if ((saved === 'light' || saved === 'dark' || saved === 'system') && saved !== this.preference()) {
        this.preference.set(saved);
        try {
          localStorage.setItem(STORAGE_KEY, saved);
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* offline or signed out meanwhile: keep the local choice */
    }
  }

  private apply(theme: Theme): void {
    const root = this.document.documentElement;
    root.setAttribute('data-theme', theme);
    root.classList.toggle('dark', theme === 'dark');
    this.document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0e1417' : '#20414e');
  }

  private media(): MediaQueryList | null {
    return typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  }
}
