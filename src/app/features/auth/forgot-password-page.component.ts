import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { AuthApiService } from '../../core/services/auth-api.service';
import { AuthLayoutComponent } from '../../shared/components/auth-layout/auth-layout.component';

@Component({
  standalone: true,
  imports: [ReactiveFormsModule, TranslateModule, RouterLink, AuthLayoutComponent],
  template: `
    <app-auth-layout>
      <div class="mb-10">
        <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-petrol-600 text-white font-bold mb-4">O</div>
        <h1 class="text-3xl font-bold text-ink-900 tracking-tight">{{ 'AUTH.FORGOT_TITLE' | translate }}</h1>
        <p class="mt-2 text-ink-600">{{ 'AUTH.FORGOT_SUBTITLE' | translate }}</p>
      </div>

      @if (submitted()) {
        <div class="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-800" role="status">
          {{ 'AUTH.FORGOT_SUCCESS' | translate }}
        </div>
      } @else {
        <form class="space-y-6" [formGroup]="form" (ngSubmit)="submit()">
          @if (errorMessage()) {
            <div class="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700" role="alert">
              {{ errorMessage() | translate }}
            </div>
          }

          <div class="space-y-2">
            <label class="text-sm font-semibold text-ink-600" for="email">{{ 'AUTH.EMAIL_LABEL' | translate }}</label>
            <input
              id="email"
              type="email"
              formControlName="email"
              placeholder="doctor@orthoflow.com"
              autocomplete="username"
              class="w-full rounded-xl border border-ortho-navy/10 bg-white px-4 py-3.5 transition-all focus:border-ortho-teal focus:ring-4 focus:ring-ortho-teal/5"
              [attr.aria-invalid]="form.controls.email.invalid && form.controls.email.touched"
            />
            @if (form.controls.email.invalid && form.controls.email.touched) {
              <p class="text-xs text-red-700">{{ 'AUTH.EMAIL_ERROR' | translate }}</p>
            }
          </div>

          <button
            type="submit"
            [disabled]="submitting()"
            class="w-full rounded-xl bg-petrol-600 py-4 font-bold text-white transition-all hover:bg-petrol-700 hover:shadow-lg disabled:opacity-60"
          >
            {{ (submitting() ? 'AUTH.SENDING' : 'AUTH.SEND_RESET_LINK') | translate }}
          </button>
        </form>
      }

      <p class="mt-6 text-center text-sm text-ink-600">
        <a routerLink="/login" class="font-bold text-petrol-700 hover:underline">{{ 'AUTH.BACK_TO_LOGIN' | translate }}</a>
      </p>
    </app-auth-layout>
  `,
})
export class ForgotPasswordPageComponent {
  private fb = inject(FormBuilder);
  private authApi = inject(AuthApiService);

  submitting = signal(false);
  submitted = signal(false);
  errorMessage = signal<string | null>(null);

  form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
  });

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set(null);
    const { email } = this.form.getRawValue();

    this.authApi.forgotPassword(email).subscribe({
      // The backend intentionally responds the same way whether or not the
      // email is registered, so this success state must never reveal that
      // either — showing a differing message here would defeat the
      // enumeration protection the backend already went to the trouble of.
      next: () => { this.submitting.set(false); this.submitted.set(true); },
      error: (err) => {
        this.submitting.set(false);
        if (err.status === 0) {
          this.errorMessage.set('AUTH.SERVER_UNREACHABLE');
          return;
        }
        // Any other status (validation, 5xx) still shows the generic
        // success state rather than leaking which emails exist.
        this.submitted.set(true);
      },
    });
  }
}
