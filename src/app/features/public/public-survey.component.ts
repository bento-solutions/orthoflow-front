import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { IntakeApi, PublicSurveyInfo } from '../../core/services/intake-api.service';
import { LanguageService } from '../../core/services/language.service';
import { PublicShellComponent } from './public-shell.component';

const RATINGS = [1, 2, 3, 4, 5] as const;

/**
 * How was the visit: a rating, an optional comment, and a box for "please call me back". The link
 * is single-use and carries nothing about the patient but the visit it was sent for.
 */
@Component({
  selector: 'app-public-survey',
  standalone: true,
  imports: [FormsModule, TranslateModule, PublicShellComponent],
  template: `
    <app-public-shell [clinic]="info()?.clinicName ?? ''">
      @if (state() === 'loading') {
        <p class="py-16 text-center text-ink-500" role="status">{{ 'COMMON.LOADING' | translate }}</p>
      } @else if (state() === 'invalid' || !info()) {
        <section class="card card-pad text-center">
          <h1 class="text-xl font-bold text-ink-900">{{ 'PUB.INVALID_TITLE' | translate }}</h1>
          <p class="mt-2 text-ink-600">{{ 'PUB.SURVEY.USED' | translate }}</p>
        </section>
      } @else if (done()) {
        <section class="card card-pad text-center" role="status">
          <h1 class="text-xl font-bold text-ink-900">{{ 'PUB.SURVEY.DONE_TITLE' | translate }}</h1>
          <p class="mt-2 text-ink-700">{{ 'PUB.SURVEY.DONE_TEXT' | translate }}</p>
        </section>
      } @else {
        <h1 class="mb-1 text-2xl font-extrabold text-ink-900">{{ 'PUB.SURVEY.TITLE' | translate }}</h1>
        @if (info()?.practitionerName) { <p class="mb-5 text-ink-600">{{ 'PUB.SURVEY.WITH' | translate: { name: info()!.practitionerName } }}</p> }
        <form class="card card-pad space-y-5" (ngSubmit)="submit()">
          <fieldset>
            <legend class="mb-2 font-bold text-ink-900">{{ 'PUB.SURVEY.RATING' | translate }}</legend>
            <div class="flex flex-wrap gap-2" role="radiogroup">
              @for (r of ratings; track r) {
                <label class="flex min-w-[4.5rem] cursor-pointer flex-col items-center gap-1 rounded-lg border px-3 py-2 text-center text-sm font-semibold"
                  [class.border-petrol-600]="rating() === r" [class.bg-petrol-50]="rating() === r" [class.border-ink-200]="rating() !== r">
                  <input type="radio" class="sr-only" name="rating" [value]="r" [checked]="rating() === r" (change)="rating.set(r)" />
                  <span class="text-xl" aria-hidden="true">{{ rating() >= r ? '★' : '☆' }}</span>
                  <span>{{ 'PUB.SURVEY.LEVELS.' + r | translate }}</span>
                </label>
              }
            </div>
          </fieldset>
          <label class="field"><span class="label">{{ 'PUB.SURVEY.COMMENT' | translate }}</span><textarea class="textarea" rows="3" name="comment" maxlength="2000" [ngModel]="comment()" (ngModelChange)="comment.set($event)"></textarea></label>
          <label class="flex items-start gap-2 text-sm text-ink-800"><input type="checkbox" class="mt-0.5" name="callMe" [ngModel]="callMe()" (ngModelChange)="callMe.set($event)" /><span>{{ 'PUB.SURVEY.CALL_ME' | translate }}</span></label>
          <div class="absolute -start-[9999px] h-0 w-0 overflow-hidden" aria-hidden="true"><label>Website <input name="website" tabindex="-1" autocomplete="off" [ngModel]="website()" (ngModelChange)="website.set($event)" /></label></div>
          @if (error()) { <p class="rounded-md bg-critical-50 p-3 text-sm text-critical-700" role="alert">{{ error() }}</p> }
          <button type="submit" class="btn btn-primary w-full" [disabled]="busy() || rating() === 0">{{ (busy() ? 'PUB.SENDING' : 'PUB.SURVEY.SUBMIT') | translate }}</button>
        </form>
      }
    </app-public-shell>
  `,
})
export class PublicSurveyComponent {
  private readonly api = inject(IntakeApi);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  private readonly token = inject(ActivatedRoute).snapshot.paramMap.get('token') ?? '';

  protected readonly ratings = RATINGS;
  protected readonly state = signal<'loading' | 'ready' | 'invalid'>('loading');
  protected readonly info = signal<PublicSurveyInfo | null>(null);
  protected readonly rating = signal(0);
  protected readonly comment = signal('');
  protected readonly callMe = signal(false);
  protected readonly website = signal('');
  protected readonly busy = signal(false);
  protected readonly done = signal(false);
  protected readonly error = signal('');
  protected readonly canSend = computed(() => this.rating() >= 1 && this.rating() <= 5);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.info.set(await this.api.publicSurveyInfo(this.token));
      this.state.set('ready');
    } catch {
      this.state.set('invalid');
    }
  }

  protected async submit(): Promise<void> {
    if (this.busy() || !this.canSend()) {
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      await this.api.submitSurvey(this.token, { rating: this.rating(), comment: this.comment().trim() || undefined, callMe: this.callMe(), website: this.website() });
      this.done.set(true);
    } catch (error) {
      this.error.set(this.translate.instant(error instanceof HttpErrorResponse && error.status === 429 ? 'PUB.TOO_MANY' : 'PUB.ERROR'));
    } finally {
      this.busy.set(false);
    }
  }
}
