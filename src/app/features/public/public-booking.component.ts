import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { DirectBookResult, IntakeApi, PublicBookingInfo } from '../../core/services/intake-api.service';
import { LanguageService } from '../../core/services/language.service';
import { isoDate } from '../../core/utils/format';
import { zonedIso } from '../../core/utils/zoned';
import { PublicShellComponent, useClinicLanguage } from './public-shell.component';
import { AppDatePipe } from '../../shared/pipes/app-date.pipe';

type Step = 'type' | 'doctor' | 'time' | 'details' | 'done';
type PublicType = PublicBookingInfo['types'][number];

const WINDOW_DAYS = 14;

export const COUNTRY_CODES = [
  { code: '+212', label: '🇲🇦 +212' },
  { code: '+33', label: '🇫🇷 +33' },
  { code: '+34', label: '🇪🇸 +34' },
  { code: '+32', label: '🇧🇪 +32' },
  { code: '+44', label: '🇬🇧 +44' },
  { code: '+1', label: '🇺🇸 +1' },
  { code: '+971', label: '🇦🇪 +971' },
  { code: '+966', label: '🇸🇦 +966' },
] as const;

/** The appointment type's name in the visitor's language, falling back to French. */
export function typeName(type: Pick<PublicType, 'nameFr' | 'nameEn' | 'nameAr'>, lang: string): string {
  return (lang === 'ar' ? type.nameAr : lang === 'en' ? type.nameEn : type.nameFr) || type.nameFr;
}

/** A day and a free time as a moment the server reads the way the patient clicked it. */
export function slotMoment(day: string, time: string, timeZone: string | null | undefined): string {
  return timeZone ? zonedIso(day, time, timeZone) : `${day}T${time}:00`;
}

/** Normalizes a phone number and country dial code to strict E.164, or null when invalid. */
export function normalizeE164(raw: string, countryCode: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const digits = trimmed.replace(/[^0-9]/g, '');
  if (!digits) {
    return null;
  }
  let candidate: string;
  if (trimmed.startsWith('+')) {
    candidate = `+${digits}`;
  } else if (digits.startsWith('00')) {
    candidate = `+${digits.slice(2)}`;
  } else {
    const ccDigits = countryCode.replace(/[^0-9]/g, '');
    if (!ccDigits) {
      return null;
    }
    if (digits.startsWith(ccDigits) && digits.length >= ccDigits.length + 8) {
      candidate = `+${digits}`;
    } else {
      const subscriber = digits.startsWith('0') ? digits.slice(1) : digits;
      candidate = `+${ccDigits}${subscriber}`;
    }
  }
  return /^\+[1-9][0-9]{7,14}$/.test(candidate) ? candidate : null;
}

export function isMobileViewport(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return window.matchMedia?.('(max-width: 767px)').matches || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
}

/**
 * Mobile-first online appointment booking. Fetches live free slots from the doctor's calendar,
 * normalizes WhatsApp numbers to E.164, creates patient + appointment atomically on submit, and
 * offers the personal registration link CTA only for newly created patients with an incomplete form.
 */
@Component({
  selector: 'app-public-booking',
  standalone: true,
  imports: [AppDatePipe, FormsModule, TranslateModule, PublicShellComponent],
  template: `
    <app-public-shell [clinic]="info()?.clinicName ?? ''">
      @if (state() === 'loading') {
        <p class="py-16 text-center text-ink-500" role="status">{{ 'COMMON.LOADING' | translate }}</p>
      } @else if (state() === 'invalid' || !info()) {
        <section class="card card-pad text-center">
          <h1 class="text-xl font-bold text-ink-900">{{ 'PUB.INVALID_TITLE' | translate }}</h1>
          <p class="mt-2 text-ink-600">{{ 'PUB.INVALID_TEXT' | translate }}</p>
        </section>
      } @else if (info(); as i) {
        <h1 class="mb-1 text-2xl font-extrabold text-ink-900">{{ 'PUB.BOOK.TITLE' | translate }}</h1>
        @if (i.lockedPractitionerName) {
          <p class="mb-5 text-sm font-medium text-petrol-700">{{ 'PUB.BOOK.WITH_DOCTOR' | translate: { name: i.lockedPractitionerName } }}</p>
        } @else {
          <p class="mb-5 text-ink-600">{{ 'PUB.BOOK.INTRO' | translate }}</p>
        }

        @if (step() === 'type') {
          <section aria-labelledby="step-type"><h2 id="step-type" class="mb-3 font-bold text-ink-900">{{ 'PUB.BOOK.STEP_TYPE' | translate }}</h2>
            <ul class="space-y-2">
              @for (t of i.types; track t.id) {
                <li><button type="button" class="card flex w-full items-center gap-3 p-4 text-start hover:border-petrol-300" (click)="pickType(t)">
                  <span class="h-3 w-3 shrink-0 rounded-full" [style.background]="t.color || '#64748b'" aria-hidden="true"></span>
                  <span class="flex-1 font-semibold text-ink-900">{{ name(t) }}</span>
                  <span class="text-sm text-ink-500">{{ 'PUB.BOOK.DURATION' | translate: { minutes: t.durationMinutes } }}</span>
                </button></li>
              } @empty { <li class="text-ink-500">{{ 'PUB.BOOK.NO_TYPES' | translate }}</li> }
            </ul>
          </section>
        }

        @if (step() === 'doctor') {
          <section aria-labelledby="step-doctor"><h2 id="step-doctor" class="mb-3 font-bold text-ink-900">{{ 'PUB.BOOK.STEP_DOCTOR' | translate }}</h2>
            <ul class="space-y-2">
              <li><button type="button" class="card w-full p-4 text-start font-semibold text-ink-900 hover:border-petrol-300" (click)="pickDoctor('')">{{ 'PUB.BOOK.ANY_DOCTOR' | translate }}</button></li>
              @for (p of i.practitioners; track p.id) {
                <li><button type="button" class="card flex w-full items-center gap-3 p-4 text-start hover:border-petrol-300" (click)="pickDoctor(p.id)">
                  <span class="h-3 w-3 shrink-0 rounded-full" [style.background]="p.color || '#64748b'" aria-hidden="true"></span><span class="font-semibold text-ink-900">{{ p.name }}</span></button></li>
              }
            </ul>
            <button type="button" class="btn btn-ghost mt-4" (click)="step.set('type')">{{ 'COMMON.BACK' | translate }}</button>
          </section>
        }

        @if (step() === 'time') {
          <section aria-labelledby="step-time"><h2 id="step-time" class="mb-3 font-bold text-ink-900">{{ 'PUB.BOOK.STEP_TIME' | translate }}</h2>
            @if (error()) { <p class="mb-3 rounded-md bg-critical-50 p-3 text-sm text-critical-700" role="alert">{{ error() }}</p> }
            @if (loadingDays()) { <p class="text-ink-500" role="status">{{ 'COMMON.LOADING' | translate }}</p> }
            @for (day of dayList(); track day.day) {
              <div class="mb-4">
                <h3 class="mb-1.5 text-sm font-semibold text-ink-700">{{ day.day + 'T12:00:00' | appDate:'long' }}</h3>
                <div class="flex flex-wrap gap-2">
                  @for (t of day.times; track t) {
                    <button type="button" class="rounded-md border border-ink-200 bg-surface px-3 py-2 text-sm font-semibold tabular-nums text-ink-900 hover:border-petrol-400 hover:bg-petrol-50"
                      [class.!border-petrol-600]="isChosen(day.day, t)" [class.!bg-petrol-600]="isChosen(day.day, t)" [class.!text-white]="isChosen(day.day, t)" [attr.aria-pressed]="isChosen(day.day, t)"
                      (click)="pickTime(day.day, t)">{{ t }}</button>
                  }
                </div>
              </div>
            } @empty {
              @if (!loadingDays()) { <p class="rounded-md bg-ink-50 p-3 text-ink-700">{{ 'PUB.BOOK.NO_SLOTS' | translate: { phone: i.phone || '' } }}</p> }
            }
            @if (canLoadMore()) { <button type="button" class="btn btn-secondary btn-sm" [disabled]="loadingDays()" (click)="loadMore()">{{ 'PUB.BOOK.MORE_DAYS' | translate }}</button> }
            <div><button type="button" class="btn btn-ghost mt-4" (click)="backFromTime()">{{ 'COMMON.BACK' | translate }}</button></div>
          </section>
        }

        @if (step() === 'details') {
          <form class="card card-pad space-y-4" (ngSubmit)="submit()" aria-labelledby="step-details">
            <h2 id="step-details" class="font-bold text-ink-900">{{ 'PUB.BOOK.STEP_DETAILS' | translate }}</h2>
            <p class="rounded-md bg-petrol-50 p-3 text-sm font-semibold text-petrol-800">{{ summary() }}</p>
            <label class="field">
              <span class="label label-required">{{ 'PUB.FULL_NAME' | translate }}</span>
              <input class="input" name="fullName" required maxlength="255" autocomplete="name" [ngModel]="fullName()" (ngModelChange)="fullName.set($event)" />
            </label>
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-[9rem_1fr]">
              <label class="field">
                <span class="label">{{ 'PUB.COUNTRY_CODE' | translate }}</span>
                <select class="select" name="countryCode" [ngModel]="countryCode()" (ngModelChange)="countryCode.set($event)">
                  @for (c of countryCodes; track c.code) {
                    <option [value]="c.code">{{ c.label }}</option>
                  }
                </select>
              </label>
              <label class="field">
                <span class="label label-required">{{ 'PUB.PHONE_WHATSAPP' | translate }}</span>
                <input class="input ltr-data" type="tel" name="phone" required maxlength="40" autocomplete="tel" inputmode="tel" placeholder="6 61 23 45 67"
                  [ngModel]="phone()" (ngModelChange)="phone.set($event)" />
              </label>
            </div>
            @if (phone().trim() && !normalizedPhone()) {
              <p class="text-xs text-critical-700" role="status">{{ 'PUB.PHONE_INVALID' | translate }}</p>
            }
            <label class="field">
              <span class="label">{{ 'PUB.BOOK.NOTE' | translate }}</span>
              <textarea class="textarea" rows="2" name="notes" maxlength="1000" [ngModel]="notes()" (ngModelChange)="notes.set($event)"></textarea>
            </label>
            @if (i.captchaEnabled && i.captchaSiteKey) {
              <div id="turnstile-container" class="pt-1"></div>
            }
            <!-- A field no person sees or tabs to; only a bot fills it. -->
            <div class="absolute -start-[9999px] h-0 w-0 overflow-hidden" aria-hidden="true"><label>Website <input name="website" tabindex="-1" autocomplete="off" [ngModel]="website()" (ngModelChange)="website.set($event)" /></label></div>
            <label class="flex items-start gap-2 text-sm text-ink-700"><input type="checkbox" class="mt-0.5" name="consent" required [ngModel]="consent()" (ngModelChange)="consent.set($event)" /><span>{{ 'PUB.CONSENT' | translate }}</span></label>
            @if (error()) { <p class="rounded-md bg-critical-50 p-3 text-sm text-critical-700" role="alert">{{ error() }}</p> }
            <div class="flex flex-wrap gap-2">
              <button type="button" class="btn btn-ghost" [disabled]="busy()" (click)="step.set('time')">{{ 'COMMON.BACK' | translate }}</button>
              <button type="submit" class="btn btn-primary flex-1" [disabled]="busy() || !ready()">{{ (busy() ? 'PUB.SENDING' : 'PUB.BOOK.SUBMIT') | translate }}</button>
            </div>
          </form>
        }

        @if (step() === 'done' && result(); as r) {
          <section class="card card-pad space-y-4 text-center" role="status">
            <h2 class="text-xl font-bold text-ink-900">{{ 'PUB.BOOK.DONE_CONFIRMED_TITLE' | translate }}</h2>
            <p class="text-ink-700">{{ 'PUB.BOOK.DONE_CONFIRMED_TEXT' | translate }}</p>
            <div class="rounded-lg bg-ink-50 p-4 text-start text-sm text-ink-800 space-y-1">
              <p class="font-semibold text-ink-900">{{ summary() }}</p>
              @if (r.doctorName) { <p>{{ 'PUB.BOOK.WITH_DOCTOR' | translate: { name: r.doctorName } }}</p> }
              @if (r.clinicAddress) { <p>{{ 'PUB.BOOK.ADDRESS_LABEL' | translate }} {{ r.clinicAddress }}</p> }
              <p class="text-ink-500">{{ 'PUB.REFERENCE' | translate }} <strong class="mono text-ink-900">{{ r.reference }}</strong></p>
            </div>

            @if (r.registrationUrl) {
              <div class="space-y-2 pt-2">
                <a class="btn btn-primary w-full justify-center no-underline"
                   [href]="r.registrationUrl"
                   [attr.target]="registrationTarget()"
                   [attr.rel]="registrationTarget() === '_blank' ? 'noopener noreferrer' : null">
                  {{ 'PUB.BOOK.REG_CTA' | translate }}
                </a>
                <p class="text-xs text-ink-500">{{ 'PUB.BOOK.REG_SUPPORTING' | translate }}</p>
              </div>
            } @else if (r.registrationAlreadyCompleted) {
              <p class="rounded-md bg-petrol-50 p-3 text-sm text-petrol-800">{{ 'PUB.BOOK.REG_ALREADY_DONE' | translate }}</p>
            } @else if (r.existingPatient && r.registrationLinkSentByWhatsapp) {
              <p class="rounded-md bg-ink-50 p-3 text-sm text-ink-600">{{ 'PUB.BOOK.REG_SENT_WHATSAPP' | translate }}</p>
            }

            @if (i.phone) { <p class="text-sm text-ink-600">{{ 'PUB.CALL_US' | translate: { phone: i.phone } }}</p> }
          </section>
        }
      }
    </app-public-shell>
  `,
})
export class PublicBookingComponent {
  private readonly api = inject(IntakeApi);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  private readonly token = inject(ActivatedRoute).snapshot.paramMap.get('token') ?? '';

  protected readonly countryCodes = COUNTRY_CODES;
  protected readonly today = isoDate(new Date());
  protected readonly state = signal<'loading' | 'ready' | 'invalid'>('loading');
  protected readonly info = signal<PublicBookingInfo | null>(null);
  protected readonly step = signal<Step>('type');
  protected readonly chosenType = signal<PublicType | null>(null);
  protected readonly practitionerId = signal('');
  protected readonly days = signal<Record<string, string[]>>({});
  protected readonly loadingDays = signal(false);
  private loadedUpTo = 0;
  protected readonly chosen = signal<{ day: string; time: string } | null>(null);

  protected readonly fullName = signal('');
  protected readonly countryCode = signal('+212');
  protected readonly phone = signal('');
  protected readonly notes = signal('');
  protected readonly captchaToken = signal('');
  protected readonly website = signal('');
  protected readonly consent = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly result = signal<DirectBookResult | null>(null);

  protected readonly normalizedPhone = computed(() => normalizeE164(this.phone(), this.countryCode()));
  protected readonly dayList = computed(() => Object.entries(this.days()).sort(([a], [b]) => a.localeCompare(b)).map(([day, times]) => ({ day, times })));
  protected readonly canLoadMore = computed(() => this.step() === 'time' && this.loadedUpTo < (this.info()?.maxDaysAhead ?? 0));
  protected readonly ready = computed(() => !!this.fullName().trim() && !!this.normalizedPhone() && this.consent());
  protected readonly registrationTarget = computed(() => (isMobileViewport() ? '_self' : '_blank'));
  protected readonly summary = computed(() => {
    const c = this.chosen();
    const t = this.chosenType();
    return c && t ? `${typeName(t, this.language.currentLang())} · ${new Intl.DateTimeFormat(this.language.currentLang(), { dateStyle: 'full' }).format(new Date(`${c.day}T12:00:00`))} · ${c.time}` : '';
  });

  constructor() {
    void this.load();
  }

  protected name(t: PublicType): string {
    return typeName(t, this.language.currentLang());
  }

  private async load(): Promise<void> {
    try {
      const info = this.token ? await this.api.publicBookingInfo(this.token) : await this.api.directBookingInfo();
      this.info.set(info);
      if (info.lockedPractitionerId) {
        this.practitionerId.set(info.lockedPractitionerId);
      }
      useClinicLanguage(this.language, info.defaultLanguage);
      this.state.set('ready');
    } catch {
      this.state.set('invalid');
    }
  }

  protected async pickType(t: PublicType): Promise<void> {
    this.chosenType.set(t);
    const info = this.info();
    if (info?.lockedPractitionerId) {
      await this.pickDoctor(info.lockedPractitionerId);
      return;
    }
    this.step.set('doctor');
  }

  protected async pickDoctor(id: string): Promise<void> {
    this.practitionerId.set(id);
    this.days.set({});
    this.loadedUpTo = 0;
    this.chosen.set(null);
    this.step.set('time');
    await this.loadMore();
  }

  protected backFromTime(): void {
    this.step.set(this.info()?.lockedPractitionerId ? 'type' : 'doctor');
  }

  protected async loadMore(): Promise<void> {
    const type = this.chosenType();
    const max = this.info()?.maxDaysAhead ?? 0;
    if (!type || this.loadingDays()) {
      return;
    }
    this.loadingDays.set(true);
    try {
      const start = new Date();
      start.setDate(start.getDate() + this.loadedUpTo);
      const span = Math.min(WINDOW_DAYS, Math.max(max - this.loadedUpTo, 0));
      if (span > 0) {
        const found = this.token
          ? await this.api.publicAvailability(this.token, type.id, this.practitionerId() || undefined, isoDate(start), span)
          : await this.api.directAvailability(type.id, isoDate(start), span);
        this.days.update(d => ({ ...d, ...found }));
        this.loadedUpTo += span;
      }
    } catch (error) {
      this.error.set(this.messageFor(error));
    } finally {
      this.loadingDays.set(false);
    }
  }

  protected isChosen(day: string, time: string): boolean {
    const c = this.chosen();
    return c?.day === day && c.time === time;
  }

  protected pickTime(day: string, time: string): void {
    this.chosen.set({ day, time });
    this.error.set('');
    this.step.set('details');
    this.maybeRenderTurnstile();
  }

  private maybeRenderTurnstile(): void {
    const info = this.info();
    if (!info?.captchaEnabled || !info.captchaSiteKey || typeof document === 'undefined') {
      return;
    }
    const render = () => {
      const w = window as unknown as { turnstile?: { render: (el: string, opts: { sitekey: string; callback: (t: string) => void }) => void } };
      if (w.turnstile && document.getElementById('turnstile-container')) {
        w.turnstile.render('#turnstile-container', {
          sitekey: info.captchaSiteKey!,
          callback: (tok: string) => this.captchaToken.set(tok),
        });
      }
    };
    if (!document.querySelector('script[data-turnstile]')) {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.defer = true;
      s.setAttribute('data-turnstile', 'true');
      s.onload = render;
      document.head.appendChild(s);
    } else {
      setTimeout(render, 50);
    }
  }

  protected async submit(): Promise<void> {
    const type = this.chosenType();
    const slot = this.chosen();
    const info = this.info();
    const e164 = this.normalizedPhone();
    if (!type || !slot || !info || !e164 || this.busy() || !this.ready()) {
      return;
    }
    if (info.captchaEnabled && !this.captchaToken().trim()) {
      this.error.set(this.translate.instant('PUB.BOOK.CAPTCHA_REQUIRED'));
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const payload = {
        appointmentTypeId: type.id,
        practitionerId: this.practitionerId() || undefined,
        startsAt: slotMoment(slot.day, slot.time, info.timeZone),
        fullName: this.fullName().trim(),
        phone: e164,
        countryCode: this.countryCode(),
        notes: this.notes().trim() || undefined,
        language: this.language.currentLang(),
        consent: this.consent(),
        captchaToken: this.captchaToken() || undefined,
        website: this.website(),
      };
      const res = this.token
        ? await this.api.bookWithTokenDirect(this.token, payload)
        : await this.api.bookDirect(payload);
      this.result.set(res);
      this.step.set('done');
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 409) {
        this.error.set(this.translate.instant('PUB.BOOK.SLOT_TAKEN'));
        this.days.set({});
        this.loadedUpTo = 0;
        this.chosen.set(null);
        this.step.set('time');
        await this.loadMore();
      } else {
        this.error.set(this.messageFor(error));
      }
    } finally {
      this.busy.set(false);
    }
  }

  private messageFor(error: unknown): string {
    if (error instanceof HttpErrorResponse && error.status === 429) {
      return this.translate.instant('PUB.TOO_MANY');
    }
    return this.translate.instant('PUB.ERROR');
  }
}
