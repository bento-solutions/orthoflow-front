import { Component, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { ApiErrors } from '../../core/services/api-error.service';
import { refreshOnLive } from '../../core/services/live-refresh';
import { InboxMessage, MessagingApi } from '../../core/services/messaging-api.service';
import { NavCounts } from '../../core/services/nav-counts.service';
import { loadable } from '../../core/utils/loadable';
import { CanDirective } from '../../shared/directives/can.directive';
import { IconComponent } from '../../shared/ui/icon.component';

/**
 * What patients wrote back on WhatsApp that the system could not act on by itself (a "1" or a "2"
 * to an appointment reminder is handled automatically; anything else lands here for a person).
 */
@Component({
  selector: 'app-whatsapp-inbox',
  standalone: true,
  imports: [DatePipe, FormsModule, RouterLink, TranslateModule, CanDirective, IconComponent],
  template: `
    <div class="mb-4 flex items-center gap-4">
      <label class="flex items-center gap-1.5 text-sm font-semibold text-ink-700"><input type="checkbox" [ngModel]="unhandledOnly()" (ngModelChange)="unhandledOnly.set($event)" /> {{ 'COM.INBOX.UNHANDLED_ONLY' | translate }}</label>
      <label class="flex items-center gap-1.5 text-sm font-semibold text-ink-700"><input type="checkbox" [ngModel]="landingPageOnly()" (ngModelChange)="landingPageOnly.set($event)" /> {{ 'COM.INBOX.LANDING_ONLY' | translate }}</label>
    </div>
    <ul class="card divide-y divide-ink-100" [attr.aria-busy]="inbox.loading()">
      @for (m of inbox.data(); track m.id) {
        <li class="flex items-start gap-3 px-4 py-3">
          <span class="mt-0.5 text-ink-400" aria-hidden="true"><app-icon name="message" [size]="18" /></span>
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold text-ink-900">
              @if (m.patientId) { <a class="no-underline hover:text-petrol-700" [routerLink]="['/patients', m.patientId]">{{ m.patientName }}</a> } @else { {{ 'COM.INBOX.UNKNOWN' | translate }} }
              <span class="ms-2 text-xs font-normal text-ink-500">{{ m.fromPhone }}</span>
              @if (m.fromLandingPage) { <span class="pill pill-active pill-nodot ms-2">{{ 'COM.INBOX.LANDING_BADGE' | translate }}</span> }
            </p>
            <p class="whitespace-pre-line text-sm text-ink-700">{{ m.body }}</p>
            <p class="mt-0.5 text-2xs text-ink-500">{{ m.occurredAt | date: 'medium' }}@if (m.handledAt) { · {{ 'COM.INBOX.HANDLED_AT' | translate: { at: (m.handledAt | date: 'short') } }} }</p>
          </div>
          @if (!m.handledAt) {
            <button *appCan="'MESSAGING_SEND'" type="button" class="btn btn-secondary btn-sm shrink-0" [disabled]="busy()" (click)="handle(m)">{{ 'COM.INBOX.MARK_HANDLED' | translate }}</button>
          }
        </li>
      } @empty {
        <li class="py-10 text-center text-ink-500">{{ 'COM.INBOX.EMPTY' | translate }}</li>
      }
    </ul>
  `,
})
export class WhatsappInboxComponent {
  private readonly api = inject(MessagingApi);
  private readonly errors = inject(ApiErrors);
  private readonly counts = inject(NavCounts);

  protected readonly unhandledOnly = signal(true);
  /** Only people who reached the clinic through its landing page (a number shared with the CRM keeps nobody else). */
  protected readonly landingPageOnly = signal(false);
  protected readonly inbox = loadable<InboxMessage[]>([]);
  protected readonly busy = signal(false);

  constructor() {
    effect(() => {
      const only = this.unhandledOnly();
      const landing = this.landingPageOnly();
      untracked(() => void this.inbox.load(() => this.api.inbox(only, 100, landing)));
    });
    refreshOnLive(['whatsapp-inbox'], () => void this.reload());
  }

  private reload(): Promise<boolean> {
    return this.inbox.load(() => this.api.inbox(this.unhandledOnly(), 100, this.landingPageOnly()));
  }

  protected async handle(message: InboxMessage): Promise<void> {
    this.busy.set(true);
    try {
      await this.api.markHandled(message.id);
      await Promise.all([this.reload(), this.counts.refreshInbox()]);
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.busy.set(false);
    }
  }
}
