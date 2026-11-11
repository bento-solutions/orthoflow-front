import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, output, signal } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { ConsultationService } from '../../../../core/consultation/consultation.service';
import { CockpitModelService } from '../../../../core/consultation/cockpit-model.service';
import { ConsultationFocusService } from '../../../../core/consultation/consultation-focus.service';
import { InputLanguageService } from '../../../../core/voice/input-language.service';
import { INPUT_LANGUAGES } from '../../../../core/voice/language-filter';
import { VoiceOrchestratorService } from '../../../../core/voice/voice-orchestrator.service';
import { VoicePreferencesService } from '../../../../core/voice/voice-preferences.service';

/**
 * The cockpit's one bar: that it is recording and for how long, who the patient
 * is and what they are allergic to, the microphone, the dictation language, the
 * feedback level, help — and the one End control. The microphone and service
 * alerts of the old panels come here, one at a time, the most serious first.
 */
@Component({
  selector: 'app-cockpit-controls',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ck-bar" role="toolbar" [attr.aria-label]="'COCKPIT.CONTROLS' | translate">
      <button type="button" class="ck-icon" (click)="leave.emit()" [attr.aria-label]="'COMMON.BACK' | translate" [title]="'COCKPIT.LEAVE' | translate">
        <span class="material-icons" aria-hidden="true">arrow_back</span>
      </button>
      <span class="ck-rec" [class.live]="c.listening()">
        <span class="ck-dot" aria-hidden="true"></span>
        <span class="ck-time">{{ elapsed() }}</span>
        <span class="sr-only">{{ (c.listening() ? 'COCKPIT.RECORDING' : 'CONSULTATION.MIC_OFF') | translate }}</span>
      </span>
      @if (model.patient(); as p) {
        <span class="ck-name">{{ p.firstName }} {{ p.lastName }}</span>
      }
      @if (model.allergyBadges().length) {
        <span class="ck-allergies" role="note" [attr.aria-label]="'COCKPIT.ALLERGIES' | translate">
          <span class="material-icons" aria-hidden="true">warning</span>
          @for (a of model.allergyBadges(); track a.label) {
            <span class="ck-allergy" [class.new]="!a.fromRecord">{{ a.label }}</span>
          }
        </span>
      }

      <span class="ck-spacer"></span>

      <span class="ck-mic" [attr.aria-label]="'COCKPIT.MIC' | translate" role="img">
        <span class="ck-meter" aria-hidden="true"><span [style.transform]="'scaleY(' + (voice.paused() ? 0 : voice.inputLevel()) + ')'"></span></span>
        <span class="material-icons" aria-hidden="true">{{ voice.paused() ? 'mic_off' : 'mic' }}</span>
      </span>
      <button type="button" class="ck-chip" (click)="cycleLanguage()" [title]="'VOICE.LANG_TITLE' | translate"
              [attr.aria-label]="('VOICE.LANG_TITLE' | translate) + ' : ' + ('VOICE.LANG.' + inputLanguage.language() | translate)">
        {{ inputLanguage.language().toUpperCase() }}
      </button>
      <button type="button" class="ck-chip" (click)="prefs.cycle()" [title]="'COCKPIT.SETTINGS.FEEDBACK' | translate"
              [attr.aria-label]="('COCKPIT.SETTINGS.FEEDBACK' | translate) + ' : ' + ('COCKPIT.LEVEL.' + prefs.level().toUpperCase() | translate)">
        <span class="material-icons" aria-hidden="true">{{ levelIcon() }}</span>
        <span class="ck-chip-label">{{ 'COCKPIT.LEVEL.' + prefs.level().toUpperCase() | translate }}</span>
      </button>
      <button type="button" class="ck-icon" (click)="focus.show('help')" [attr.aria-label]="'COCKPIT.HELP' | translate" [title]="'COCKPIT.HELP' | translate">
        <span class="material-icons" aria-hidden="true">help_outline</span>
      </button>
      <button type="button" class="ck-end" data-cockpit-end (click)="c.end()" [disabled]="c.busy()"
              [attr.aria-label]="(c.busy() ? 'VOICE.ENDING' : 'CONSULTATION.END') | translate">
        <span class="material-icons" aria-hidden="true">stop_circle</span>
        <span class="ck-end-label">{{ (c.busy() ? 'VOICE.ENDING' : 'CONSULTATION.END') | translate }}</span>
      </button>
    </div>

    @switch (alert()) {
      @case ('mic-off') {
        <div class="ck-alert caution" role="alert">
          <span class="material-icons" aria-hidden="true">mic_off</span>
          <span>{{ 'CONSULTATION.MIC_OFF' | translate }}</span>
          <button type="button" class="ck-alert-btn" (click)="c.resumeRecording()">{{ 'CONSULTATION.MIC_RESUME' | translate }}</button>
        </div>
      }
      @case ('suspended') {
        <button type="button" class="ck-alert caution action" role="alert" (click)="voice.resumeMicrophone()">
          <span class="material-icons" aria-hidden="true">touch_app</span>{{ 'VOICE.MIC_SUSPENDED' | translate }}
        </button>
      }
      @case ('paused') {
        <div class="ck-alert" role="status"><span class="material-icons" aria-hidden="true">pause_circle</span>{{ 'COCKPIT.PAUSED' | translate }}</div>
      }
      @case ('service') {
        <div class="ck-alert caution" role="status"><span class="material-icons" aria-hidden="true">cloud_off</span>{{ voice.transcriptionIssue() }}</div>
      }
      @case ('error') {
        <div class="ck-alert critical" role="alert"><span class="material-icons" aria-hidden="true">error</span>{{ voice.error() }}</div>
      }
    }
  `,
  styles: [`
    :host { display: block; }
    .ck-bar { display: flex; align-items: center; gap: .5rem; padding: .5rem .75rem; background: var(--surface); border: 1px solid rgb(var(--ink-200)); border-radius: .75rem; min-width: 0; flex-wrap: nowrap; }
    .ck-rec { display: inline-flex; align-items: center; gap: .375rem; font-weight: 700; font-variant-numeric: tabular-nums; color: rgb(var(--ink-700)); }
    .ck-dot { width: .625rem; height: .625rem; border-radius: 50%; background: rgb(var(--ink-400)); }
    .ck-rec.live .ck-dot { background: rgb(var(--critical-600)); animation: ck-pulse 1.6s ease-in-out infinite; }
    @keyframes ck-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .4; } }
    @media (prefers-reduced-motion: reduce) { .ck-rec.live .ck-dot { animation: none; } }
    .ck-name { font-weight: 700; color: rgb(var(--ink-900)); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
    .ck-allergies { display: inline-flex; align-items: center; gap: .25rem; color: rgb(var(--critical-700)); min-width: 0; overflow: hidden; }
    .ck-allergies .material-icons { font-size: 1.1rem; }
    .ck-allergy { font-size: .8125rem; font-weight: 600; padding: .05rem .4rem; border-radius: 999px; background: rgb(var(--critical-50)); white-space: nowrap; }
    .ck-allergy.new { outline: 1px dashed rgb(var(--critical-400)); }
    .ck-spacer { flex: 1; }
    .ck-icon { display: inline-grid; place-items: center; width: 2.5rem; height: 2.5rem; border-radius: .5rem; color: rgb(var(--ink-700)); flex: none; }
    .ck-icon:hover { background: var(--surface-hover); }
    .ck-mic { display: inline-flex; align-items: center; gap: .25rem; color: rgb(var(--ink-600)); flex: none; }
    .ck-meter { width: .375rem; height: 1.5rem; border-radius: 999px; background: rgb(var(--ink-100)); overflow: hidden; display: flex; align-items: flex-end; }
    .ck-meter span { display: block; width: 100%; height: 100%; background: rgb(var(--positive-500)); transform-origin: bottom; transition: transform .1s linear; }
    .ck-chip { display: inline-flex; align-items: center; gap: .25rem; min-height: 2.5rem; padding: 0 .625rem; border-radius: .5rem; border: 1px solid rgb(var(--ink-200)); font-weight: 600; font-size: .8125rem; color: rgb(var(--ink-800)); flex: none; }
    .ck-chip .material-icons { font-size: 1.1rem; }
    .ck-end { display: inline-flex; align-items: center; gap: .375rem; min-height: 2.5rem; padding: 0 .875rem; border-radius: .5rem; background: rgb(var(--critical-600)); color: #fff; font-weight: 700; flex: none; }
    .ck-end:disabled { opacity: .6; }
    .ck-alert { display: flex; align-items: center; gap: .5rem; margin-top: .375rem; padding: .5rem .75rem; border-radius: .5rem; background: rgb(var(--ink-100)); color: rgb(var(--ink-800)); font-size: .875rem; width: 100%; text-align: start; }
    .ck-alert.caution { background: rgb(var(--caution-50)); color: rgb(var(--caution-800)); }
    .ck-alert.critical { background: rgb(var(--critical-50)); color: rgb(var(--critical-800)); }
    .ck-alert-btn { margin-inline-start: auto; font-weight: 700; text-decoration: underline; }
    @media (max-width: 1099.98px) {
      .ck-name, .ck-allergies, .ck-chip-label { display: none; }
      .ck-bar { padding: .375rem .5rem; gap: .375rem; }
    }
    /* A phone: every control stays, as an icon, and End keeps its colour and its name for screen readers. */
    @media (max-width: 479.98px) {
      .ck-end-label { display: none; }
      .ck-end { padding: 0 .625rem; }
      .ck-icon { width: 2.25rem; }
      .ck-chip { padding: 0 .4rem; }
      .ck-bar { gap: .25rem; }
    }
  `],
})
export class CockpitControlsComponent {
  protected readonly c = inject(ConsultationService);
  protected readonly model = inject(CockpitModelService);
  protected readonly focus = inject(ConsultationFocusService);
  protected readonly voice = inject(VoiceOrchestratorService);
  protected readonly prefs = inject(VoicePreferencesService);
  protected readonly inputLanguage = inject(InputLanguageService);

  /** The back arrow: leaves the dossier; the consultation stays open on the server. */
  readonly leave = output<void>();

  private readonly now = signal(Date.now());

  constructor() {
    const timer = setInterval(() => this.now.set(Date.now()), 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected readonly elapsed = computed(() => {
    const started = this.c.consultation()?.startedAt;
    if (!started) return '0:00';
    const seconds = Math.max(0, Math.floor((this.now() - new Date(started).getTime()) / 1000));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  });

  /** One alert at a time, the most serious first. */
  protected readonly alert = computed<'mic-off' | 'suspended' | 'error' | 'service' | 'paused' | null>(() => {
    if (!this.c.listening()) return 'mic-off';
    if (this.voice.microphoneSuspended()) return 'suspended';
    if (this.voice.error()) return 'error';
    if (this.voice.transcriptionIssue()) return 'service';
    if (this.voice.paused()) return 'paused';
    return null;
  });

  protected readonly levelIcon = computed(() => ({
    full: 'record_voice_over', brief: 'short_text', tones: 'music_note', silent: 'volume_off',
  })[this.prefs.level()]);

  protected cycleLanguage(): void {
    const order = INPUT_LANGUAGES;
    const next = order[(order.indexOf(this.inputLanguage.language()) + 1) % order.length];
    this.inputLanguage.set(next);
  }
}
