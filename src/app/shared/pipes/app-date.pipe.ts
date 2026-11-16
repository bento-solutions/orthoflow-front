import { Pipe, PipeTransform, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { DateForm, formatDate } from '../../core/utils/format';

/**
 * `{{ when | appDate }}` → `19 nov. 2026`; `{{ when | appDate:'datetime' }}` → `19 nov. 2026, 09:00`;
 * `'time'`, `'long'` and `'relative'` for the rest. The one way a date is written in the product
 * (UX audit P2-2): 24-hour clock, Latin digits, the person's language. Impure, so it follows a
 * change of language. It reads the language from the translations rather than LanguageService,
 * whose constructor would switch the language of whatever screen first used the pipe.
 */
@Pipe({ name: 'appDate', standalone: true, pure: false })
export class AppDatePipe implements PipeTransform {
  private readonly translate = inject(TranslateService);

  transform(value: Date | string | number | null | undefined, form: DateForm = 'date'): string {
    const lang = this.translate.currentLang || this.translate.getDefaultLang() || 'fr';
    return formatDate(value, form, lang);
  }
}
