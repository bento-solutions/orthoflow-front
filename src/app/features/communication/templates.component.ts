import { Component, ElementRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ApiErrors } from '../../core/services/api-error.service';
import { ConfirmDialogService } from '../../core/services/confirm-dialog.service';
import { LanguageService } from '../../core/services/language.service';
import {
  MESSAGE_CHANNELS, MessageChannel, MessagePurpose, MessageTemplate, MessagingApi, TEMPLATE_PLACEHOLDERS, TemplatePreview,
} from '../../core/services/messaging-api.service';
import { PermissionService } from '../../core/services/permission.service';
import { ToastService } from '../../core/services/toast.service';
import { loadable } from '../../core/utils/loadable';
import { CanDirective } from '../../shared/directives/can.directive';
import { IconComponent } from '../../shared/ui/icon.component';
import { ModalComponent } from '../../shared/ui/modal.component';

const LANGS = ['fr', 'en', 'ar'] as const;

/** Inserts `text` into `value` over the selection `[start, end)`, and says where the caret belongs afterwards. */
export function insertAt(value: string, start: number, end: number, text: string): { value: string; caret: number } {
  const s = Math.max(0, Math.min(start, value.length));
  const e = Math.max(s, Math.min(end, value.length));
  return { value: value.slice(0, s) + text + value.slice(e), caret: s + text.length };
}

/** `{{ name }}` placeholders in a text that the server will not substitute, so they would reach a patient as typed. */
export function unknownPlaceholders(text: string): string[] {
  const known = new Set<string>(TEMPLATE_PLACEHOLDERS);
  return [...new Set([...text.matchAll(/\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*}}/g)].map(m => m[1]).filter(name => !known.has(name)))];
}

/**
 * The wording of every automatic message, per channel and language. A template that was never
 * changed shows the built-in text; editing saves a copy for this clinic, and "back to default"
 * removes the copy. The preview fills the placeholders the way a real message would.
 */
@Component({
  selector: 'app-templates',
  standalone: true,
  imports: [FormsModule, TranslateModule, CanDirective, IconComponent, ModalComponent],
  template: `
    <div class="mb-4 flex flex-wrap items-end gap-3">
      <label class="field w-auto"><span class="label">{{ 'COM.TPL.PURPOSE' | translate }}</span>
        <select class="select w-auto" [ngModel]="purpose()" (ngModelChange)="purpose.set($event)">
          <option value="">{{ 'COMMON.ALL' | translate }}</option>
          @for (p of purposes(); track p) { <option [value]="p">{{ 'COM.PURPOSES.' + p | translate }}</option> }
        </select></label>
      <label class="field w-auto"><span class="label">{{ 'COM.LOGS.CHANNEL' | translate }}</span>
        <select class="select w-auto" [ngModel]="channel()" (ngModelChange)="channel.set($event)">
          <option value="">{{ 'COMMON.ALL' | translate }}</option>
          @for (c of channels; track c) { <option [value]="c">{{ 'COM.CHANNELS.' + c | translate }}</option> }
        </select></label>
      <label class="field w-auto"><span class="label">{{ 'COMMON.LANGUAGE' | translate }}</span>
        <select class="select w-auto" [ngModel]="language()" (ngModelChange)="language.set($event)">
          <option value="">{{ 'COMMON.ALL' | translate }}</option>
          @for (l of langs; track l) { <option [value]="l">{{ 'COM.TPL.LANGS.' + l | translate }}</option> }
        </select></label>
    </div>

    <div class="table-wrap" [attr.aria-busy]="templates.loading()"><div class="table-scroll">
      <table class="data-table">
        <thead><tr>
          <th scope="col">{{ 'COM.TPL.PURPOSE' | translate }}</th><th scope="col">{{ 'COM.LOGS.CHANNEL' | translate }}</th><th scope="col">{{ 'COMMON.LANGUAGE' | translate }}</th>
          <th scope="col">{{ 'COM.TPL.TEXT' | translate }}</th><th scope="col" class="cell-actions"><span class="sr-only">{{ 'COMMON.ACTIONS' | translate }}</span></th>
        </tr></thead>
        <tbody>
          @for (t of rows(); track t.purpose + t.channel + t.language) {
            <tr>
              <td class="font-semibold">{{ 'COM.PURPOSES.' + t.purpose | translate }}
                @if (t.customised) { <span class="pill pill-active pill-nodot ms-2">{{ 'COM.TPL.CUSTOMISED' | translate }}</span> }
                @if (!t.active) { <span class="pill pill-idle pill-nodot ms-2">{{ 'COM.TPL.OFF' | translate }}</span> }</td>
              <td>{{ 'COM.CHANNELS.' + t.channel | translate }}</td>
              <td>{{ 'COM.TPL.LANGS.' + t.language | translate }}</td>
              <td class="max-w-md"><span class="line-clamp-2 text-sm text-ink-700" [attr.dir]="t.language === 'ar' ? 'rtl' : 'ltr'">{{ t.body }}</span></td>
              <td class="cell-actions">
                <button type="button" class="btn btn-ghost btn-icon" (click)="open(t)" [title]="'COM.TPL.OPEN' | translate" [attr.aria-label]="('COM.TPL.OPEN' | translate) + ' — ' + ('COM.PURPOSES.' + t.purpose | translate)"><app-icon [name]="canEdit() ? 'edit' : 'eye'" [size]="16" /></button>
              </td>
            </tr>
          } @empty {
            <tr><td colspan="5" class="py-8 text-center text-ink-500">{{ 'COM.TPL.EMPTY' | translate }}</td></tr>
          }
        </tbody>
      </table>
    </div></div>

    <app-modal [open]="editing() !== null" [title]="'COM.TPL.EDIT' | translate" size="lg" [dismissable]="!busy()" (closed)="editing.set(null)">
      @if (editing(); as t) {
        <p class="mb-3 text-sm text-ink-600">{{ 'COM.PURPOSES.' + t.purpose | translate }} · {{ 'COM.CHANNELS.' + t.channel | translate }} · {{ 'COM.TPL.LANGS.' + t.language | translate }}</p>
        <form id="tpl-form" class="space-y-4" (ngSubmit)="save()">
          @if (t.channel !== 'WHATSAPP') {
            <label class="field"><span class="label">{{ 'COM.TPL.SUBJECT' | translate }}</span>
              <input class="input" name="subject" maxlength="200" [attr.dir]="t.language === 'ar' ? 'rtl' : 'ltr'" [disabled]="!canEdit()" [ngModel]="subject()" (ngModelChange)="subject.set($event)" /></label>
          }
          <label class="field"><span class="label">{{ 'COM.TPL.BODY' | translate }}</span>
            <textarea #bodyBox class="textarea" rows="6" name="body" required [attr.dir]="t.language === 'ar' ? 'rtl' : 'ltr'" [disabled]="!canEdit()" [ngModel]="body()" (ngModelChange)="body.set($event)"></textarea></label>
          @if (canEdit()) {
            <div class="flex flex-wrap items-center gap-1.5" role="group" [attr.aria-label]="'COM.TPL.PLACEHOLDERS' | translate">
              <span class="text-xs text-ink-500">{{ 'COM.TPL.PLACEHOLDERS' | translate }}</span>
              @for (p of placeholders; track p) { <button type="button" class="rounded-md border border-ink-200 px-2 py-0.5 font-mono text-xs text-ink-700 hover:bg-ink-50" (click)="insert(p)">{{ '{{' + p + '}}' }}</button> }
            </div>
          }
          @if (unknown().length) { <p class="rounded-md bg-caution-50 p-2 text-sm text-caution-800" role="alert">{{ 'COM.TPL.UNKNOWN' | translate: { names: unknown().join(', ') } }}</p> }
          <label class="flex items-center gap-2 text-sm"><input type="checkbox" name="active" [disabled]="!canEdit()" [ngModel]="active()" (ngModelChange)="active.set($event)" /> {{ 'COM.TPL.ACTIVE' | translate }}</label>

          <section class="rounded-lg border border-ink-200 bg-ink-50 p-3" aria-live="polite">
            <h3 class="mb-1 text-2xs font-bold uppercase tracking-wider text-ink-500">{{ 'COM.TPL.PREVIEW' | translate }}</h3>
            @if (preview(); as p) {
              @if (p.subject) { <p class="text-sm font-semibold text-ink-900" [attr.dir]="t.language === 'ar' ? 'rtl' : 'ltr'">{{ p.subject }}</p> }
              <p class="whitespace-pre-line text-sm text-ink-800" [attr.dir]="t.language === 'ar' ? 'rtl' : 'ltr'">{{ p.body }}</p>
            }
          </section>
        </form>
      }
      <div modal-footer>
        @if (editing()?.customised && canEdit()) { <button type="button" class="btn btn-ghost me-auto" [disabled]="busy()" (click)="reset()">{{ 'COM.TPL.RESET' | translate }}</button> }
        <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="editing.set(null)">{{ 'COMMON.CLOSE' | translate }}</button>
        <button *appCan="'SETTINGS_MANAGE'" type="submit" form="tpl-form" class="btn btn-primary" [disabled]="busy() || !body().trim()">{{ 'COMMON.SAVE' | translate }}</button>
      </div>
    </app-modal>
  `,
})
export class TemplatesComponent {
  private readonly api = inject(MessagingApi);
  private readonly errors = inject(ApiErrors);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly translate = inject(TranslateService);
  private readonly languages = inject(LanguageService);
  private readonly bodyBox = viewChild<ElementRef<HTMLTextAreaElement>>('bodyBox');
  private readonly permissions = inject(PermissionService);

  protected readonly channels = MESSAGE_CHANNELS;
  protected readonly langs = LANGS;
  protected readonly placeholders = TEMPLATE_PLACEHOLDERS;
  protected readonly purpose = signal('');
  protected readonly channel = signal('');
  protected readonly language = signal<string>(this.languages.currentLang());
  protected readonly templates = loadable<MessageTemplate[]>([]);
  protected readonly purposes = computed(() => [...new Set(this.templates.data().map(t => t.purpose))]);
  protected readonly rows = computed(() => this.templates.data().filter(t =>
    (!this.purpose() || t.purpose === this.purpose()) && (!this.channel() || t.channel === this.channel()) && (!this.language() || t.language === this.language())));
  protected readonly canEdit = computed(() => this.permissions.can('SETTINGS_MANAGE'));

  protected readonly busy = signal(false);
  protected readonly editing = signal<MessageTemplate | null>(null);
  protected readonly subject = signal('');
  protected readonly body = signal('');
  protected readonly active = signal(true);
  protected readonly preview = signal<TemplatePreview | null>(null);
  protected readonly unknown = computed(() => unknownPlaceholders(`${this.subject()} ${this.body()}`));

  constructor() {
    void this.templates.load(() => this.api.templates());
    // The preview follows the text, a moment after the person stops typing.
    let pause: ReturnType<typeof setTimeout> | undefined;
    effect(onCleanup => {
      const t = this.editing();
      const subject = this.subject();
      const body = this.body();
      if (!t) {
        return;
      }
      pause = setTimeout(() => untracked(() => void this.refreshPreview(t, subject, body)), 250);
      onCleanup(() => clearTimeout(pause));
    });
  }

  private async refreshPreview(t: MessageTemplate, subject: string, body: string): Promise<void> {
    try {
      const preview = await this.api.previewTemplate({ purpose: t.purpose as MessagePurpose, channel: t.channel as MessageChannel, language: t.language, subject, body });
      if (this.editing() === t) {
        this.preview.set(preview);
      }
    } catch {
      // a half-typed placeholder is not worth a toast; the last good preview stays
    }
  }

  protected open(t: MessageTemplate): void {
    this.subject.set(t.subject ?? '');
    this.body.set(t.body);
    this.active.set(t.active);
    this.preview.set(null);
    this.editing.set(t);
  }

  protected insert(name: string): void {
    const box = this.bodyBox()?.nativeElement;
    const result = insertAt(this.body(), box?.selectionStart ?? this.body().length, box?.selectionEnd ?? this.body().length, `{{${name}}}`);
    this.body.set(result.value);
    queueMicrotask(() => {
      box?.focus();
      box?.setSelectionRange(result.caret, result.caret);
    });
  }

  protected async save(): Promise<void> {
    const t = this.editing();
    if (!t || this.busy() || !this.body().trim()) {
      return;
    }
    await this.run(async () => {
      await this.api.saveTemplate({
        purpose: t.purpose as MessagePurpose, channel: t.channel as MessageChannel, language: t.language,
        subject: this.subject().trim() || undefined, body: this.body(), active: this.active(),
      });
      this.editing.set(null);
      this.toast.success(this.translate.instant('COM.TPL.SAVED'));
    });
  }

  protected async reset(): Promise<void> {
    const t = this.editing();
    if (!t || !(await this.confirm.confirm(this.translate.instant('COM.TPL.RESET_CONFIRM'), { danger: true }))) {
      return;
    }
    await this.run(async () => {
      await this.api.resetTemplate(t.purpose, t.channel, t.language);
      this.editing.set(null);
      this.toast.success(this.translate.instant('COM.TPL.RESET_DONE'));
    });
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    try {
      await action();
      await this.templates.load(() => this.api.templates());
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.busy.set(false);
    }
  }
}
