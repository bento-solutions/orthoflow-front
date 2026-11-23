import { IconComponent } from '../../../ui/icon.component';
import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { CockpitModelService } from '../../../../core/consultation/cockpit-model.service';
import { ConsultationFocusService } from '../../../../core/consultation/consultation-focus.service';
import { ClinicalRecordService } from '../../../../core/services/clinical-record.service';
import { VoicePreferencesService } from '../../../../core/voice/voice-preferences.service';

/**
 * The cockpit's top bar: back, who the patient is and what they are allergic to, and the two
 * settings (spoken feedback, help). The recording itself — the timer, the microphone, Pause,
 * the language, End and the microphone alerts — is in the consultation drawer along the
 * bottom, the bar that started it, so Start becomes Pause and End in the same place.
 */
@Component({
  selector: 'app-cockpit-controls',
  standalone: true,
  imports: [IconComponent, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ck-bar" role="toolbar" [attr.aria-label]="'COCKPIT.CONTROLS' | translate">
      <button type="button" class="ck-icon" (click)="leave.emit()" [attr.aria-label]="'COMMON.BACK' | translate" [title]="'COCKPIT.LEAVE' | translate">
        <app-icon class="mi" name="arrow_back" size="1em" />
      </button>
      @if (model.patient(); as p) {
        <span class="ck-name">{{ p.firstName }} {{ p.lastName }}</span>
      }
      @if (model.allergyBadges().length) {
        <span class="ck-allergies" role="note" [attr.aria-label]="'COCKPIT.ALLERGIES' | translate">
          <app-icon class="mi" name="warning" size="1em" />
          @for (a of model.allergyBadges(); track a.label) {
            <span class="ck-allergy" [class.new]="!a.fromRecord">{{ a.label }}</span>
          }
        </span>
      }
      <!-- Conditions and current medications, from the same alert list as the patient banner. -->
      @if (otherAlerts().length) {
        <span class="ck-allergies ck-conditions" role="note" [attr.aria-label]="'ALERTS.TITLE' | translate">
          @for (a of otherAlerts(); track a.id) { <span class="ck-allergy">{{ a.label }}</span> }
        </span>
      }

      <span class="ck-spacer"></span>

      <button type="button" class="ck-chip" (click)="prefs.cycle()" [title]="'COCKPIT.SETTINGS.FEEDBACK' | translate"
              [attr.aria-label]="('COCKPIT.SETTINGS.FEEDBACK' | translate) + ' : ' + ('COCKPIT.LEVEL.' + prefs.level().toUpperCase() | translate)">
        <app-icon class="mi" [name]="levelIcon()" size="1em" />
        <span class="ck-chip-label">{{ 'COCKPIT.LEVEL.' + prefs.level().toUpperCase() | translate }}</span>
      </button>
      <button type="button" class="ck-icon" (click)="focus.show('help')" [attr.aria-label]="'COCKPIT.HELP' | translate" [title]="'COCKPIT.HELP' | translate">
        <app-icon class="mi" name="help_outline" size="1em" />
      </button>
    </div>
  `,
  styles: [`
    :host { display: block; }
    .ck-bar { display: flex; align-items: center; gap: .5rem; padding: .5rem .75rem; background: var(--surface); border: 1px solid rgb(var(--ink-200)); border-radius: var(--radius-lg); min-width: 0; flex-wrap: nowrap; }
    .ck-name { font-weight: 700; color: rgb(var(--ink-900)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
    .ck-allergies { display: inline-flex; align-items: center; gap: .25rem; color: rgb(var(--critical-700)); min-width: 0; overflow: hidden; }
    .ck-allergies app-icon.mi { font-size: var(--text-lg); }
    .ck-allergy { font-size: var(--text-sm); font-weight: 600; padding: .05rem .4rem; border-radius: var(--radius-full); background: rgb(var(--critical-50)); white-space: nowrap; }
    .ck-allergy.new { outline: 1px dashed rgb(var(--critical-400)); }
    .ck-conditions { color: rgb(var(--caution-700)); }
    .ck-conditions .ck-allergy { background: rgb(var(--caution-50)); }
    .ck-spacer { flex: 1; }
    .ck-icon { display: inline-grid; place-items: center; width: 2.5rem; height: 2.5rem; border-radius: var(--radius-md); color: rgb(var(--ink-700)); flex: none; }
    .ck-icon:hover { background: var(--surface-hover); }
    .ck-chip { display: inline-flex; align-items: center; gap: .25rem; min-height: 2.5rem; padding: 0 .625rem; border-radius: var(--radius-md); border: 1px solid rgb(var(--ink-200)); font-weight: 600; font-size: var(--text-sm); color: rgb(var(--ink-800)); flex: none; }
    .ck-chip app-icon.mi { font-size: var(--text-lg); }
    @media (max-width: 1099.98px) {
      .ck-conditions, .ck-chip-label { display: none; }
      .ck-bar { padding: .375rem .5rem; gap: .375rem; }
    }
    @media (max-width: 479.98px) {
      .ck-icon { width: 2.25rem; }
      .ck-chip { padding: 0 .4rem; }
      .ck-bar { gap: .25rem; }
    }
  `],
})
export class CockpitControlsComponent {
  protected readonly model = inject(CockpitModelService);
  private readonly records = inject(ClinicalRecordService);
  /** The allergies are shown above, with what the consultation has just heard. */
  protected readonly otherAlerts = computed(() => this.records.medicalAlerts().filter(a => a.kind !== 'ALLERGY'));
  protected readonly focus = inject(ConsultationFocusService);
  protected readonly prefs = inject(VoicePreferencesService);

  /** The back arrow: leaves the dossier; the consultation stays open on the server. */
  readonly leave = output<void>();

  protected readonly levelIcon = computed(() => ({
    full: 'record_voice_over', brief: 'short_text', tones: 'music_note', silent: 'volume_off',
  })[this.prefs.level()]);
}
