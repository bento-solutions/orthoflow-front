import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { ApiErrors } from '../../core/services/api-error.service';
import { refreshOnLive } from '../../core/services/live-refresh';
import { NavCounts } from '../../core/services/nav-counts.service';
import { OperationsApi, StaffPerson, ThreadDetail, ThreadRow } from '../../core/services/operations-api.service';
import { loadable } from '../../core/utils/loadable';
import { IconComponent } from '../../shared/ui/icon.component';
import { ModalComponent } from '../../shared/ui/modal.component';

/**
 * Staff-to-staff messages: threads between people at the clinic, not with patients. A thread is
 * opened to read it, which marks it read; a new message reaches everyone in it at once.
 */
@Component({
  selector: 'app-messages',
  standalone: true,
  imports: [DatePipe, FormsModule, TranslateModule, IconComponent, ModalComponent],
  template: `
    <div class="anim-rise">
      <header class="page-head">
        <div>
          <h1 class="page-title">{{ 'MSG.TITLE' | translate }}</h1>
          <p class="page-sub">{{ 'MSG.SUBTITLE' | translate }}</p>
        </div>
        <div class="page-actions">
          <button type="button" class="btn btn-primary" (click)="openNew()"><app-icon name="plus" [size]="16" /> {{ 'MSG.NEW' | translate }}</button>
        </div>
      </header>

      <div class="grid gap-4 lg:grid-cols-[20rem_1fr]">
        <ul class="card max-h-[70vh] divide-y divide-ink-100 overflow-y-auto" [attr.aria-busy]="threads.loading()" [attr.aria-label]="'MSG.THREADS' | translate">
          @for (t of threads.data(); track t.id) {
            <li>
              <button type="button" class="block w-full px-4 py-3 text-start hover:bg-ink-50" [class.bg-ink-50]="selectedId() === t.id" [attr.aria-current]="selectedId() === t.id" (click)="open(t.id)">
                <span class="flex items-center justify-between gap-2">
                  <span class="truncate text-sm" [class.font-bold]="t.unread > 0" [class.text-ink-900]="t.unread > 0">{{ t.subject }}</span>
                  @if (t.unread > 0) { <span class="grid min-w-5 place-items-center rounded-full bg-petrol-600 px-1.5 text-2xs font-bold leading-5 text-white">{{ t.unread }}</span> }
                </span>
                <span class="block truncate text-xs text-ink-500">{{ t.participants.join(', ') }}</span>
                <span class="block truncate text-xs text-ink-600"><strong>{{ t.lastSender }}</strong>: {{ t.preview }}</span>
                <span class="block text-2xs text-ink-400">{{ t.lastMessageAt | date: 'short' }}</span>
              </button>
            </li>
          } @empty {
            <li class="px-4 py-8 text-center text-sm text-ink-500">{{ 'MSG.EMPTY' | translate }}</li>
          }
        </ul>

        <section class="card flex min-h-[20rem] flex-col" [attr.aria-label]="'MSG.CONVERSATION' | translate">
          @if (detail(); as d) {
            <header class="border-b border-ink-100 px-4 py-3">
              <h2 class="font-bold text-ink-900">{{ d.subject }}</h2>
              <p class="text-xs text-ink-500">{{ participantNames(d) }}</p>
            </header>
            <ol class="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
              @for (m of d.messages; track m.id) {
                <li class="flex flex-col" [class.items-end]="m.mine">
                  <span class="max-w-[85%] whitespace-pre-line rounded-lg px-3 py-2 text-sm" [class.bg-petrol-600]="m.mine" [class.text-white]="m.mine" [class.bg-ink-100]="!m.mine" [class.text-ink-900]="!m.mine">{{ m.body }}</span>
                  <span class="mt-0.5 text-2xs text-ink-500">{{ m.mine ? ('MSG.YOU' | translate) : m.senderName }} · {{ m.createdAt | date: 'short' }}</span>
                </li>
              }
            </ol>
            <form class="flex items-end gap-2 border-t border-ink-100 p-3" (ngSubmit)="sendReply()">
              <label class="field flex-1"><span class="sr-only">{{ 'MSG.REPLY' | translate }}</span>
                <textarea class="textarea" rows="2" name="reply" [placeholder]="'MSG.REPLY' | translate" [ngModel]="reply()" (ngModelChange)="reply.set($event)" (keydown.control.enter)="sendReply()" (keydown.meta.enter)="sendReply()"></textarea></label>
              <button type="submit" class="btn btn-primary" [disabled]="busy() || !reply().trim()"><app-icon name="send" [size]="15" /> {{ 'MSG.SEND' | translate }}</button>
            </form>
          } @else {
            <p class="m-auto px-4 py-12 text-center text-ink-500">{{ 'MSG.PICK' | translate }}</p>
          }
        </section>
      </div>
    </div>

    <app-modal [open]="composing()" [title]="'MSG.NEW' | translate" size="md" [dismissable]="!busy()" (closed)="composing.set(false)">
      <form id="msg-form" class="space-y-4" (ngSubmit)="create()">
        <fieldset class="field">
          <legend class="label label-required">{{ 'MSG.TO' | translate }}</legend>
          <div class="grid gap-1 sm:grid-cols-2">
            @for (p of people(); track p.id) {
              <label class="flex items-center gap-2 text-sm"><input type="checkbox" [checked]="recipients().has(p.id)" (change)="toggleRecipient(p.id, $any($event.target).checked)" /> {{ p.name }} <span class="text-xs text-ink-500">{{ 'TASK.ROLES.' + p.role | translate }}</span></label>
            } @empty { <span class="text-sm text-ink-500">{{ 'MSG.NO_ONE' | translate }}</span> }
          </div>
        </fieldset>
        <label class="field"><span class="label label-required">{{ 'MSG.SUBJECT' | translate }}</span><input class="input" name="subject" required maxlength="200" [ngModel]="subject()" (ngModelChange)="subject.set($event)" /></label>
        <label class="field"><span class="label label-required">{{ 'MSG.MESSAGE' | translate }}</span><textarea class="textarea" rows="4" name="body" required [ngModel]="body()" (ngModelChange)="body.set($event)"></textarea></label>
      </form>
      <div modal-footer>
        <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="composing.set(false)">{{ 'COMMON.CANCEL' | translate }}</button>
        <button type="submit" form="msg-form" class="btn btn-primary" [disabled]="busy() || recipients().size === 0 || !subject().trim() || !body().trim()">{{ 'MSG.SEND' | translate }}</button>
      </div>
    </app-modal>
  `,
})
export class MessagesComponent {
  private readonly api = inject(OperationsApi);
  private readonly errors = inject(ApiErrors);
  private readonly counts = inject(NavCounts);

  protected readonly threads = loadable<ThreadRow[]>([]);
  protected readonly people = signal<StaffPerson[]>([]);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly detail = signal<ThreadDetail | null>(null);
  protected readonly reply = signal('');
  protected readonly busy = signal(false);

  protected readonly composing = signal(false);
  protected readonly recipients = signal<ReadonlySet<string>>(new Set());
  protected readonly subject = signal('');
  protected readonly body = signal('');
  protected readonly unread = computed(() => this.threads.data().reduce((n, t) => n + t.unread, 0));

  constructor() {
    this.api.recipients().then(p => this.people.set(p)).catch(() => undefined);
    effect(() => {
      untracked(() => void this.threads.load(() => this.api.threads()));
    });
    // A message arrived: the list, the open conversation and the unread counts all change.
    refreshOnLive(['staff-message'], () => {
      void this.threads.load(() => this.api.threads());
      const id = this.selectedId();
      if (id) {
        void this.open(id);
      }
    });
  }

  protected participantNames(d: ThreadDetail): string {
    return d.participants.map(p => p.name).join(', ');
  }

  protected async open(id: string): Promise<void> {
    this.selectedId.set(id);
    try {
      const detail = await this.api.thread(id);
      if (this.selectedId() === id) {
        this.detail.set(detail);
      }
      // Opening a conversation reads it.
      void this.counts.refreshMessages();
      void this.threads.load(() => this.api.threads());
    } catch (error) {
      this.errors.report(error);
    }
  }

  protected async sendReply(): Promise<void> {
    const id = this.selectedId();
    const text = this.reply().trim();
    if (!id || !text || this.busy()) {
      return;
    }
    this.busy.set(true);
    try {
      this.detail.set(await this.api.reply(id, text));
      this.reply.set('');
      await this.threads.load(() => this.api.threads());
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.busy.set(false);
    }
  }

  protected openNew(): void {
    this.recipients.set(new Set());
    this.subject.set('');
    this.body.set('');
    this.composing.set(true);
  }

  protected toggleRecipient(id: string, on: boolean): void {
    this.recipients.update(s => {
      const next = new Set(s);
      if (on) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  protected async create(): Promise<void> {
    if (this.busy() || this.recipients().size === 0 || !this.subject().trim() || !this.body().trim()) {
      return;
    }
    this.busy.set(true);
    try {
      const created = await this.api.newThread({ subject: this.subject().trim(), recipientIds: [...this.recipients()], body: this.body().trim() });
      this.composing.set(false);
      this.selectedId.set(created.id);
      this.detail.set(created);
      await this.threads.load(() => this.api.threads());
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.busy.set(false);
    }
  }
}
