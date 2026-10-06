import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { IntakeApi, PublicRegistrationInfo, RegistrationForm } from '../../core/services/intake-api.service';
import { LanguageService } from '../../core/services/language.service';
import { formState } from '../../core/utils/form-state';
import { isoDate } from '../../core/utils/format';
import { PublicShellComponent, useClinicLanguage } from './public-shell.component';

export interface RegistrationFields {
  firstName: string;
  lastName: string;
  gender: string;
  dateOfBirth: string;
  phone: string;
  email: string;
  address: string;
  cin: string;
  guardianName: string;
  guardianPhone: string;
  insuranceProvider: string;
  insuranceNumber: string;
  occupation: string;
  consent: boolean;
  consentWhatsapp: boolean;
  consentEmail: boolean;
}

export const BLANK_REGISTRATION: RegistrationFields = {
  firstName: '', lastName: '', gender: '', dateOfBirth: '', phone: '', email: '', address: '', cin: '', guardianName: '', guardianPhone: '',
  insuranceProvider: '', insuranceNumber: '', occupation: '', consent: false, consentWhatsapp: false, consentEmail: false,
};

/** True for someone under 18 on {@code today}: a parent or guardian fills in and answers for them. */
export function isMinor(dateOfBirth: string, today: Date = new Date()): boolean {
  if (!dateOfBirth) {
    return false;
  }
  const born = new Date(`${dateOfBirth}T00:00:00`);
  if (Number.isNaN(born.getTime())) {
    return false;
  }
  let age = today.getFullYear() - born.getFullYear();
  const birthdayPassed = today.getMonth() > born.getMonth() || (today.getMonth() === born.getMonth() && today.getDate() >= born.getDate());
  if (!birthdayPassed) {
    age -= 1;
  }
  return age < 18;
}

/** The form as the server takes it: nothing blank is sent as an empty string, a guardian only for a minor. */
export function registrationRequest(f: RegistrationFields, language: string, website: string): RegistrationForm {
  const blank = (v: string): string | undefined => (v.trim() === '' ? undefined : v.trim());
  const minor = isMinor(f.dateOfBirth);
  return {
    firstName: f.firstName.trim(), lastName: f.lastName.trim(), gender: f.gender || undefined, dateOfBirth: f.dateOfBirth || undefined, phone: blank(f.phone),
    email: blank(f.email), address: blank(f.address), cin: blank(f.cin), guardianName: minor ? blank(f.guardianName) : undefined,
    guardianPhone: minor ? blank(f.guardianPhone) : undefined, insuranceProvider: blank(f.insuranceProvider), insuranceNumber: blank(f.insuranceNumber),
    occupation: blank(f.occupation), language, consent: f.consent, consentWhatsapp: f.consentWhatsapp, consentEmail: f.consentEmail, website,
  };
}

/**
 * The form a new patient fills in from a link (or on a tablet at the desk), so reception does not
 * type it. It creates nothing in the patient register by itself: the clinic reviews it, sees any
 * record it might duplicate, and approves it. The one thing required is consent to keep the data
 * (Law 09-08); contact by WhatsApp or e-mail is a separate, optional choice.
 */
@Component({
  selector: 'app-public-registration',
  standalone: true,
  imports: [FormsModule, TranslateModule, PublicShellComponent],
  template: `
    <app-public-shell [clinic]="info()?.clinicName ?? ''">
      @if (state() === 'loading') {
        <p class="py-16 text-center text-ink-500" role="status">{{ 'COMMON.LOADING' | translate }}</p>
      } @else if (state() === 'invalid' || !info()) {
        <section class="card card-pad text-center">
          <h1 class="text-xl font-bold text-ink-900">{{ 'PUB.INVALID_TITLE' | translate }}</h1>
          <p class="mt-2 text-ink-600">{{ 'PUB.INVALID_TEXT' | translate }}</p>
        </section>
      } @else if (done()) {
        <section class="card card-pad text-center" role="status">
          <h1 class="text-xl font-bold text-ink-900">{{ 'PUB.REG.DONE_TITLE' | translate }}</h1>
          <p class="mt-2 text-ink-700">{{ 'PUB.REG.DONE_TEXT' | translate }}</p>
        </section>
      } @else {
        <h1 class="mb-1 text-2xl font-extrabold text-ink-900">{{ 'PUB.REG.TITLE' | translate }}</h1>
        <p class="mb-5 text-ink-600">{{ 'PUB.REG.INTRO' | translate }}</p>
        <form class="space-y-5" (ngSubmit)="submit()">
          <fieldset class="card card-pad space-y-4">
            <legend class="px-1 font-bold text-ink-900">{{ 'PUB.REG.IDENTITY' | translate }}</legend>
            <div class="grid gap-4 sm:grid-cols-2">
              <label class="field"><span class="label label-required">{{ 'PUB.FIRST_NAME' | translate }}</span><input class="input" name="firstName" required maxlength="255" autocomplete="given-name" [ngModel]="f.value().firstName" (ngModelChange)="f.set('firstName', $event)" /></label>
              <label class="field"><span class="label label-required">{{ 'PUB.LAST_NAME' | translate }}</span><input class="input" name="lastName" required maxlength="255" autocomplete="family-name" [ngModel]="f.value().lastName" (ngModelChange)="f.set('lastName', $event)" /></label>
              <label class="field"><span class="label">{{ 'PUB.DOB' | translate }}</span><input class="input" type="date" name="dob" [max]="today" autocomplete="bday" [ngModel]="f.value().dateOfBirth" (ngModelChange)="f.set('dateOfBirth', $event)" /></label>
              <label class="field"><span class="label">{{ 'PUB.REG.GENDER' | translate }}</span>
                <select class="select" name="gender" [ngModel]="f.value().gender" (ngModelChange)="f.set('gender', $event)">
                  <option value="">—</option><option value="F">{{ 'PUB.REG.FEMALE' | translate }}</option><option value="M">{{ 'PUB.REG.MALE' | translate }}</option>
                </select></label>
              <label class="field"><span class="label">{{ 'PUB.REG.CIN' | translate }}</span><input class="input" name="cin" maxlength="50" autocomplete="off" [ngModel]="f.value().cin" (ngModelChange)="f.set('cin', $event)" /></label>
              <label class="field"><span class="label">{{ 'PUB.REG.OCCUPATION' | translate }}</span><input class="input" name="occupation" maxlength="150" [ngModel]="f.value().occupation" (ngModelChange)="f.set('occupation', $event)" /></label>
            </div>
          </fieldset>

          <fieldset class="card card-pad space-y-4">
            <legend class="px-1 font-bold text-ink-900">{{ 'PUB.REG.CONTACT' | translate }}</legend>
            <div class="grid gap-4 sm:grid-cols-2">
              <label class="field"><span class="label">{{ 'PUB.PHONE' | translate }}</span><input class="input" type="tel" name="phone" maxlength="50" autocomplete="tel" inputmode="tel" [ngModel]="f.value().phone" (ngModelChange)="f.set('phone', $event)" /></label>
              <label class="field"><span class="label">{{ 'PUB.EMAIL' | translate }}</span><input class="input" type="email" name="email" maxlength="255" autocomplete="email" [ngModel]="f.value().email" (ngModelChange)="f.set('email', $event)" /></label>
            </div>
            <label class="field"><span class="label">{{ 'PUB.REG.ADDRESS' | translate }}</span><textarea class="textarea" rows="2" name="address" maxlength="2000" autocomplete="street-address" [ngModel]="f.value().address" (ngModelChange)="f.set('address', $event)"></textarea></label>
          </fieldset>

          @if (minor()) {
            <fieldset class="card card-pad space-y-4">
              <legend class="px-1 font-bold text-ink-900">{{ 'PUB.REG.GUARDIAN' | translate }}</legend>
              <p class="text-sm text-ink-600">{{ 'PUB.REG.GUARDIAN_HINT' | translate }}</p>
              <div class="grid gap-4 sm:grid-cols-2">
                <label class="field"><span class="label">{{ 'PUB.REG.GUARDIAN_NAME' | translate }}</span><input class="input" name="guardianName" maxlength="255" [ngModel]="f.value().guardianName" (ngModelChange)="f.set('guardianName', $event)" /></label>
                <label class="field"><span class="label">{{ 'PUB.REG.GUARDIAN_PHONE' | translate }}</span><input class="input" type="tel" name="guardianPhone" maxlength="50" inputmode="tel" [ngModel]="f.value().guardianPhone" (ngModelChange)="f.set('guardianPhone', $event)" /></label>
              </div>
            </fieldset>
          }

          <fieldset class="card card-pad space-y-4">
            <legend class="px-1 font-bold text-ink-900">{{ 'PUB.REG.INSURANCE' | translate }}</legend>
            <div class="grid gap-4 sm:grid-cols-2">
              <label class="field"><span class="label">{{ 'PUB.REG.INSURANCE_PROVIDER' | translate }}</span><input class="input" name="insuranceProvider" maxlength="100" [ngModel]="f.value().insuranceProvider" (ngModelChange)="f.set('insuranceProvider', $event)" /></label>
              <label class="field"><span class="label">{{ 'PUB.REG.INSURANCE_NUMBER' | translate }}</span><input class="input" name="insuranceNumber" maxlength="100" [ngModel]="f.value().insuranceNumber" (ngModelChange)="f.set('insuranceNumber', $event)" /></label>
            </div>
          </fieldset>

          <fieldset class="card card-pad space-y-3">
            <legend class="px-1 font-bold text-ink-900">{{ 'PUB.REG.CONSENTS' | translate }}</legend>
            <label class="flex items-start gap-2 text-sm text-ink-800"><input type="checkbox" class="mt-0.5" name="consent" required [ngModel]="f.value().consent" (ngModelChange)="f.set('consent', $event)" /><span>{{ 'PUB.REG.CONSENT_DATA' | translate }}</span></label>
            <label class="flex items-start gap-2 text-sm text-ink-700"><input type="checkbox" class="mt-0.5" name="consentWhatsapp" [ngModel]="f.value().consentWhatsapp" (ngModelChange)="f.set('consentWhatsapp', $event)" /><span>{{ 'PUB.REG.CONSENT_WHATSAPP' | translate }}</span></label>
            <label class="flex items-start gap-2 text-sm text-ink-700"><input type="checkbox" class="mt-0.5" name="consentEmail" [ngModel]="f.value().consentEmail" (ngModelChange)="f.set('consentEmail', $event)" /><span>{{ 'PUB.REG.CONSENT_EMAIL' | translate }}</span></label>
          </fieldset>

          <div class="absolute -start-[9999px] h-0 w-0 overflow-hidden" aria-hidden="true"><label>Website <input name="website" tabindex="-1" autocomplete="off" [ngModel]="website()" (ngModelChange)="website.set($event)" /></label></div>
          @if (error()) { <p class="rounded-md bg-critical-50 p-3 text-sm text-critical-700" role="alert">{{ error() }}</p> }
          <button type="submit" class="btn btn-primary w-full" [disabled]="busy() || !ready()">{{ (busy() ? 'PUB.SENDING' : 'PUB.REG.SUBMIT') | translate }}</button>
        </form>
      }
    </app-public-shell>
  `,
})
export class PublicRegistrationComponent {
  private readonly api = inject(IntakeApi);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);
  private readonly token = inject(ActivatedRoute).snapshot.paramMap.get('token') ?? '';

  protected readonly today = isoDate(new Date());
  protected readonly state = signal<'loading' | 'ready' | 'invalid'>('loading');
  protected readonly info = signal<PublicRegistrationInfo | null>(null);
  protected readonly f = formState<RegistrationFields>({ ...BLANK_REGISTRATION });
  protected readonly website = signal('');
  protected readonly busy = signal(false);
  protected readonly done = signal(false);
  protected readonly error = signal('');

  protected readonly minor = computed(() => isMinor(this.f.value().dateOfBirth));
  protected readonly ready = computed(() => !!this.f.value().firstName.trim() && !!this.f.value().lastName.trim() && this.f.value().consent);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const info = await this.api.publicRegistrationInfo(this.token);
      this.info.set(info);
      useClinicLanguage(this.language, info.defaultLanguage);
      this.state.set('ready');
    } catch {
      this.state.set('invalid');
    }
  }

  protected async submit(): Promise<void> {
    if (this.busy() || !this.ready()) {
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      await this.api.submitRegistration(this.token, registrationRequest(this.f.value(), this.language.currentLang(), this.website()));
      this.done.set(true);
    } catch (error) {
      this.error.set(this.translate.instant(error instanceof HttpErrorResponse && error.status === 429 ? 'PUB.TOO_MANY' : error instanceof HttpErrorResponse && error.status === 409 ? 'PUB.REG.ALREADY' : 'PUB.ERROR'));
    } finally {
      this.busy.set(false);
    }
  }
}
