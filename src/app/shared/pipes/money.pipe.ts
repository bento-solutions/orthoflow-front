import { Pipe, PipeTransform, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { PracticeProfileService } from '../../core/services/practice-profile.service';
import { formatMoney, formatNumber, formatPercent, formatMinutes } from '../../core/utils/format';

/**
 * The language the screen is shown in. Read from the translations rather than LanguageService,
 * whose constructor sets the language: a pipe must not switch it in the middle of a render.
 */
function lang(translate: TranslateService): string {
  return translate.currentLang || translate.getDefaultLang() || 'fr';
}

/**
 * `{{ amount | money }}`: the amount in the clinic's currency and the person's
 * language. Impure on purpose: it reads two signals (language, currency), and a pure
 * pipe would keep showing the old format after either changed.
 */
@Pipe({ name: 'money', standalone: true, pure: false })
export class MoneyPipe implements PipeTransform {
  private readonly translate = inject(TranslateService);
  private readonly profile = inject(PracticeProfileService);

  transform(amount: number | null | undefined, currency?: string): string {
    return formatMoney(amount, currency ?? this.profile.currency(), lang(this.translate));
  }
}

/** `{{ count | num }}`, `{{ rate | pct }}`, `{{ minutes | duration }}`: the other figures, formatted the same way. */
@Pipe({ name: 'num', standalone: true, pure: false })
export class NumPipe implements PipeTransform {
  private readonly translate = inject(TranslateService);

  transform(value: number | null | undefined, maximumFractionDigits = 2): string {
    return formatNumber(value, lang(this.translate), maximumFractionDigits);
  }
}

@Pipe({ name: 'pct', standalone: true, pure: false })
export class PctPipe implements PipeTransform {
  private readonly translate = inject(TranslateService);

  transform(value: number | null | undefined): string {
    return formatPercent(value, lang(this.translate));
  }
}

@Pipe({ name: 'duration', standalone: true })
export class DurationPipe implements PipeTransform {
  transform(minutes: number | null | undefined): string {
    return formatMinutes(minutes);
  }
}
