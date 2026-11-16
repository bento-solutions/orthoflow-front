import { Pipe, PipeTransform, inject } from '@angular/core';
import { LanguageService } from '../../core/services/language.service';
import { DateForm, formatDate } from '../../core/utils/format';

/**
 * `{{ when | appDate }}` → `19 nov. 2026`; `{{ when | appDate:'datetime' }}` → `19 nov. 2026, 09:00`;
 * `'time'`, `'long'` and `'relative'` for the rest. The one way a date is written in the product
 * (UX audit P2-2): 24-hour clock, Latin digits, the person's language. Impure because it reads
 * the language signal.
 */
@Pipe({ name: 'appDate', standalone: true, pure: false })
export class AppDatePipe implements PipeTransform {
  private readonly language = inject(LanguageService);

  transform(value: Date | string | number | null | undefined, form: DateForm = 'date'): string {
    return formatDate(value, form, this.language.currentLang());
  }
}
