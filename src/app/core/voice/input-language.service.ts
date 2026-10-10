import { Injectable, computed, inject, signal } from '@angular/core';
import { LanguageService } from '../services/language.service';
import { INPUT_LANGUAGES, InputLanguage, SPEECH_LOCALE } from './language-filter';

const KEY = 'orthoflow_voice_input_language';

/**
 * The language the doctor dictates in. By default it follows the application's
 * language; choosing one at the start of a session pins it, and speech in any
 * other language is then treated as noise (see `language-filter.ts`).
 *
 * Kept in the browser, per device: a doctor who dictates in French on a
 * clinic PC and reads the interface in English should not have to say so
 * every session, and nothing here is clinical data.
 */
@Injectable({ providedIn: 'root' })
export class InputLanguageService {
  private readonly app = inject(LanguageService);
  private readonly pinned = signal<InputLanguage | null>(read());

  /** Whether the doctor chose a dictation language, as opposed to following the app. */
  readonly isPinned = computed(() => this.pinned() !== null);

  readonly language = computed<InputLanguage>(() => {
    const pinned = this.pinned();
    if (pinned) return pinned;
    const app = this.app.currentLang();
    return (INPUT_LANGUAGES as readonly string[]).includes(app) ? (app as InputLanguage) : 'fr';
  });

  /** BCP-47 tag for the recogniser, also sent to the server's transcription. */
  readonly locale = computed(() => SPEECH_LOCALE[this.language()]);

  /** Pin a language, or pass null to follow the application's language again. */
  set(language: InputLanguage | null): void {
    this.pinned.set(language);
    try {
      if (language) localStorage.setItem(KEY, language);
      else localStorage.removeItem(KEY);
    } catch {
      /* private window or blocked storage: the choice lasts for this page only */
    }
  }
}

function read(): InputLanguage | null {
  try {
    const stored = localStorage.getItem(KEY);
    return (INPUT_LANGUAGES as readonly string[]).includes(stored ?? '') ? (stored as InputLanguage) : null;
  } catch {
    return null;
  }
}
