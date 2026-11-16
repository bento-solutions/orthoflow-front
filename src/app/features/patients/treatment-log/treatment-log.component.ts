import { IconComponent } from '../../../shared/ui/icon.component';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { PassportWork } from '../../../core/api/contract';
import { findingLabel } from '../../../core/clinical/finding-options';
import { surfaceShorthand } from '../../../core/clinical/tooth-surfaces';
import { TreatmentChartComponent } from './treatment-chart.component';
import { LanguageService } from '../../../core/services/language.service';
import { PassportLanguage, TreatmentPassportService } from '../../../core/services/treatment-passport.service';
import { ToastService } from '../../../core/services/toast.service';
import { AppDatePipe } from '../../../shared/pipes/app-date.pipe';

const LANGUAGES: readonly PassportLanguage[] = ['fr', 'en', 'ar'];

/**
 * The patient's treatment log, and the way to hand it to them: everything done
 * to their teeth (here or elsewhere), what is still owed, the gums, and what a
 * new practitioner must know before touching them.
 *
 * What is shown is exactly what the printed passport and the data file carry;
 * the screen is the preview of the document.
 */
@Component({
  selector: 'app-treatment-log',
  standalone: true,
  imports: [IconComponent, AppDatePipe, FormsModule, TranslateModule, TreatmentChartComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="head">
      <h2>{{ 'TREATMENT_LOG.TITLE' | translate }}</h2>
      <p class="sub">{{ 'TREATMENT_LOG.SUBTITLE' | translate }}</p>
    </header>

    <section class="share" [attr.aria-label]="'TREATMENT_LOG.SHARE' | translate">
      <h3>{{ 'TREATMENT_LOG.SHARE' | translate }}</h3>
      <label class="consent">
        <input type="checkbox" [(ngModel)]="consent" name="consent" />
        <span>{{ 'TREATMENT_LOG.CONSENT' | translate }}</span>
      </label>
      <div class="share-row">
        <label class="lang">
          <span>{{ 'TREATMENT_LOG.LANGUAGE' | translate }}</span>
          <select [(ngModel)]="language" name="language">
            @for (l of languages; track l) { <option [value]="l">{{ 'VOICE.LANG.' + l | translate }}</option> }
          </select>
        </label>
        <button type="button" class="btn btn-primary btn-sm" [disabled]="!consent || busy()" (click)="pdf()">
          <app-icon class="mi" name="picture_as_pdf" size="1em" />{{ 'TREATMENT_LOG.PDF' | translate }}
        </button>
        <button type="button" class="btn btn-secondary btn-sm" [disabled]="!consent || busy()" (click)="chartPdf()">
          <app-icon class="mi" name="grid_on" size="1em" />{{ 'TREATMENT_CHART.DOWNLOAD' | translate }}
        </button>
        <button type="button" class="btn btn-secondary btn-sm" [disabled]="!consent || busy()" (click)="json()">
          <app-icon class="mi" name="data_object" size="1em" />{{ 'TREATMENT_LOG.JSON' | translate }}
        </button>
      </div>
      <p class="hint">{{ 'TREATMENT_LOG.RECORDED' | translate }}</p>
    </section>

    @if (service.failed()) {
      <p class="error" role="alert">{{ 'TREATMENT_LOG.LOAD_FAILED' | translate }}</p>
    }

    @if (mode() === 'full' && service.passport(); as p) {
      <section class="block">
        <h3>{{ 'TREATMENT_CHART.TITLE' | translate }}</h3>
        <app-treatment-chart [passport]="p" />
      </section>

      <section class="block">
        <h3>{{ 'TREATMENT_LOG.ALERTS' | translate }}</h3>
        @if (p.allergies?.length || p.medicalHistory?.length) {
          <ul class="chips">
            @for (a of p.allergies ?? []; track $index) {
              <li class="chip alert"><app-icon class="mi" name="warning" size="1em" />{{ a.substance }}@if (a.reaction) { — {{ a.reaction }} }</li>
            }
            @for (h of p.medicalHistory ?? []; track $index) {
              <li class="chip">{{ h.label }}@if (h.detail) { — {{ h.detail }} }</li>
            }
          </ul>
        } @else {
          <p class="muted">{{ 'TREATMENT_LOG.NO_ALERTS' | translate }}</p>
        }
      </section>

      <section class="block">
        <h3>{{ 'TREATMENT_LOG.LOG' | translate }}</h3>
        @if (p.log?.length) {
          <ol class="timeline">
            @for (w of p.log; track $index) {
              <li class="entry" [attr.data-outcome]="w.outcome">
                <div class="when">
                  @if (w.date) { {{ w.date | appDate }} } @else { <span class="muted">{{ 'TOOTH_DETAIL.DATE_UNKNOWN' | translate }}</span> }
                </div>
                <div class="what">
                  <span class="title">
                    {{ title(w) }}
                    @if (shorthand(w); as s) { <span class="surface-badge" [title]="(w.surfaces ?? []).join(' + ')">{{ s }}</span> }
                  </span>
                  <span class="meta">
                    @if (w.teeth?.length) { <span class="teeth">{{ 'TREATMENT_LOG.TOOTH' | translate }} {{ w.teeth!.join(', ') }}</span> }
                    @if (w.origin === 'EXTERNAL') { <span class="origin">{{ 'TOOTH_DETAIL.ELSEWHERE' | translate }}@if (w.provider) { · {{ w.provider }} }</span> }
                    @else if (w.provider) { <span class="origin">{{ w.provider }}</span> }
                  </span>
                  @if (w.note) { <span class="note">{{ w.note }}</span> }
                </div>
                <span class="pill" [attr.data-outcome]="w.outcome">{{ ('TREATMENT_LOG.OUTCOME.' + w.outcome) | translate }}</span>
              </li>
            }
          </ol>
        } @else {
          <p class="muted">{{ 'TREATMENT_LOG.NO_LOG' | translate }}</p>
        }
      </section>

      <section class="block">
        <h3>{{ 'TREATMENT_LOG.PLANNED' | translate }}</h3>
        @if (p.planned?.length) {
          <ol class="timeline">
            @for (w of p.planned; track $index) {
              <li class="entry" [attr.data-outcome]="w.outcome">
                <div class="when">@if (w.teeth?.length) { {{ w.teeth!.join(', ') }} }</div>
                <div class="what">
                  <span class="title">
                    {{ title(w) }}
                    @if (shorthand(w); as s) { <span class="surface-badge">{{ s }}</span> }
                  </span>
                </div>
                <span class="pill" [attr.data-outcome]="w.outcome">{{ ('TREATMENT_LOG.OUTCOME.' + w.outcome) | translate }}</span>
              </li>
            }
          </ol>
        } @else {
          <p class="muted">{{ 'TREATMENT_LOG.NO_PLANNED' | translate }}</p>
        }
      </section>

      <section class="block">
        <h3>{{ 'GUMS.TITLE' | translate }}</h3>
        @if (p.gums?.length) {
          <ul class="chips">
            @for (g of p.gums; track g.region) {
              <li class="chip" [attr.data-state]="g.condition">
                {{ ('GUMS.REGION.' + g.region) | translate }}: <b>{{ ('GUMS.CONDITION.' + g.condition) | translate }}</b>
                @if (g.stage) { · {{ 'GUMS.STAGE_N' | translate: { n: g.stage } }} }
              </li>
            }
          </ul>
        } @else {
          <p class="muted">{{ 'TREATMENT_LOG.NO_GUMS' | translate }}</p>
        }
      </section>
    } @else if (mode() === 'full' && service.loading()) {
      <p class="muted">{{ 'COMMON.LOADING' | translate }}</p>
    }
  `,
  styles: [`
    :host { display: block; max-width: 64rem; }
    .head h2 { margin: 0; font-size: var(--text-lg); }
    .sub { margin: .25rem 0 1rem; color: var(--text-muted); font-size: var(--text-base); }
    h3 { margin: 0 0 .5rem; font-size: var(--text-base); }
    .share { padding: 1rem; border: 1px solid var(--action-border); border-radius: var(--radius-lg); background: var(--action-tint); margin-bottom: 1.25rem; }
    .consent { display: flex; gap: .5rem; align-items: flex-start; font-size: var(--text-base); margin-bottom: .75rem; }
    .consent input { margin-top: .2rem; }
    .share-row { display: flex; flex-wrap: wrap; gap: .75rem; align-items: flex-end; }
    .lang { display: flex; flex-direction: column; gap: .25rem; font-size: var(--text-xs); font-weight: 600; }
    .lang select { padding: .4375rem .5rem; font: inherit; font-weight: 400; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: var(--surface); color: var(--text); }
    .lang select:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
    .hint { margin: .625rem 0 0; font-size: var(--text-xs); color: var(--text-muted-on-tint); }
    .error { color: var(--status-critical-text); }
    .block { margin-bottom: 1.5rem; }
    .muted { color: var(--text-muted); font-size: var(--text-base); margin: 0; }
    .chips { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: .5rem; }
    .chip { display: inline-flex; align-items: center; gap: .25rem; padding: .25rem .625rem; border-radius: var(--radius-full); background: var(--status-idle-tint); color: var(--status-idle-text); font-size: var(--text-sm); }
    .chip.alert { background: var(--status-critical-tint); color: var(--status-critical-text); font-weight: 600; }
    .chip.alert app-icon.mi { font-size: var(--text-md); }
    .chip[data-state='HEALTHY'] { background: var(--status-done-tint); color: var(--status-done-text); }
    .chip[data-state='GINGIVITIS'] { background: var(--status-attention-tint); color: var(--status-attention-text); }
    .chip[data-state='PERIODONTITIS'] { background: var(--status-critical-tint); color: var(--status-critical-text); }
    .timeline { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .5rem; }
    .entry { display: grid; grid-template-columns: 7.5rem 1fr auto; gap: .75rem; align-items: start; padding: .625rem .75rem; border: 1px solid var(--border); border-inline-start: 4px solid var(--border-strong); border-radius: var(--radius-md); background: var(--surface); }
    .entry[data-outcome='IN_PLACE'] { border-inline-start-color: var(--status-active); }
    .entry[data-outcome='TREATED'], .entry[data-outcome='COMPLETED'] { border-inline-start-color: var(--status-done); }
    .entry[data-outcome='REQUIRED'], .entry[data-outcome='PLANNED'], .entry[data-outcome='IN_PROGRESS'] { border-inline-start-color: var(--status-attention); }
    .when { font-size: var(--text-sm); font-weight: 600; color: var(--text); }
    .what { display: flex; flex-direction: column; gap: .125rem; min-width: 0; }
    .title { font-weight: 600; display: flex; flex-wrap: wrap; gap: .375rem; align-items: center; }
    .surface-badge { font-size: var(--text-xs); font-weight: 700; letter-spacing: .06em; padding: .0625rem .375rem; border-radius: var(--radius-xs); background: var(--action-tint); color: var(--action-text); }
    .meta { display: flex; flex-wrap: wrap; gap: .625rem; font-size: var(--text-xs); color: var(--text-muted); }
    .origin { font-weight: 600; }
    .note { font-size: var(--text-sm); white-space: pre-line; }
    .pill { font-size: var(--text-xs); font-weight: 700; padding: .125rem .5rem; border-radius: var(--radius-full); background: var(--status-idle-tint); color: var(--status-idle-text); white-space: nowrap; }
    .pill[data-outcome='IN_PLACE'] { background: var(--status-active-tint); color: var(--status-active-text); }
    .pill[data-outcome='TREATED'], .pill[data-outcome='COMPLETED'] { background: var(--status-done-tint); color: var(--status-done-text); }
    .pill[data-outcome='REQUIRED'], .pill[data-outcome='PLANNED'], .pill[data-outcome='IN_PROGRESS'] { background: var(--status-attention-tint); color: var(--status-attention-text); }
    @media (max-width: 560px) { .entry { grid-template-columns: 1fr; } }
  `],
})
export class TreatmentLogComponent {
  readonly patientId = input.required<string>();
  /**
   * `share`: only what hands the record over (the passport PDF, the chart PDF, the data file), as
   * the patient file's Documents tab shows it; the work done is on Visits, the chart on Chart & plan.
   */
  readonly mode = input<'full' | 'share'>('full');

  protected readonly service = inject(TreatmentPassportService);
  private readonly translate = inject(TranslateService);
  private readonly toast = inject(ToastService);
  private readonly appLanguage = inject(LanguageService);

  protected readonly languages = LANGUAGES;
  protected consent = false;
  /** The next practitioner's language, not necessarily the clinic's: defaults to the application's. */
  protected language: PassportLanguage = LANGUAGES.includes(this.appLanguage.currentLang() as PassportLanguage)
    ? (this.appLanguage.currentLang() as PassportLanguage) : 'fr';
  protected readonly busy = signal(false);

  constructor() {
    effect(() => {
      const id = this.patientId();
      if (id) this.service.load(id);
    });
  }

  protected title(w: PassportWork): string {
    return w.name ?? findingLabel(this.translate, w.code ?? '');
  }

  protected shorthand(w: PassportWork): string {
    return surfaceShorthand((w.surfaces ?? []).join('-'));
  }

  protected pdf(): Promise<void> {
    return this.hand(() => this.service.downloadPdf(this.patientId(), this.language));
  }

  protected chartPdf(): Promise<void> {
    return this.hand(() => this.service.downloadChartPdf(this.patientId(), this.language));
  }

  protected json(): Promise<void> {
    return this.hand(() => this.service.downloadJson(this.patientId()));
  }

  private async hand(download: () => Promise<void>): Promise<void> {
    if (!this.consent || this.busy()) return;
    this.busy.set(true);
    try {
      await download();
    } catch (err) {
      console.error('Passport download failed', err);
      this.toast.error(this.translate.instant('TREATMENT_LOG.DOWNLOAD_FAILED'));
    } finally {
      this.busy.set(false);
    }
  }
}
