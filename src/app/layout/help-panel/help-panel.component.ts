import { Component, ElementRef, HostListener, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { filter, map, startWith } from 'rxjs';
import { Block, helpPageKey, noteBlocks } from '../../core/help/help-pages';
import { TOURS, TourService, tourFor } from '../../core/help/tours';
import { ApiErrors } from '../../core/services/api-error.service';
import { HelpAnswer, HelpApi, HelpNote } from '../../core/services/help-api.service';
import { HelpPanelService } from '../../core/services/help-panel.service';
import { LanguageService } from '../../core/services/language.service';
import { IconComponent } from '../../shared/ui/icon.component';

/**
 * The help drawer behind the "?" button: the note for the screen you are on, the other notes, a
 * guided tour where there is one, and a box to ask a question. Answers come from the help notes
 * (and, when the clinic has switched the assistant on, from the model reading those notes); the
 * panel says which, and never sends more than the question and the language.
 */
@Component({
  selector: 'app-help-panel',
  standalone: true,
  imports: [FormsModule, TranslateModule, IconComponent],
  template: `
    @if (help.open()) {
      <aside class="fixed inset-y-0 end-0 z-[var(--z-drawer)] flex w-full max-w-sm flex-col border-s border-ink-200 bg-surface shadow-xl" role="dialog" aria-modal="false" [attr.aria-label]="'HELP.TITLE' | translate" tabindex="-1" #panel>
        <header class="flex items-center justify-between gap-2 border-b border-ink-100 px-4 py-3">
          <h2 class="text-base font-bold text-ink-900">{{ 'HELP.TITLE' | translate }}</h2>
          <button type="button" class="btn btn-ghost btn-icon" (click)="help.hide()" [attr.aria-label]="'COMMON.CLOSE' | translate" #close><app-icon name="close" [size]="18" /></button>
        </header>

        <div class="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-4">
          <section aria-live="polite" [attr.aria-busy]="loading()">
            @if (note(); as n) {
              <h3 class="mb-2 text-lg font-bold text-ink-900">{{ n.title }}</h3>
              @for (b of blocks(); track $index) {
                @if (b.kind === 'p') { <p class="mb-2 text-sm leading-relaxed text-ink-700">{{ b.text }}</p> }
                @else { <ul class="mb-2 list-disc space-y-1 ps-5 text-sm text-ink-700">@for (i of b.items; track $index) { <li>{{ i }}</li> }</ul> }
              }
            } @else if (!loading()) {
              <p class="text-sm text-ink-600">{{ 'HELP.NO_NOTE' | translate }}</p>
            }
            <div class="mt-3 flex flex-wrap gap-2">
              @if (pageTour()) { <button type="button" class="btn btn-secondary btn-sm" (click)="startTour('page')">{{ 'HELP.PAGE_TOUR' | translate }}</button> }
              <button type="button" class="btn btn-ghost btn-sm" (click)="startTour('welcome')">{{ 'HELP.WELCOME_TOUR' | translate }}</button>
            </div>
          </section>

          <section aria-labelledby="ask-title">
            <h3 id="ask-title" class="mb-1 text-sm font-bold text-ink-900">{{ 'HELP.ASK' | translate }}</h3>
            <form class="space-y-2" (ngSubmit)="ask()">
              <label class="field"><span class="sr-only">{{ 'HELP.QUESTION' | translate }}</span>
                <textarea class="textarea" rows="2" name="question" maxlength="500" [placeholder]="'HELP.QUESTION' | translate" [ngModel]="question()" (ngModelChange)="question.set($event)" (keydown.control.enter)="ask()" (keydown.meta.enter)="ask()"></textarea></label>
              <p class="text-xs text-ink-500">{{ 'HELP.PRIVACY' | translate }}</p>
              <button type="submit" class="btn btn-primary btn-sm" [disabled]="asking() || question().trim().length < 3">{{ (asking() ? 'HELP.ASKING' : 'HELP.SEND') | translate }}</button>
            </form>
            @if (answer(); as a) {
              <div class="mt-3 rounded-lg border border-ink-200 bg-ink-50 p-3" role="status">
                @for (b of answerBlocks(); track $index) {
                  @if (b.kind === 'p') { <p class="mb-2 text-sm leading-relaxed text-ink-800">{{ b.text }}</p> }
                  @else { <ul class="mb-2 list-disc space-y-1 ps-5 text-sm text-ink-800">@for (i of b.items; track $index) { <li>{{ i }}</li> }</ul> }
                }
                <p class="text-2xs text-ink-500">{{ (a.aiUsed ? 'HELP.AI_USED' : 'HELP.FROM_NOTES') | translate }}@if (a.notice && a.aiUsed) { · {{ a.notice }} }</p>
                @if (a.sources.length) {
                  <p class="mt-2 text-xs text-ink-600">{{ 'HELP.SOURCES' | translate }}
                    @for (s of a.sources; track s.pageKey) { <button type="button" class="ms-1 rounded border border-ink-200 bg-surface px-1.5 py-0.5 text-xs font-semibold text-petrol-700 hover:bg-petrol-50" (click)="show(s.pageKey)">{{ s.title }}</button> }
                  </p>
                }
              </div>
            }
          </section>

          <section aria-labelledby="topics-title">
            <h3 id="topics-title" class="mb-1 text-sm font-bold text-ink-900">{{ 'HELP.TOPICS' | translate }}</h3>
            <ul class="divide-y divide-ink-100 rounded-lg border border-ink-200">
              @for (t of topics(); track t.pageKey) {
                <li><button type="button" class="block w-full px-3 py-2 text-start text-sm hover:bg-ink-50" [class.font-bold]="t.pageKey === shownKey()" [attr.aria-current]="t.pageKey === shownKey()" (click)="show(t.pageKey)">{{ t.title }}</button></li>
              }
            </ul>
          </section>
        </div>
      </aside>
    }
  `,
})
export class HelpPanelComponent {
  protected readonly help = inject(HelpPanelService);
  private readonly api = inject(HelpApi);
  private readonly errors = inject(ApiErrors);
  private readonly language = inject(LanguageService);
  private readonly router = inject(Router);
  private readonly tours = inject(TourService);
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private opener: HTMLElement | null = null;

  private readonly url = toSignal(this.router.events.pipe(filter(e => e instanceof NavigationEnd), map(() => this.router.url), startWith(this.router.url)), { initialValue: '/' });
  protected readonly pageKey = computed(() => helpPageKey(this.url()));
  protected readonly pageTour = computed(() => tourFor(this.url()));

  protected readonly topics = signal<HelpNote[]>([]);
  protected readonly shownKey = signal<string | null>(null);
  protected readonly note = signal<HelpNote | null>(null);
  protected readonly blocks = computed<Block[]>(() => noteBlocks(this.note()?.body ?? ''));
  protected readonly loading = signal(false);

  protected readonly question = signal('');
  protected readonly asking = signal(false);
  protected readonly answer = signal<HelpAnswer | null>(null);
  protected readonly answerBlocks = computed<Block[]>(() => noteBlocks(this.answer()?.answer ?? ''));

  constructor() {
    // Opening the panel (or moving to another screen with it open) shows the note for where you are.
    effect(() => {
      if (!this.help.open()) {
        return;
      }
      const key = this.pageKey();
      const lang = this.language.currentLang();
      untracked(() => {
        this.answer.set(null);
        void this.loadTopics(lang);
        void this.show(key, lang);
      });
    });
    // Focus moves into the panel when it opens and back to what opened it when it closes.
    effect(() => {
      const el = this.panel()?.nativeElement;
      untracked(() => {
        if (el) {
          this.opener = (document.activeElement as HTMLElement | null) ?? null;
          queueMicrotask(() => el.focus());
        } else if (this.opener) {
          this.opener.focus?.();
          this.opener = null;
        }
      });
    });
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.help.open()) {
      this.help.hide();
    }
  }

  private async loadTopics(lang: string): Promise<void> {
    try {
      this.topics.set(await this.api.notes(lang));
    } catch {
      this.topics.set([]);
    }
  }

  protected async show(key: string | null, lang: string = this.language.currentLang()): Promise<void> {
    this.shownKey.set(key);
    this.note.set(null);
    if (!key) {
      return;
    }
    this.loading.set(true);
    try {
      const note = await this.api.note(key, lang);
      if (this.shownKey() === key) {
        this.note.set(note);
      }
    } catch {
      // a page with no note is normal; the panel says so
    } finally {
      this.loading.set(false);
    }
  }

  protected async ask(): Promise<void> {
    const question = this.question().trim();
    if (question.length < 3 || this.asking()) {
      return;
    }
    this.asking.set(true);
    try {
      this.answer.set(await this.api.ask(question, this.language.currentLang(), this.pageKey() ?? undefined));
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.asking.set(false);
    }
  }

  protected async startTour(which: 'page' | 'welcome'): Promise<void> {
    const tour = which === 'welcome' ? TOURS.find(t => t.id === 'welcome') : this.pageTour();
    if (!tour) {
      return;
    }
    // The tour points at the screen, so the drawer gets out of the way first.
    this.help.hide();
    await new Promise(resolve => setTimeout(resolve, 150));
    await this.tours.start(tour);
  }
}
