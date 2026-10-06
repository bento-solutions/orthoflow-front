import { Component, ElementRef, HostListener, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { DatePipe } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { Notification, NotificationService, notificationLink } from '../../core/services/notification.service';
import { IconComponent } from '../../shared/ui/icon.component';

/** The bell in the header: a count, and a list of what the system has told this person. */
@Component({
  selector: 'app-notification-bell',
  standalone: true,
  imports: [TranslateModule, IconComponent, DatePipe],
  template: `
    <div class="relative">
      <button type="button" class="btn btn-ghost btn-icon relative" (click)="toggle()" aria-haspopup="dialog" [attr.aria-expanded]="open()"
        [attr.aria-label]="('COMMON.NOTIFICATIONS' | translate) + (notifications.unread() ? ' (' + notifications.unread() + ')' : '')">
        <app-icon name="bell" [size]="18" />
        @if (notifications.unread() > 0) {
          <span class="absolute end-1 top-1 grid min-w-4 place-items-center rounded-full bg-critical-500 px-1 text-[10px] font-bold leading-4 text-white">
            {{ notifications.unread() > 9 ? '9+' : notifications.unread() }}
          </span>
        }
      </button>
      @if (open()) {
        <div role="dialog" [attr.aria-label]="'COMMON.NOTIFICATIONS' | translate"
          class="absolute end-0 z-30 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-ink-200 bg-surface shadow-lg">
          <div class="flex items-center justify-between border-b border-ink-100 px-3 py-2">
            <h2 class="text-sm font-bold text-ink-900">{{ 'COMMON.NOTIFICATIONS' | translate }}</h2>
            @if (notifications.unread() > 0) {
              <button type="button" class="text-xs font-semibold text-petrol-700 hover:underline" (click)="notifications.markAllRead()">
                {{ 'COMMON.MARK_ALL_READ' | translate }}
              </button>
            }
          </div>
          <ul class="max-h-96 overflow-y-auto">
            @for (n of notifications.items(); track n.id) {
              <li>
                <button type="button" class="block w-full border-b border-ink-100 px-3 py-2.5 text-start last:border-0 hover:bg-ink-50" (click)="go(n)">
                  <span class="flex items-start gap-2">
                    @if (!n.read) { <span class="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-petrol-500" aria-hidden="true"></span> }
                    <span class="min-w-0">
                      <span class="block truncate text-sm" [class.font-bold]="!n.read" [class.text-ink-900]="!n.read" [class.text-ink-600]="n.read">{{ n.subject }}</span>
                      <span class="line-clamp-2 block text-xs text-ink-500">{{ n.body }}</span>
                      <span class="mt-0.5 block text-2xs text-ink-400">{{ n.createdAt | date: 'short' }}</span>
                    </span>
                  </span>
                </button>
              </li>
            } @empty {
              <li class="px-3 py-6 text-center text-sm text-ink-500">{{ 'COMMON.NO_NOTIFICATIONS' | translate }}</li>
            }
          </ul>
        </div>
      }
    </div>
  `,
})
export class NotificationBellComponent {
  protected readonly notifications = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly host = inject(ElementRef<HTMLElement>);
  protected readonly open = signal(false);

  protected toggle(): void {
    this.open.update(v => !v);
    if (this.open()) {
      void this.notifications.load();
    }
  }

  protected async go(notification: Notification): Promise<void> {
    this.open.set(false);
    if (!notification.read) {
      await this.notifications.markRead(notification.id);
    }
    const link = notificationLink(notification.relatedType, notification.relatedId);
    if (link) {
      await this.router.navigateByUrl(link);
    }
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: Event): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) {
      this.open.set(false);
    }
  }

  @HostListener('keydown.escape')
  protected onEscape(): void {
    this.open.set(false);
  }
}
