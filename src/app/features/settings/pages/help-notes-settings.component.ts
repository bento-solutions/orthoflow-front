import { Component, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { api } from '../../../core/api/url';
import type { Wire } from '../../../core/api/wire';
import { ApiErrors } from '../../../core/services/api-error.service';
import { ToastService } from '../../../core/services/toast.service';
import { formState } from '../../../core/utils/form-state';
import { loadable } from '../../../core/utils/loadable';
import { ModalComponent } from '../../../shared/ui/modal.component';

type Note = Wire<'NoteView'>;

/**
 * The text behind the help button. Each screen has a note shipped with the product;
 * a clinic can reword one for its own way of working, and restore the original. The
 * assistant answers from whatever these say, so a wrong note is a wrong answer.
 */
@Component({
  selector: 'app-help-notes-settings',
  standalone: true,
  imports: [FormsModule, TranslateModule, ModalComponent],
  template: `
    <section class="card">
      <div class="card-head">
        <div>
          <h2 class="text-lg font-bold text-ink-900">{{ 'SET.HELP_NOTES.TITLE' | translate }}</h2>
          <p class="text-sm text-ink-500">{{ 'SET.HELP_NOTES.HINT' | translate }}</p>
        </div>
        <div class="seg" role="group" [attr.aria-label]="'COMMON.LANGUAGE' | translate">
          @for (l of languages; track l) {
            <button type="button" class="seg-item" [class.is-active]="lang() === l" [attr.aria-pressed]="lang() === l" (click)="setLang(l)">{{ l.toUpperCase() }}</button>
          }
        </div>
      </div>
      <ul class="divide-y divide-ink-100">
        @for (n of notes.data(); track n.pageKey) {
          <li class="flex items-start gap-4 px-5 py-3">
            <div class="min-w-0 flex-1">
              <p class="font-semibold text-ink-900">{{ n.title }} <span class="mono text-2xs text-ink-400">{{ n.pageKey }}</span>
                @if (n.customised) { <span class="pill pill-active ms-1">{{ 'SET.PERMISSIONS.CUSTOM' | translate }}</span> }
                @if (n.lang !== lang()) { <span class="pill pill-attention ms-1">{{ n.lang.toUpperCase() }}</span> }</p>
              <p class="line-clamp-2 text-sm text-ink-600">{{ n.body }}</p>
            </div>
            <button type="button" class="btn btn-secondary btn-sm shrink-0" (click)="open(n)">{{ 'COMMON.EDIT' | translate }}</button>
          </li>
        }
      </ul>
    </section>

    <app-modal [open]="editing() !== null" [title]="editing()?.pageKey ?? ''" size="lg" (closed)="editing.set(null)">
      <form id="note-form" class="space-y-4" (ngSubmit)="save()">
        <label class="field"><span class="label label-required">{{ 'SET.HELP_NOTES.NOTE_TITLE' | translate }}</span>
          <input class="input" name="title" required maxlength="160" [ngModel]="form.value().title" (ngModelChange)="form.set('title', $event)" /></label>
        <label class="field"><span class="label label-required">{{ 'SET.HELP_NOTES.NOTE_BODY' | translate }}</span>
          <textarea class="textarea" rows="10" name="body" required maxlength="8000" [ngModel]="form.value().body" (ngModelChange)="form.set('body', $event)"></textarea>
          <span class="hint">{{ 'SET.HELP_NOTES.BODY_HINT' | translate }}</span></label>
      </form>
      <div modal-footer>
        @if (editing()?.customised) { <button type="button" class="btn btn-ghost me-auto" (click)="restore()">{{ 'SET.HELP_NOTES.RESTORE' | translate }}</button> }
        <button type="button" class="btn btn-secondary" (click)="editing.set(null)">{{ 'COMMON.CANCEL' | translate }}</button>
        <button type="submit" form="note-form" class="btn btn-primary" [disabled]="saving() || !form.value().title.trim() || !form.value().body.trim()">{{ 'COMMON.SAVE' | translate }}</button>
      </div>
    </app-modal>
  `,
})
export class HelpNotesSettingsComponent {
  private readonly http = inject(HttpClient);
  private readonly errors = inject(ApiErrors);
  private readonly toast = inject(ToastService);

  protected readonly languages = ['fr', 'en', 'ar'];
  protected readonly lang = signal('fr');
  protected readonly notes = loadable<Note[]>([]);
  protected readonly editing = signal<Note | null>(null);
  protected readonly saving = signal(false);
  protected readonly form = formState({ title: '', body: '' });

  constructor() {
    void this.reload();
  }

  protected setLang(l: string): void {
    this.lang.set(l);
    void this.reload();
  }

  private reload(): Promise<boolean> {
    return this.notes.load(() => this.http.get<Note[]>(api('/help/notes'), { params: { lang: this.lang() } }));
  }

  protected open(n: Note): void {
    this.form.reset({ title: n.title, body: n.body });
    this.editing.set(n);
  }

  protected async save(): Promise<void> {
    const n = this.editing();
    if (!n) {
      return;
    }
    this.saving.set(true);
    try {
      // Saved for the language being viewed, even when the note shown fell back to another one.
      await firstValueFrom(this.http.put(api(`/help/notes/${n.pageKey}`), this.form.value(), { params: { lang: this.lang() } }));
      this.editing.set(null);
      this.toast.success('✓');
      await this.reload();
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.saving.set(false);
    }
  }

  protected async restore(): Promise<void> {
    const n = this.editing();
    if (!n) {
      return;
    }
    try {
      await firstValueFrom(this.http.delete(api(`/help/notes/${n.pageKey}`), { params: { lang: this.lang() } }));
      this.editing.set(null);
      await this.reload();
    } catch (error) {
      this.errors.report(error);
    }
  }
}
