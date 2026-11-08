import { Component, inject, signal } from '@angular/core';
import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { ReactiveFormsModule, FormBuilder, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { AuthApiService } from '../../core/services/auth-api.service';
import { AuthLayoutComponent } from '../../shared/components/auth-layout/auth-layout.component';

function passwordsMatchValidator(control: AbstractControl): ValidationErrors | null {
  const password = control.get('newPassword')?.value;
  const confirm = control.get('confirmPassword')?.value;
  return password && confirm && password !== confirm ? { passwordMismatch: true } : null;
}

@Component({
  standalone: true,
  imports: [ReactiveFormsModule, TranslateModule, RouterLink, AuthLayoutComponent],
  template: `
    <app-auth-layout>
      <div class="mb-10">
        <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-petrol-600 text-white font-bold mb-4">O</div>
        <h1 class="text-3xl font-bold text-ink-900 tracking-tight">{{ 'AUTH.RESET_TITLE' | translate }}</h1>
        <p class="mt-2 text-ink-600">{{ 'AUTH.RESET_SUBTITLE' | translate }}</p>
      </div>

      @if (!token()) {
        <div class="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700" role="alert">
          {{ 'AUTH.RESET_LINK_INVALID' | translate }}
        </div>
        <p class="mt-6 text-center text-sm text-ink-600">
          <a routerLink="/forgot-password" class="font-bold text-petrol-700 hover:underline">{{ 'AUTH.REQUEST_NEW_LINK' | translate }}</a>
        </p>
      } @else if (succeeded()) {
        <div class="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-800" role="status">
          {{ 'AUTH.RESET_SUCCESS' | translate }}
        </div>
        <p class="mt-6 text-center text-sm text-ink-600">
          <a routerLink="/login" class="font-bold text-petrol-700 hover:underline">{{ 'AUTH.BACK_TO_LOGIN' | translate }}</a>
        </p>
      } @else {
        <form class="space-y-6" [formGroup]="form" (ngSubmit)="submit()">
          @if (errorMessage()) {
            <div class="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700" role="alert">
              {{ errorMessage() | translate }}
            </div>
          }

          <div class="space-y-2">
            <label class="text-sm font-semibold text-ink-600" for="newPassword">{{ 'AUTH.NEW_PASSWORD_LABEL' | translate }}</label>
            <input
              id="newPassword"
              type="password"
              formControlName="newPassword"
              [placeholder]="'AUTH.PASSWORD_MIN_HINT' | translate"
              autocomplete="new-password"
              class="w-full rounded-xl border border-ortho-navy/10 bg-white px-4 py-3.5 transition-all focus:border-ortho-teal focus:ring-4 focus:ring-ortho-teal/5"
              [attr.aria-invalid]="form.controls.newPassword.invalid && form.controls.newPassword.touched"
            />
            @if (form.controls.newPassword.invalid && form.controls.newPassword.touched) {
              <p class="text-xs text-red-700">{{ 'AUTH.NEW_PASSWORD_ERROR' | translate }}</p>
            }
          </div>

          <div class="space-y-2">
            <label class="text-sm font-semibold text-ink-600" for="confirmPassword">{{ 'AUTH.CONFIRM_PASSWORD_LABEL' | translate }}</label>
            <input
              id="confirmPassword"
              type="password"
              formControlName="confirmPassword"
              [placeholder]="'AUTH.PASSWORD_REPEAT_HINT' | translate"
              autocomplete="new-password"
              class="w-full rounded-xl border border-ortho-navy/10 bg-white px-4 py-3.5 transition-all focus:border-ortho-teal focus:ring-4 focus:ring-ortho-teal/5"
              [attr.aria-invalid]="form.errors?.['passwordMismatch'] && form.controls.confirmPassword.touched"
            />
            @if (form.errors?.['passwordMismatch'] && form.controls.confirmPassword.touched) {
              <p class="text-xs text-red-700">{{ 'AUTH.PASSWORD_MISMATCH_ERROR' | translate }}</p>
            }
          </div>

          <button
            type="submit"
            [disabled]="submitting()"
            class="w-full rounded-xl bg-petrol-600 py-4 font-bold text-white transition-all hover:bg-petrol-700 hover:shadow-lg disabled:opacity-60"
          >
            {{ (submitting() ? 'AUTH.RESETTING' : 'AUTH.RESET_PASSWORD_BUTTON') | translate }}
          </button>
        </form>
      }
    </app-auth-layout>
  `,
})
export class ResetPasswordPageComponent {
  private fb = inject(FormBuilder);
  private authApi = inject(AuthApiService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  token = signal<string | null>(this.route.snapshot.queryParamMap.get('token'));
  submitting = signal(false);
  succeeded = signal(false);
  errorMessage = signal<string | null>(null);

  form = this.fb.nonNullable.group(
    {
      newPassword: ['', [Validators.required, Validators.minLength(10)]],
      confirmPassword: ['', [Validators.required]],
    },
    { validators: passwordsMatchValidator }
  );

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const token = this.token();
    if (!token) return;

    this.submitting.set(true);
    this.errorMessage.set(null);
    const { newPassword } = this.form.getRawValue();

    this.authApi.resetPassword(token, newPassword).subscribe({
      next: () => { this.submitting.set(false); this.succeeded.set(true); },
      error: (err) => {
        this.submitting.set(false);
        this.errorMessage.set(err.status === 0 ? 'AUTH.SERVER_UNREACHABLE' : 'AUTH.RESET_LINK_INVALID');
      },
    });
  }
}
