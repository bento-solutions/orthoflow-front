import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { IntakeApi, PublicBookingInfo } from '../../core/services/intake-api.service';
import { LanguageService } from '../../core/services/language.service';
import { isoDate } from '../../core/utils/format';
import { zonedIso } from '../../core/utils/zoned';
import { PublicShellComponent, useClinicLanguage } from './public-shell.component';

type Step = 'type' | 'doctor' | 'time' | 'details' | 'done';
type PublicType = PublicBookingInfo['types'][number];

const WINDOW_DAYS = 14;

/** The appointment type's name in the visitor's language, falling back to French. */
export function typeName(type: Pick<PublicType, 'nameFr' | 'nameEn' | 'nameAr'>, lang: string): string {
  return (lang === 'ar' ? type.nameAr : lang === 'en' ? type.nameEn : type.nameFr) || type.nameFr;
}

/** A day and a free time as a moment the server reads the way the patient clicked it. */
export function slotMoment(day: string, time: string, timeZone: string | null | undefined): string {
  return timeZone ? zonedIso(day, time, timeZone) : `${day}T${time}:00`;
}

/**
 * Book an appointment from a link. Four short steps (what for, with whom, when, who you are) and a
 * request that the clinic confirms; nothing is booked until they do. The free times come from the
 * clinic's diary, so a time that is shown is a time that was free a moment ago, and the server
 * checks again when the request arrives.
 */
@Component({
  selector: 'app-public-booking',
  standalone: true,
  imports: [DatePipe, FormsModule, TranslateModule, PublicShellComponent],
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
        <p class="mb-5 text-ink-600">{{ 'PUB.BOOK.INTRO' | translate }}</p>

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
                <h3 class="mb-1.5 text-sm font-semibold text-ink-700">{{ day.day + 'T12:00:00' | date: 'fullDate' }}</h3>
                <div class="flex flex-wrap gap-2">
                  @for (t of day.times; track t) {
                    <button type="button" class="rounded-md border border-ink-200 bg-surface px-3 py-1.5 text-sm font-semibold tabular-nums text-ink-900 hover:border-petrol-400 hover:bg-petrol-50"
                      [class.!border-petrol-600]="isChosen(day.day, t)" [class.!bg-petrol-600]="isChosen(day.day, t)" [class.!text-white]="isChosen(day.day, t)" [attr.aria-pressed]="isChosen(day.day, t)"
                      (click)="pickTime(day.day, t)">{{ t }}</button>
                  }
                </div>
              </div>
            } @empty {
              @if (!loadingDays()) { <p class="rounded-md bg-ink-50 p-3 text-ink-700">{{ 'PUB.BOOK.NO_SLOTS' | translate: { phone: i.phone || '' } }}</p> }
            }
            @if (canLoadMore()) { <button type="button" class="btn btn-secondary btn-sm" [disabled]="loadingDays()" (click)="loadMore()">{{ 'PUB.BOOK.MORE_DAYS' | translate }}</button> }
            <div><button type="button" class="btn btn-ghost mt-4" (click)="step.set('doctor')">{{ 'COMMON.BACK' | translate }}</button></div>
          </section>
        }

        @if (step() === 'details') {
          <form class="card card-pad space-y-4" (ngSubmit)="submit()" aria-labelledby="step-details">
            <h2 id="step-details" class="font-bold text-ink-900">{{ 'PUB.BOOK.STEP_DETAILS' | translate }}</h2>
            <p class="rounded-md bg-petrol-50 p-3 text-sm font-semibold text-petrol-800">{{ summary() }}</p>
            <div class="grid gap-4 sm:grid-cols-2">
              <label class="field"><span class="label label-required">{{ 'PUB.FIRST_NAME' | translate }}</span><input class="input" name="firstName" required maxlength="255" autocomplete="given-name" [ngModel]="firstName()" (ngModelChange)="firstName.set($event)" /></label>
              <label class="field"><span class="label label-required">{{ 'PUB.LAST_NAME' | translate }}</span><input class="input" name="lastName" required maxlength="255" autocomplete="family-name" [ngModel]="lastName()" (ngModelChange)="lastName.set($event)" /></label>
              <label class="field"><span class="label label-required">{{ 'PUB.PHONE' | translate }}</span><input class="input" type="tel" name="phone" required maxlength="40" autocomplete="tel" inputmode="tel" [ngModel]="phone()" (ngModelChange)="phone.set($event)" /></label>
              <label class="field"><span class="label">{{ 'PUB.EMAIL' | translate }}</span><input class="input" type="email" name="email" maxlength="255" autocomplete="email" [ngModel]="email()" (ngModelChange)="email.set($event)" /></label>
              <label class="field"><span class="label">{{ 'PUB.DOB' | translate }}</span><input class="input" type="date" name="dob" [max]="today" autocomplete="bday" [ngModel]="dob()" (ngModelChange)="dob.set($event)" /></label>
            </div>
            <label class="field"><span class="label">{{ 'PUB.BOOK.NOTE' | translate }}</span><textarea class="textarea" rows="2" name="note" maxlength="1000" [ngModel]="note()" (ngModelChange)="note.set($event)"></textarea></label>
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

        @if (step() === 'done') {
          <section class="card card-pad text-center" role="status">
            <h2 class="text-xl font-bold text-ink-900">{{ 'PUB.BOOK.DONE_TITLE' | translate }}</h2>
            <p class="mt-2 text-ink-700">{{ 'PUB.BOOK.DONE_TEXT' | translate }}</p>
            <p class="mt-3 text-sm text-ink-500">{{ 'PUB.REFERENCE' | translate }} <strong class="mono text-ink-900">{{ reference() }}</strong></p>
            @if (i.phone) { <p class="mt-3 text-sm text-ink-600">{{ 'PUB.CALL_US' | translate: { phone: i.phone } }}</p> }
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

  protected readonly firstName = signal('');
  protected readonly lastName = signal('');
  protected readonly phone = signal('');
  protected readonly email = signal('');
  protected readonly dob = signal('');
  protected readonly note = signal('');
  protected readonly website = signal('');
  protected readonly consent = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly reference = signal('');

  protected readonly dayList = computed(() => Object.entries(this.days()).sort(([a], [b]) => a.localeCompare(b)).map(([day, times]) => ({ day, times })));
  protected readonly canLoadMore = computed(() => this.step() === 'time' && this.loadedUpTo < (this.info()?.maxDaysAhead ?? 0));
  protected readonly ready = computed(() => !!this.firstName().trim() && !!this.lastName().trim() && !!this.phone().trim() && this.consent());
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
      const info = await this.api.publicBookingInfo(this.token);
      this.info.set(info);
      useClinicLanguage(this.language, info.defaultLanguage);
      this.state.set('ready');
    } catch {
      this.state.set('invalid');
    }
  }

  protected pickType(t: PublicType): void {
    this.chosenType.set(t);
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
        const found = await this.api.publicAvailability(this.token, type.id, this.practitionerId() || undefined, isoDate(start), span);
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
  }

  protected async submit(): Promise<void> {
    const type = this.chosenType();
    const slot = this.chosen();
    const info = this.info();
    if (!type || !slot || !info || this.busy() || !this.ready()) {
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const received = await this.api.submitBooking(this.token, {
        appointmentTypeId: type.id,
        practitionerId: this.practitionerId() || undefined,
        startsAt: slotMoment(slot.day, slot.time, info.timeZone),
        firstName: this.firstName().trim(),
        lastName: this.lastName().trim(),
        phone: this.phone().trim(),
        email: this.email().trim() || undefined,
        dateOfBirth: this.dob() || undefined,
        note: this.note().trim() || undefined,
        language: this.language.currentLang(),
        consent: this.consent(),
        website: this.website(),
      });
      this.reference.set(received.reference);
      this.step.set('done');
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 409) {
        // Someone took the time between the page loading and the request: show the free ones again.
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
