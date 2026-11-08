import { Component, inject, signal } from '@angular/core';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { AuthService } from '../../core/services/auth.service';
import { CabinetService } from '../../core/services/cabinet.service';
import { AuthLayoutComponent } from '../../shared/components/auth-layout/auth-layout.component';

@Component({
  standalone: true,
  imports: [ReactiveFormsModule, TranslateModule, RouterLink, AuthLayoutComponent],
  template: `
    <app-auth-layout>
      <div class="mb-10">
        <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-petrol-600 text-white font-bold mb-4">O</div>
        <h1 class="text-3xl font-bold text-ink-900 tracking-tight">{{ 'AUTH.SIGN_IN_TITLE' | translate }}</h1>
        <p class="mt-2 text-ink-600">{{ 'AUTH.SIGN_IN_SUBTITLE' | translate }}</p>
      </div>

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

        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <label class="text-sm font-semibold text-ink-600" for="password">{{ 'AUTH.PASSWORD_LABEL' | translate }}</label>
            <a routerLink="/forgot-password" class="text-sm font-semibold text-petrol-700 hover:underline">{{ 'AUTH.FORGOT_PASSWORD_LINK' | translate }}</a>
          </div>
          <input
            id="password"
            type="password"
            formControlName="password"
            placeholder="••••••••"
            autocomplete="current-password"
            class="w-full rounded-xl border border-ortho-navy/10 bg-white px-4 py-3.5 transition-all focus:border-ortho-teal focus:ring-4 focus:ring-ortho-teal/5"
            [attr.aria-invalid]="form.controls.password.invalid && form.controls.password.touched"
          />
          @if (form.controls.password.invalid && form.controls.password.touched) {
            <p class="text-xs text-red-700">{{ 'AUTH.PASSWORD_ERROR' | translate }}</p>
          }
        </div>

        <button
          type="submit"
          [disabled]="submitting()"
          class="w-full rounded-xl bg-petrol-600 py-4 font-bold text-white transition-all hover:bg-petrol-700 hover:shadow-lg disabled:opacity-60"
        >
          {{ (submitting() ? 'AUTH.SIGNING_IN' : 'AUTH.SIGN_IN_BUTTON') | translate }}
        </button>
      </form>

      @if (!isOnboarded()) {
        <p class="mt-6 text-center text-sm text-ink-600">
          {{ 'AUTH.NEW_CLINIC' | translate }}
          <a routerLink="/onboarding" class="font-bold text-petrol-700 hover:underline">{{ 'AUTH.GET_STARTED' | translate }}</a>
        </p>
      }
    </app-auth-layout>
  `,
})
export class LoginPageComponent {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private cabinetService = inject(CabinetService);

  submitting = signal(false);
  errorMessage = signal<string | null>(null);
  isOnboarded = this.cabinetService.isOnboarded;

  form = this.fb.nonNullable.group({
    email: [this.route.snapshot.queryParamMap.get('email') ?? '', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  submit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.errorMessage.set(null);
    const { email, password } = this.form.getRawValue();

    this.authService.login(email, password).subscribe({
      next: () => {
        this.submitting.set(false);
        const redirectTo = this.route.snapshot.queryParamMap.get('redirectTo') || '/';
        this.router.navigateByUrl(redirectTo);
      },
      error: () => {
        this.submitting.set(false);
        this.errorMessage.set('AUTH.LOGIN_FAILED');
      }
    });
  }
}
