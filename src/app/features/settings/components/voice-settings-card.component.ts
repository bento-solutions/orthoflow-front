import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { LanguageService } from '../../../core/services/language.service';
import { InputLanguageService } from '../../../core/voice/input-language.service';
import { SpeechFeedbackService } from '../../../core/voice/speech-feedback.service';
import { VoiceFeedbackService } from '../../../core/voice/voice-feedback.service';
import { FEEDBACK_LEVELS, FeedbackLevel, VoicePreferencesService } from '../../../core/voice/voice-preferences.service';
import { spokenLanguage, synthesisLocale } from '../../../core/voice/voice-vocabulary';

/**
 * "Voix et consultation" on the account page: how much the app says back while
 * the doctor dictates. Some doctors want every finding read back; some want a
 * tone; some want silence — so it is theirs to choose, and it follows them to
 * another device.
 */
@Component({
  selector: 'app-voice-settings-card',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card card-pad space-y-5" aria-labelledby="voice-settings-title">
      <div>
        <h2 id="voice-settings-title" class="text-lg font-bold text-ink-900">{{ 'COCKPIT.SETTINGS.TITLE' | translate }}</h2>
        <p class="text-sm text-ink-500">{{ 'COCKPIT.SETTINGS.HINT' | translate }}</p>
      </div>

      <fieldset class="field">
        <legend class="label">{{ 'COCKPIT.SETTINGS.FEEDBACK' | translate }}</legend>
        <div class="space-y-2">
          @for (level of levels; track level) {
            <label class="flex items-start gap-2">
              <input type="radio" name="voice-feedback" [value]="level" [checked]="prefs.preferences().feedback === level"
                     (change)="prefs.set({ feedback: level })" />
              <span>
                <span class="font-semibold">{{ 'COCKPIT.LEVEL.' + level.toUpperCase() | translate }}</span>
                <span class="block text-sm text-ink-500">{{ 'COCKPIT.LEVEL_HINT.' + level.toUpperCase() | translate }}</span>
              </span>
            </label>
          }
        </div>
      </fieldset>

      <label class="flex items-start gap-2">
        <input type="checkbox" [checked]="prefs.preferences().criticalAlerts" (change)="prefs.set({ criticalAlerts: $any($event.target).checked })" />
        <span>
          <span class="font-semibold">{{ 'COCKPIT.SETTINGS.ALERTS' | translate }}</span>
          <span class="block text-sm text-ink-500">{{ 'COCKPIT.SETTINGS.ALERTS_HINT' | translate }}</span>
        </span>
      </label>

      <label class="flex items-start gap-2">
        <input type="checkbox" [checked]="prefs.preferences().autoFollow" (change)="prefs.set({ autoFollow: $any($event.target).checked })" />
        <span>
          <span class="font-semibold">{{ 'COCKPIT.SETTINGS.FOLLOW' | translate }}</span>
          <span class="block text-sm text-ink-500">{{ 'COCKPIT.SETTINGS.FOLLOW_HINT' | translate }}</span>
        </span>
      </label>

      <label class="field">
        <span class="label">{{ 'COCKPIT.SETTINGS.RATE' | translate }} · {{ prefs.preferences().speechRate.toFixed(2) }}</span>
        <input type="range" min="0.9" max="1.3" step="0.05" [value]="prefs.preferences().speechRate"
               (change)="prefs.set({ speechRate: +$any($event.target).value })" />
      </label>

      <div class="field">
        <label class="label" for="voice-settings-voice">{{ 'COCKPIT.SETTINGS.VOICE' | translate }}</label>
        <div class="flex flex-wrap items-center gap-2">
          <select id="voice-settings-voice" class="input" [value]="prefs.preferences().voiceUri ?? ''"
                  (change)="prefs.set({ voiceUri: $any($event.target).value || null })">
            <option value="">{{ 'COCKPIT.SETTINGS.VOICE_BEST' | translate }}</option>
            @for (v of voices(); track v.voiceURI) {
              <option [value]="v.voiceURI">{{ v.name }} ({{ v.lang }})</option>
            }
          </select>
          <button type="button" class="btn btn-secondary btn-sm" (click)="tryIt()">{{ 'COCKPIT.SETTINGS.TRY' | translate }}</button>
        </div>
      </div>
    </section>
  `,
})
export class VoiceSettingsCardComponent {
  protected readonly prefs = inject(VoicePreferencesService);
  private readonly speech = inject(SpeechFeedbackService);
  private readonly feedback = inject(VoiceFeedbackService);
  private readonly inputLanguage = inject(InputLanguageService);
  private readonly language = inject(LanguageService);

  protected readonly levels: readonly FeedbackLevel[] = FEEDBACK_LEVELS;

  /** Voices installed for the dictation language — the one confirmations are read in. */
  protected readonly voices = computed(() => {
    this.prefs.preferences();
    return this.speech.voicesFor(this.inputLanguage.language() || this.language.currentLang());
  });

  protected tryIt(): void {
    const language = spokenLanguage(this.inputLanguage.locale());
    const sample = language === 'fr' ? 'Dent 16 : carie occlusale.' : 'Tooth 16: occlusal caries.';
    this.speech.unlock();
    this.feedback.deliver('asked', { full: { text: sample, locale: synthesisLocale(language) } });
  }
}
