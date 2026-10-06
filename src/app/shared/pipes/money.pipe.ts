import { Pipe, PipeTransform, inject } from '@angular/core';
import { LanguageService } from '../../core/services/language.service';
import { PracticeProfileService } from '../../core/services/practice-profile.service';
import { formatMoney, formatNumber, formatPercent, formatMinutes } from '../../core/utils/format';

/**
 * `{{ amount | money }}`: the amount in the clinic's currency and the person's
 * language. Impure on purpose: it reads two signals (language, currency), and a pure
 * pipe would keep showing the old format after either changed.
 */
@Pipe({ name: 'money', standalone: true, pure: false })
export class MoneyPipe implements PipeTransform {
  private readonly language = inject(LanguageService);
  private readonly profile = inject(PracticeProfileService);

  transform(amount: number | null | undefined, currency?: string): string {
    return formatMoney(amount, currency ?? this.profile.currency(), this.language.currentLang());
  }
}

/** `{{ count | num }}`, `{{ rate | pct }}`, `{{ minutes | duration }}`: the other figures, formatted the same way. */
@Pipe({ name: 'num', standalone: true, pure: false })
export class NumPipe implements PipeTransform {
  private readonly language = inject(LanguageService);

  transform(value: number | null | undefined, maximumFractionDigits = 2): string {
    return formatNumber(value, this.language.currentLang(), maximumFractionDigits);
  }
}

@Pipe({ name: 'pct', standalone: true, pure: false })
export class PctPipe implements PipeTransform {
  private readonly language = inject(LanguageService);

  transform(value: number | null | undefined): string {
    return formatPercent(value, this.language.currentLang());
  }
}

@Pipe({ name: 'duration', standalone: true })
export class DurationPipe implements PipeTransform {
  transform(minutes: number | null | undefined): string {
    return formatMinutes(minutes);
  }
}
