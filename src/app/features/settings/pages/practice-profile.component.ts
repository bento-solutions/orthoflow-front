import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { ApiErrors } from '../../../core/services/api-error.service';
import { PracticeProfileInput, PracticeProfileService } from '../../../core/services/practice-profile.service';
import { ToastService } from '../../../core/services/toast.service';
import { formState } from '../../../core/utils/form-state';

type Form = {
  name: string; legalName: string; ice: string; taxId: string; patente: string; cnssNumber: string; rib: string; inpe: string;
  address: string; city: string; phone: string; email: string; website: string; currency: string; timezone: string; defaultLanguage: string;
};

const TIMEZONES = ['Africa/Casablanca', 'Europe/Paris', 'Europe/Madrid', 'Africa/Algiers', 'Africa/Tunis', 'UTC'];
const CURRENCIES = ['MAD', 'EUR', 'USD'];

const fromProfile = (p: Partial<Record<keyof Form, string | undefined>>): Form => ({
  name: p.name ?? '', legalName: p.legalName ?? '', ice: p.ice ?? '', taxId: p.taxId ?? '', patente: p.patente ?? '', cnssNumber: p.cnssNumber ?? '',
  rib: p.rib ?? '', inpe: p.inpe ?? '', address: p.address ?? '', city: p.city ?? '', phone: p.phone ?? '', email: p.email ?? '', website: p.website ?? '',
  currency: p.currency ?? 'MAD', timezone: p.timezone ?? 'Africa/Casablanca', defaultLanguage: p.defaultLanguage ?? 'fr',
});

/** The clinic's identity: what is printed on every invoice, fee note, statement and label. Held on the server so every station agrees. */
@Component({
  selector: 'app-practice-profile',
  standalone: true,
  imports: [FormsModule, TranslateModule],
  template: `
    <form class="space-y-6" (ngSubmit)="save()">
      <section class="card card-pad">
        <h2 class="mb-1 text-lg font-bold text-ink-900">{{ 'SET.PROFILE.IDENTITY' | translate }}</h2>
        <p class="mb-4 text-sm text-ink-500">{{ 'SET.PROFILE.IDENTITY_HINT' | translate }}</p>
        <div class="grid gap-4 sm:grid-cols-2">
          <div class="flex items-center gap-4 sm:col-span-2">
            <div class="grid h-20 w-28 shrink-0 place-items-center overflow-hidden rounded-md border border-ink-200 bg-white">
              @if (profile.logoUrl()) { <img [src]="profile.logoUrl()" alt="" class="max-h-full max-w-full object-contain" /> }
              @else { <span class="text-xs text-ink-400">{{ 'SET.PROFILE.NO_LOGO' | translate }}</span> }
            </div>
            <div>
              <label class="btn btn-secondary btn-sm cursor-pointer">
                {{ 'SET.PROFILE.CHOOSE_LOGO' | translate }}
                <input type="file" class="sr-only" accept="image/png,image/jpeg" (change)="logoChosen($event)" />
              </label>
              <p class="hint mt-1">{{ 'SET.PROFILE.LOGO_HINT' | translate }}</p>
            </div>
          </div>
          <label class="field"><span class="label label-required">{{ 'SET.PROFILE.NAME' | translate }}</span>
            <input class="input" name="name" required maxlength="200" [ngModel]="f.value().name" (ngModelChange)="f.set('name', $event)" /></label>
          <label class="field"><span class="label">{{ 'SET.PROFILE.LEGAL_NAME' | translate }}</span>
            <input class="input" name="legalName" maxlength="200" [ngModel]="f.value().legalName" (ngModelChange)="f.set('legalName', $event)" /></label>
          <label class="field sm:col-span-2"><span class="label">{{ 'SET.PROFILE.ADDRESS' | translate }}</span>
            <input class="input" name="address" maxlength="500" [ngModel]="f.value().address" (ngModelChange)="f.set('address', $event)" /></label>
          <label class="field"><span class="label">{{ 'SET.PROFILE.CITY' | translate }}</span>
            <input class="input" name="city" maxlength="100" [ngModel]="f.value().city" (ngModelChange)="f.set('city', $event)" /></label>
          <label class="field"><span class="label">{{ 'SET.PROFILE.PHONE' | translate }}</span>
            <input class="input" name="phone" maxlength="40" [ngModel]="f.value().phone" (ngModelChange)="f.set('phone', $event)" /></label>
          <label class="field"><span class="label">Email</span>
            <input class="input" type="email" name="email" maxlength="255" [ngModel]="f.value().email" (ngModelChange)="f.set('email', $event)" /></label>
          <label class="field"><span class="label">{{ 'SET.PROFILE.WEBSITE' | translate }}</span>
            <input class="input" name="website" maxlength="255" [ngModel]="f.value().website" (ngModelChange)="f.set('website', $event)" /></label>
        </div>
      </section>

      <section class="card card-pad">
        <h2 class="mb-1 text-lg font-bold text-ink-900">{{ 'SET.PROFILE.LEGAL' | translate }}</h2>
        <p class="mb-4 text-sm text-ink-500">{{ 'SET.PROFILE.LEGAL_HINT' | translate }}</p>
        <div class="grid gap-4 sm:grid-cols-3">
          <label class="field"><span class="label">ICE</span><input class="input mono" name="ice" maxlength="30" [ngModel]="f.value().ice" (ngModelChange)="f.set('ice', $event)" /></label>
          <label class="field"><span class="label">IF</span><input class="input mono" name="taxId" maxlength="30" [ngModel]="f.value().taxId" (ngModelChange)="f.set('taxId', $event)" /></label>
          <label class="field"><span class="label">{{ 'SET.PROFILE.PATENTE' | translate }}</span><input class="input mono" name="patente" maxlength="30" [ngModel]="f.value().patente" (ngModelChange)="f.set('patente', $event)" /></label>
          <label class="field"><span class="label">CNSS</span><input class="input mono" name="cnssNumber" maxlength="30" [ngModel]="f.value().cnssNumber" (ngModelChange)="f.set('cnssNumber', $event)" /></label>
          <label class="field"><span class="label">INPE</span><input class="input mono" name="inpe" maxlength="20" [ngModel]="f.value().inpe" (ngModelChange)="f.set('inpe', $event)" /></label>
          <label class="field"><span class="label">RIB</span><input class="input mono" name="rib" maxlength="40" [ngModel]="f.value().rib" (ngModelChange)="f.set('rib', $event)" /></label>
        </div>
      </section>

      <section class="card card-pad">
        <h2 class="mb-4 text-lg font-bold text-ink-900">{{ 'SET.PROFILE.REGIONAL' | translate }}</h2>
        <div class="grid gap-4 sm:grid-cols-3">
          <label class="field"><span class="label">{{ 'SET.PROFILE.CURRENCY' | translate }}</span>
            <select class="select" name="currency" [ngModel]="f.value().currency" (ngModelChange)="f.set('currency', $event)">
              @for (c of currencies; track c) { <option [value]="c">{{ c }}</option> }
            </select></label>
          <label class="field"><span class="label">{{ 'SET.PROFILE.TIMEZONE' | translate }}</span>
            <select class="select" name="timezone" [ngModel]="f.value().timezone" (ngModelChange)="f.set('timezone', $event)">
              @for (t of timezones; track t) { <option [value]="t">{{ t }}</option> }
            </select></label>
          <label class="field"><span class="label">{{ 'SET.PROFILE.DEFAULT_LANGUAGE' | translate }}</span>
            <select class="select" name="defaultLanguage" [ngModel]="f.value().defaultLanguage" (ngModelChange)="f.set('defaultLanguage', $event)">
              <option value="fr">Français</option><option value="en">English</option><option value="ar">العربية</option>
            </select>
            <span class="hint">{{ 'SET.PROFILE.DEFAULT_LANGUAGE_HINT' | translate }}</span></label>
        </div>
      </section>

      <div class="flex justify-end">
        <button type="submit" class="btn btn-primary" [disabled]="saving() || !f.value().name.trim()">{{ 'COMMON.SAVE' | translate }}</button>
      </div>
    </form>
  `,
})
export class PracticeProfileComponent {
  protected readonly profile = inject(PracticeProfileService);
  private readonly errors = inject(ApiErrors);
  private readonly toast = inject(ToastService);

  protected readonly currencies = CURRENCIES;
  protected readonly timezones = TIMEZONES;
  protected readonly f = formState<Form>(fromProfile({}));
  protected readonly saving = signal(false);

  constructor() {
    void this.profile.refresh().then(() => {
      const p = this.profile.profile();
      if (p) {
        this.f.reset(fromProfile(p));
      }
    });
  }

  protected async save(): Promise<void> {
    const v = this.f.value();
    const blank = (s: string) => (s.trim() === '' ? undefined : s.trim());
    const input: PracticeProfileInput = {
      name: v.name.trim(), legalName: blank(v.legalName), ice: blank(v.ice), taxId: blank(v.taxId), patente: blank(v.patente),
      cnssNumber: blank(v.cnssNumber), rib: blank(v.rib), inpe: blank(v.inpe), address: blank(v.address), city: blank(v.city), phone: blank(v.phone),
      email: blank(v.email), website: blank(v.website), currency: v.currency, timezone: v.timezone, defaultLanguage: v.defaultLanguage as 'fr' | 'en' | 'ar',
      logoFileId: this.profile.profile()?.logoFileId,
    };
    this.saving.set(true);
    try {
      await this.profile.save(input);
      this.toast.success('✓');
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.saving.set(false);
    }
  }

  protected async logoChosen(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    if (file.size > 500 * 1024) {
      this.toast.error('500 KB max');
      return;
    }
    try {
      await this.profile.uploadLogo(file);
      this.toast.success('✓');
    } catch (error) {
      this.errors.report(error);
    }
  }
}
