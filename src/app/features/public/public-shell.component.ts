import { Component, inject, input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { LanguageService } from '../../core/services/language.service';

const LANGS = [{ code: 'fr', label: 'Français' }, { code: 'en', label: 'English' }, { code: 'ar', label: 'العربية' }];

/**
 * The frame of the pages a patient opens from a link (booking, registration, satisfaction): the
 * clinic's name, a language choice, and a column that reads well on a phone. No staff navigation,
 * no session. The language the clinic prefers is used until the visitor picks another.
 */
@Component({
  selector: 'app-public-shell',
  standalone: true,
  imports: [TranslateModule],
  template: `
    <div class="min-h-screen bg-app-bg">
      <header class="border-b border-ink-100 bg-surface">
        <div class="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3">
          <p class="truncate text-base font-bold text-ink-900">{{ clinic() }}</p>
          <div class="flex shrink-0 gap-1" role="group" [attr.aria-label]="'COMMON.LANGUAGE' | translate">
            @for (l of langs; track l.code) {
              <button type="button" class="rounded-md px-2 py-1 text-xs font-semibold" [class.bg-petrol-600]="language.currentLang() === l.code" [class.text-white]="language.currentLang() === l.code"
                [class.text-ink-600]="language.currentLang() !== l.code" [attr.aria-pressed]="language.currentLang() === l.code" [attr.lang]="l.code" (click)="language.setLanguage(l.code)">{{ l.label }}</button>
            }
          </div>
        </div>
      </header>
      <main id="main" class="mx-auto max-w-2xl px-4 py-6">
        <ng-content />
      </main>
    </div>
  `,
})
export class PublicShellComponent {
  readonly clinic = input('');
  protected readonly language = inject(LanguageService);
  protected readonly langs = LANGS;
}

/**
 * Applies the clinic's preferred language, unless the visitor already chose one on this device
 * (the choice is remembered), so a link opens in the language the clinic writes to its patients in.
 */
export function useClinicLanguage(language: LanguageService, preferred: string | null | undefined): void {
  let chosen: string | null = null;
  try {
    chosen = localStorage.getItem('orthoflow_lang');
  } catch {
    /* storage can be blocked; fall back to the clinic's language */
  }
  if (!chosen && preferred && ['fr', 'en', 'ar'].includes(preferred)) {
    language.setLanguage(preferred);
  }
}
