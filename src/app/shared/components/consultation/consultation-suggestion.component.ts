import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { findingLabel } from '../../../core/clinical/finding-options';
import { SentenceSuggestion, suggestFromSentence } from '../../../core/consultation/consultation-suggestion';

/**
 * Where the analysis after the consultation could not settle a sentence: instead of "not
 * understood", the state or treatment it most likely names, marked "to be confirmed" in its own
 * colour (#ffb09c) so it is never mistaken for something the system recorded.
 */
@Component({
  selector: 'app-consultation-suggestion',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="cs" data-suggestion [attr.data-found]="suggestion() ? '' : null">
      @if (suggestion(); as s) {
        <span class="cs-kind">{{ kindKey(s) | translate }}</span>
        <span class="cs-text">{{ text(s) }}</span>
      } @else {
        <span class="cs-text cs-none">{{ 'CONSULTATION.SUGGEST.NONE' | translate }}</span>
      }
      <span class="cs-badge" data-to-confirm>{{ 'CONSULTATION.SUGGEST.TO_CONFIRM' | translate }}</span>
      @if (question()) { <span class="cs-question">{{ question() }}</span> }
    </span>
  `,
  styles: [`
    :host { display: inline; }
    .cs { display: inline-flex; flex-wrap: wrap; align-items: baseline; gap: .25rem .4rem; }
    .cs-kind { font-size: var(--text-xs); font-weight: 600; color: rgb(var(--ink-600)); }
    .cs-text { font-weight: 600; color: rgb(var(--ink-900)); }
    .cs-none { font-weight: 400; font-style: italic; color: rgb(var(--ink-600)); }
    /* The colour asked for: "to be confirmed" never reads as done (green) or as an error (red). */
    .cs-badge { padding: 0 .45rem; border-radius: var(--radius-full); background: var(--suggestion); color: var(--suggestion-text); font-size: var(--text-xs); font-weight: 700; white-space: nowrap; }
    .cs-question { flex-basis: 100%; font-size: var(--text-xs); color: rgb(var(--ink-600)); }
  `],
})
export class ConsultationSuggestionComponent {
  private translate = inject(TranslateService);

  /** The sentence as it was said. */
  readonly sentence = input<string>('');
  /** A suggestion already worked out by the caller; read from the sentence otherwise. */
  readonly given = input<SentenceSuggestion | null | undefined>(undefined);
  /** The question the live pipeline would have asked ("which tooth?"), shown under it. */
  readonly question = input<string | null>(null);

  readonly suggestion = computed(() => {
    const given = this.given();
    return given !== undefined ? given : suggestFromSentence(this.sentence());
  });

  kindKey(s: SentenceSuggestion): string {
    const types = new Set(s.findings.map(f => f.type));
    if (types.size > 1) return 'CONSULTATION.SUGGEST.BOTH';
    return types.has('treatment') ? 'CONSULTATION.SUGGEST.TREATMENT' : 'CONSULTATION.SUGGEST.STATE';
  }

  text(s: SentenceSuggestion): string {
    const findings = s.findings.map(f => {
      const label = findingLabel(this.translate, f.code);
      const surface = f.surface ? ` (${this.surfaces(f.surface)})` : '';
      const doubt = f.suspected ? ` ${this.translate.instant('CONSULTATION.SUGGEST.SUSPECTED')}` : '';
      return `${label}${surface}${doubt}`;
    }).join(', ');
    if (s.teeth.length === 0) return findings;
    const tooth = this.translate.instant(s.teeth.length > 1 ? 'CONSULTATION.SUGGEST.TEETH' : 'CONSULTATION.DOC.TOOTH');
    return `${tooth} ${s.teeth.join(', ')} : ${findings}`;
  }

  private surfaces(value: string): string {
    return value.split(/[-,\s]+/).filter(Boolean).map(code => {
      const key = `SURFACE.${code.toUpperCase()}`;
      const word = this.translate.instant(key);
      return word === key ? code : word.toLowerCase();
    }).join(', ');
  }
}
