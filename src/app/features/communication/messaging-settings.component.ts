import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ApiErrors } from '../../core/services/api-error.service';
import { MESSAGE_CHANNELS, MessageChannel, MessagingApi, MessagingSettings, WhatsAppStatus } from '../../core/services/messaging-api.service';
import { PermissionService } from '../../core/services/permission.service';
import { ToastService } from '../../core/services/toast.service';
import { formState } from '../../core/utils/form-state';
import { loadable } from '../../core/utils/loadable';
import { CanDirective } from '../../shared/directives/can.directive';

/** How healthy the WhatsApp link looks from the state the bridge reports. */
export function whatsappTone(status: Pick<WhatsAppStatus, 'enabled' | 'sessionState'>): 'off' | 'good' | 'bad' | 'wait' {
  if (!status.enabled) {
    return 'off';
  }
  const state = (status.sessionState ?? '').toLowerCase();
  if (state === 'open' || state === 'connected' || state === 'ready') {
    return 'good';
  }
  if (state === 'unreachable' || state === '' || state === 'close' || state === 'closed' || state === 'logged_out') {
    return 'bad';
  }
  return 'wait';
}

/** Hours as the person thinks of them ("17:00"), whatever the server stores (0-23). */
export const SEND_HOURS = Array.from({ length: 24 }, (_, h) => h);

/**
 * When automatic messages go out, the state of the WhatsApp connection, and a way to send a test
 * message before relying on any of it. The WhatsApp connection itself is set up on the server
 * (see the runbook), not here.
 */
@Component({
  selector: 'app-messaging-settings',
  standalone: true,
  imports: [DatePipe, FormsModule, TranslateModule, CanDirective],
  template: `
    <div class="grid gap-5 xl:grid-cols-2">
      <section class="card">
        <div class="card-head"><h2 class="card-title">{{ 'COM.SET.WHATSAPP' | translate }}</h2></div>
        <div class="space-y-3 p-4 text-sm">
          @if (whatsapp.data(); as w) {
            <p class="flex items-center gap-2">
              <span class="pill" [class]="'pill ' + toneClass()">{{ 'COM.SET.STATE.' + tone() | translate }}</span>
              @if (w.sessionState) { <span class="mono text-xs text-ink-500">{{ w.sessionState }}</span> }
            </p>
            @if (!w.enabled) { <p class="text-ink-600">{{ 'COM.SET.OFF_HELP' | translate }}</p> }
            @else if (tone() === 'bad') { <p class="text-critical-700">{{ 'COM.SET.BAD_HELP' | translate }}</p> }
            @if (w.lastReportedAt) { <p class="text-xs text-ink-500">{{ 'COM.SET.LAST_REPORT' | translate: { state: w.lastReportedState, at: (w.lastReportedAt | date: 'medium') } }}</p> }
            <p class="text-ink-600">{{ 'COM.SET.UNHANDLED' | translate: { count: w.unhandledReplies } }}</p>
          }
        </div>
      </section>

      <section class="card">
        <div class="card-head"><h2 class="card-title">{{ 'COM.SET.TEST' | translate }}</h2></div>
        <form class="space-y-3 p-4" (ngSubmit)="sendTest()">
          <p class="text-sm text-ink-600">{{ 'COM.SET.TEST_HINT' | translate }}</p>
          <div class="grid gap-3 sm:grid-cols-3">
            <label class="field"><span class="label">{{ 'COM.LOGS.CHANNEL' | translate }}</span>
              <select class="select" name="channel" [ngModel]="testChannel()" (ngModelChange)="testChannel.set($event)">
                @for (c of testChannels; track c) { <option [value]="c">{{ 'COM.CHANNELS.' + c | translate }}</option> }
              </select></label>
            <label class="field sm:col-span-2"><span class="label">{{ (testChannel() === 'EMAIL' ? 'COM.SET.TEST_EMAIL' : 'COM.SET.TEST_PHONE') | translate }}</span>
              <input class="input" name="recipient" required [type]="testChannel() === 'EMAIL' ? 'email' : 'tel'" [ngModel]="recipient()" (ngModelChange)="recipient.set($event)" /></label>
          </div>
          <button *appCan="'SETTINGS_MANAGE'" type="submit" class="btn btn-secondary" [disabled]="busy() || !recipient().trim()">{{ 'COM.SET.SEND_TEST' | translate }}</button>
        </form>
      </section>

      <section class="card xl:col-span-2">
        <div class="card-head"><h2 class="card-title">{{ 'COM.SET.REMINDERS' | translate }}</h2></div>
        <form class="space-y-5 p-4" (ngSubmit)="save()">
          <fieldset [disabled]="!canEdit()" class="space-y-5">
            <div class="space-y-2">
              <label class="flex items-center gap-2 text-sm font-semibold text-ink-900"><input type="checkbox" name="appt" [ngModel]="form.value().appointmentReminders" (ngModelChange)="form.set('appointmentReminders', $event)" /> {{ 'COM.SET.APPT' | translate }}</label>
              <p class="ps-6 text-sm text-ink-600">{{ 'COM.SET.APPT_HINT' | translate }}</p>
              <label class="field ps-6 sm:max-w-xs"><span class="label">{{ 'COM.SET.SEND_HOUR' | translate }}</span>
                <select class="select" name="hour" [disabled]="!form.value().appointmentReminders" [ngModel]="form.value().reminderSendHour" (ngModelChange)="form.set('reminderSendHour', +$event)">
                  @for (h of hours; track h) { <option [ngValue]="h">{{ h < 10 ? '0' + h : h }}:00</option> }
                </select></label>
            </div>
            <div class="space-y-2">
              <label class="flex items-center gap-2 text-sm font-semibold text-ink-900"><input type="checkbox" name="inst" [ngModel]="form.value().instalmentReminders" (ngModelChange)="form.set('instalmentReminders', $event)" /> {{ 'COM.SET.INST' | translate }}</label>
              <label class="field ps-6 sm:max-w-xs"><span class="label">{{ 'COM.SET.INST_DAYS' | translate }}</span>
                <input class="input" type="number" min="0" max="30" name="days" [disabled]="!form.value().instalmentReminders" [ngModel]="form.value().instalmentDaysBefore" (ngModelChange)="form.set('instalmentDaysBefore', +$event || 0)" /></label>
            </div>
            <div class="space-y-2">
              <label class="flex items-center gap-2 text-sm font-semibold text-ink-900"><input type="checkbox" name="survey" [ngModel]="form.value().surveyEnabled" (ngModelChange)="form.set('surveyEnabled', $event)" /> {{ 'COM.SET.SURVEY' | translate }}</label>
              <p class="ps-6 text-sm text-ink-600">{{ 'COM.SET.SURVEY_HINT' | translate }}</p>
              <label class="field ps-6 sm:max-w-xs"><span class="label">{{ 'COM.SET.SURVEY_DELAY' | translate }}</span>
                <input class="input" type="number" min="0" max="72" name="delay" [disabled]="!form.value().surveyEnabled" [ngModel]="form.value().surveyDelayHours" (ngModelChange)="form.set('surveyDelayHours', +$event || 0)" /></label>
            </div>
          </fieldset>
          <button *appCan="'SETTINGS_MANAGE'" type="submit" class="btn btn-primary" [disabled]="busy() || !dirty()">{{ 'COMMON.SAVE' | translate }}</button>
        </form>
      </section>
    </div>
  `,
  styles: [`.card-title { font-size: var(--text-md); font-weight: 700; color: var(--text); }`],
})
export class MessagingSettingsComponent {
  private readonly api = inject(MessagingApi);
  private readonly errors = inject(ApiErrors);
  private readonly toast = inject(ToastService);
  private readonly translate = inject(TranslateService);
  private readonly permissions = inject(PermissionService);

  protected readonly hours = SEND_HOURS;
  protected readonly testChannels: MessageChannel[] = MESSAGE_CHANNELS.filter(c => c !== 'IN_APP');
  protected readonly canEdit = computed(() => this.permissions.can('SETTINGS_MANAGE'));
  protected readonly whatsapp = loadable<WhatsAppStatus | null>(null);
  protected readonly tone = computed(() => (this.whatsapp.data() ? whatsappTone(this.whatsapp.data()!) : 'off'));
  protected readonly toneClass = computed(() => ({ off: 'pill-idle', good: 'pill-done', bad: 'pill-critical', wait: 'pill-attention' })[this.tone()]);

  protected readonly form = formState<MessagingSettings>({
    appointmentReminders: false, reminderSendHour: 17, instalmentReminders: false, instalmentDaysBefore: 2, surveyEnabled: false, surveyDelayHours: 3,
  });
  private readonly saved = signal<MessagingSettings | null>(null);
  protected readonly dirty = computed(() => JSON.stringify(this.form.value()) !== JSON.stringify(this.saved()));
  protected readonly busy = signal(false);
  protected readonly testChannel = signal<MessageChannel>('WHATSAPP');
  protected readonly recipient = signal('');

  constructor() {
    void this.whatsapp.load(() => this.api.whatsappStatus());
    effect(() => {
      untracked(() => void this.loadSettings());
    });
  }

  private async loadSettings(): Promise<void> {
    try {
      const settings = await this.api.settings();
      this.form.reset(settings);
      this.saved.set(settings);
    } catch (error) {
      this.errors.report(error);
    }
  }

  protected async save(): Promise<void> {
    if (this.busy() || !this.dirty()) {
      return;
    }
    this.busy.set(true);
    try {
      const saved = await this.api.saveSettings(this.form.value());
      this.form.reset(saved);
      this.saved.set(saved);
      this.toast.success(this.translate.instant('COM.SET.SAVED'));
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.busy.set(false);
    }
  }

  protected async sendTest(): Promise<void> {
    if (this.busy() || !this.recipient().trim()) {
      return;
    }
    this.busy.set(true);
    try {
      await this.api.sendTest(this.testChannel(), this.recipient().trim());
      this.toast.success(this.translate.instant('COM.SET.TEST_QUEUED'));
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.busy.set(false);
    }
  }
}
