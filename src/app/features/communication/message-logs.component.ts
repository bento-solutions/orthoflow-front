import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { ApiErrors } from '../../core/services/api-error.service';
import { refreshOnLive } from '../../core/services/live-refresh';
import { MESSAGE_CHANNELS, MESSAGE_STATUSES, MessageLog, MessageLogPage, MessagingApi } from '../../core/services/messaging-api.service';
import { loadable } from '../../core/utils/loadable';
import { CanDirective } from '../../shared/directives/can.directive';

const PAGE_SIZE = 25;

/** What a person can do about a message: try again when it failed, withdraw it while it still waits. */
export function logActions(log: Pick<MessageLog, 'status'>): { retry: boolean; cancel: boolean } {
  return { retry: log.status === 'FAILED', cancel: log.status === 'QUEUED' };
}

export function statusTone(status: MessageLog['status']): string {
  switch (status) {
    case 'DELIVERED':
    case 'READ':
      return 'pill-done';
    case 'SENT':
      return 'pill-active';
    case 'FAILED':
      return 'pill-critical';
    case 'QUEUED':
    case 'SENDING':
      return 'pill-attention';
    default:
      return 'pill-idle';
  }
}

/**
 * Everything the clinic sent, or tried to: WhatsApp, e-mail and in-app notices, with where each
 * one got to. The body is kept for the retention period the clinic chose and then wiped; the row
 * stays, so the history of what was sent never has holes.
 */
@Component({
  selector: 'app-message-logs',
  standalone: true,
  imports: [DatePipe, FormsModule, RouterLink, TranslateModule, CanDirective],
  template: `
    <div class="mb-4 flex flex-wrap items-end gap-3">
      <label class="field w-auto"><span class="label">{{ 'COM.LOGS.CHANNEL' | translate }}</span>
        <select class="select w-auto" [ngModel]="channel()" (ngModelChange)="setChannel($event)">
          <option value="">{{ 'COMMON.ALL' | translate }}</option>
          @for (c of channels; track c) { <option [value]="c">{{ 'COM.CHANNELS.' + c | translate }}</option> }
        </select></label>
      <label class="field w-auto"><span class="label">{{ 'COMMON.STATUS' | translate }}</span>
        <select class="select w-auto" [ngModel]="status()" (ngModelChange)="setStatus($event)">
          <option value="">{{ 'COMMON.ALL' | translate }}</option>
          @for (s of statuses; track s) { <option [value]="s">{{ 'COM.STATUSES.' + s | translate }}</option> }
        </select></label>
      <button type="button" class="btn btn-ghost btn-sm" (click)="reload()">{{ 'COMMON.REFRESH' | translate }}</button>
    </div>

    <div class="table-wrap" [attr.aria-busy]="logs.loading()"><div class="table-scroll">
      <table class="data-table">
        <thead><tr>
          <th scope="col">{{ 'COM.LOGS.WHEN' | translate }}</th><th scope="col">{{ 'COM.LOGS.CHANNEL' | translate }}</th><th scope="col">{{ 'COM.LOGS.PURPOSE' | translate }}</th>
          <th scope="col">{{ 'COM.LOGS.RECIPIENT' | translate }}</th><th scope="col">{{ 'COMMON.STATUS' | translate }}</th><th scope="col" class="cell-actions"><span class="sr-only">{{ 'COMMON.ACTIONS' | translate }}</span></th>
        </tr></thead>
        <tbody>
          @for (m of rows(); track m.id) {
            <tr>
              <td class="whitespace-nowrap">{{ m.createdAt | date: 'short' }}</td>
              <td>{{ 'COM.CHANNELS.' + m.channel | translate }}</td>
              <td>{{ 'COM.PURPOSES.' + m.purpose | translate }}
                @if (m.bodyPurged) { <span class="block text-xs text-ink-500">{{ 'COM.LOGS.PURGED' | translate }}</span> }
                @else if (m.body) { <details class="text-xs text-ink-600"><summary class="cursor-pointer">{{ m.subject || ('COM.LOGS.SHOW' | translate) }}</summary><p class="mt-1 max-w-md whitespace-pre-line">{{ m.body }}</p></details> }</td>
              <td>@if (m.patientId) { <a class="text-ink-900 no-underline hover:text-petrol-700" [routerLink]="['/patients', m.patientId]">{{ m.recipient }}</a> } @else { {{ m.recipient }} }</td>
              <td>
                <span class="pill" [class]="'pill ' + tone(m.status)">{{ 'COM.STATUSES.' + m.status | translate }}</span>
                @if (m.status === 'FAILED' && m.lastError) { <span class="block max-w-xs truncate text-xs text-critical-700" [title]="m.lastError">{{ m.lastError }}</span> }
                @if (m.attempts > 1) { <span class="block text-xs text-ink-500">{{ 'COM.LOGS.ATTEMPTS' | translate: { count: m.attempts } }}</span> }
                @if (m.status === 'QUEUED' && m.scheduledFor) { <span class="block text-xs text-ink-500">{{ m.scheduledFor | date: 'short' }}</span> }
              </td>
              <td class="cell-actions">
                <span *appCan="'MESSAGING_SEND'" class="inline-flex gap-1">
                  @if (actions(m).retry) { <button type="button" class="btn btn-secondary btn-sm" [disabled]="busy()" (click)="act(m, 'retry')">{{ 'COM.LOGS.RETRY' | translate }}</button> }
                  @if (actions(m).cancel) { <button type="button" class="btn btn-ghost btn-sm" [disabled]="busy()" (click)="act(m, 'cancel')">{{ 'COMMON.CANCEL' | translate }}</button> }
                </span>
              </td>
            </tr>
          } @empty {
            <tr><td colspan="6" class="py-8 text-center text-ink-500">{{ 'COM.LOGS.EMPTY' | translate }}</td></tr>
          }
        </tbody>
      </table>
    </div></div>

    @if (total() > 0) {
      <nav class="mt-4 flex items-center justify-between text-sm text-ink-600" [attr.aria-label]="'PAT.PAGES' | translate">
        <span>{{ 'PAT.SHOWING' | translate: { from: from(), to: to(), total: total() } }}</span>
        <span class="flex items-center gap-2">
          <button type="button" class="btn btn-secondary btn-sm" [disabled]="page() === 0" (click)="page.set(page() - 1)">{{ 'COMMON.PREVIOUS' | translate }}</button>
          <span class="tabular-nums">{{ page() + 1 }} / {{ pages() }}</span>
          <button type="button" class="btn btn-secondary btn-sm" [disabled]="page() + 1 >= pages()" (click)="page.set(page() + 1)">{{ 'COMMON.NEXT' | translate }}</button>
        </span>
      </nav>
    }
  `,
})
export class MessageLogsComponent {
  private readonly api = inject(MessagingApi);
  private readonly errors = inject(ApiErrors);

  protected readonly channels = MESSAGE_CHANNELS;
  protected readonly statuses = MESSAGE_STATUSES;
  protected readonly actions = logActions;
  protected readonly tone = statusTone;
  protected readonly channel = signal('');
  protected readonly status = signal('');
  protected readonly page = signal(0);
  protected readonly busy = signal(false);
  protected readonly logs = loadable<MessageLogPage | null>(null);

  protected readonly rows = computed(() => this.logs.data()?.content ?? []);
  protected readonly total = computed(() => this.logs.data()?.totalElements ?? 0);
  protected readonly pages = computed(() => Math.max(this.logs.data()?.totalPages ?? 1, 1));
  protected readonly from = computed(() => this.page() * PAGE_SIZE + 1);
  protected readonly to = computed(() => this.page() * PAGE_SIZE + this.rows().length);

  private readonly query = computed(() => ({ channel: this.channel(), status: this.status(), page: this.page(), size: PAGE_SIZE }));

  constructor() {
    effect(() => {
      const query = this.query();
      untracked(() => void this.logs.load(() => this.api.logs(query)));
    });
    // A message was queued, sent or came back failed: the list moves on its own.
    refreshOnLive(['notification', 'whatsapp-inbox'], () => this.reload());
  }

  protected setChannel(value: string): void {
    this.channel.set(value);
    this.page.set(0);
  }

  protected setStatus(value: string): void {
    this.status.set(value);
    this.page.set(0);
  }

  protected reload(): void {
    void this.logs.load(() => this.api.logs(this.query()));
  }

  protected async act(log: MessageLog, action: 'retry' | 'cancel'): Promise<void> {
    this.busy.set(true);
    try {
      await (action === 'retry' ? this.api.retry(log.id) : this.api.cancel(log.id));
      await this.logs.load(() => this.api.logs(this.query()));
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.busy.set(false);
    }
  }
}
