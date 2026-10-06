import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { ApiErrors } from '../../../core/services/api-error.service';
import { AuthService } from '../../../core/services/auth.service';
import { LanguageService } from '../../../core/services/language.service';
import { PermissionService } from '../../../core/services/permission.service';
import { ThemePreference, ThemeService } from '../../../core/services/theme.service';
import { ToastService } from '../../../core/services/toast.service';
import { SessionRow, UserAdminService } from '../../../core/services/user-admin.service';
import { formState } from '../../../core/utils/form-state';
import { loadable } from '../../../core/utils/loadable';

/** Passwords the server will accept: at least ten characters, and not the one it replaces. */
export function passwordProblem(current: string, next: string, confirm: string): 'short' | 'same' | 'mismatch' | null {
  if (next.length < 10) {
    return 'short';
  }
  if (next === current) {
    return 'same';
  }
  return next === confirm ? null : 'mismatch';
}

/** What a browser calls itself, reduced to something a person recognises: "Chrome on macOS". */
export function describeDevice(userAgent: string | null | undefined): string {
  if (!userAgent) {
    return '—';
  }
  const browser = /Edg\//.test(userAgent) ? 'Edge' : /OPR\//.test(userAgent) ? 'Opera' : /Chrome\//.test(userAgent) ? 'Chrome'
    : /Firefox\//.test(userAgent) ? 'Firefox' : /Safari\//.test(userAgent) ? 'Safari' : null;
  const system = /Windows/.test(userAgent) ? 'Windows' : /Android/.test(userAgent) ? 'Android' : /iPhone|iPad/.test(userAgent) ? 'iOS'
    : /Mac OS X/.test(userAgent) ? 'macOS' : /Linux/.test(userAgent) ? 'Linux' : null;
  return browser && system ? `${browser} · ${system}` : (browser ?? system ?? userAgent.slice(0, 40));
}

/** The signed-in person's own page: how the app looks, their password, and where they are signed in. */
@Component({
  selector: 'app-account',
  standalone: true,
  imports: [FormsModule, TranslateModule, DatePipe],
  template: `
    <div class="page-head">
      <div>
        <h1 class="page-title">{{ 'NAV.ACCOUNT' | translate }}</h1>
        <p class="page-sub">{{ user()?.email }} · {{ 'SET.USERS.ROLES.' + user()?.role | translate }}</p>
      </div>
    </div>

    <div class="grid gap-6 lg:grid-cols-2">
      <section class="card card-pad space-y-5">
        <h2 class="text-lg font-bold text-ink-900">{{ 'SET.ACCOUNT.PREFERENCES' | translate }}</h2>
        <div class="field">
          <span class="label">{{ 'COMMON.LANGUAGE' | translate }}</span>
          <div class="seg" role="group" [attr.aria-label]="'COMMON.LANGUAGE' | translate">
            @for (l of languages; track l.code) {
              <button type="button" class="seg-item" [class.is-active]="language.currentLang() === l.code" [attr.aria-pressed]="language.currentLang() === l.code" (click)="setLanguage(l.code)">{{ l.label }}</button>
            }
          </div>
        </div>
        <div class="field">
          <span class="label">{{ 'COMMON.THEME' | translate }}</span>
          <div class="seg" role="group" [attr.aria-label]="'COMMON.THEME' | translate">
            @for (t of themes; track t.value) {
              <button type="button" class="seg-item" [class.is-active]="theme.preference() === t.value" [attr.aria-pressed]="theme.preference() === t.value" (click)="theme.set(t.value)">{{ t.key | translate }}</button>
            }
          </div>
        </div>
      </section>

      <section class="card card-pad">
        <h2 class="mb-4 text-lg font-bold text-ink-900">{{ 'SET.ACCOUNT.PASSWORD' | translate }}</h2>
        <form class="space-y-4" (ngSubmit)="changePassword()">
          <label class="field"><span class="label">{{ 'SET.ACCOUNT.CURRENT' | translate }}</span>
            <input class="input" type="password" name="current" autocomplete="current-password" required [ngModel]="pw.value().current" (ngModelChange)="pw.set('current', $event)" /></label>
          <label class="field"><span class="label">{{ 'SET.ACCOUNT.NEW' | translate }}</span>
            <input class="input" type="password" name="next" autocomplete="new-password" required minlength="10" [ngModel]="pw.value().next" (ngModelChange)="pw.set('next', $event)" />
            <span class="hint">{{ 'SET.ACCOUNT.RULE' | translate }}</span></label>
          <label class="field"><span class="label">{{ 'SET.ACCOUNT.CONFIRM' | translate }}</span>
            <input class="input" type="password" name="confirm" autocomplete="new-password" required [ngModel]="pw.value().confirm" (ngModelChange)="pw.set('confirm', $event)" /></label>
          @if (problem(); as p) {
            @if (pw.value().next.length > 0) { <p class="error-text" role="alert">{{ 'SET.ACCOUNT.PROBLEM.' + p | translate }}</p> }
          }
          <button type="submit" class="btn btn-primary" [disabled]="problem() !== null || !pw.value().current || saving()">{{ 'SET.ACCOUNT.CHANGE' | translate }}</button>
        </form>
      </section>
    </div>

    <section class="card mt-6">
      <div class="card-head">
        <div>
          <h2 class="text-lg font-bold text-ink-900">{{ 'SET.ACCOUNT.SESSIONS' | translate }}</h2>
          <p class="text-sm text-ink-500">{{ 'SET.ACCOUNT.SESSIONS_HINT' | translate }}</p>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" [disabled]="sessions.data().length < 2" (click)="endOthers()">{{ 'SET.ACCOUNT.END_OTHERS' | translate }}</button>
      </div>
      <div class="table-wrap"><div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>{{ 'SET.ACCOUNT.DEVICE' | translate }}</th><th>IP</th><th>{{ 'SET.ACCOUNT.SIGNED_IN' | translate }}</th><th>{{ 'SET.ACCOUNT.LAST_SEEN' | translate }}</th><th></th></tr></thead>
          <tbody>
            @for (s of sessions.data(); track s.id) {
              <tr>
                <td class="font-semibold">{{ device(s) }} @if (s.current) { <span class="pill pill-active ms-1">{{ 'SET.ACCOUNT.THIS_DEVICE' | translate }}</span> }</td>
                <td class="mono">{{ s.ip || '—' }}</td>
                <td>{{ s.createdAt | date: 'short' }}</td>
                <td>{{ s.lastSeenAt | date: 'short' }}</td>
                <td class="cell-actions">
                  @if (!s.current) { <button type="button" class="btn btn-ghost btn-sm" (click)="end(s)">{{ 'SET.ACCOUNT.END' | translate }}</button> }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div></div>
    </section>
  `,
})
export class AccountComponent {
  private readonly auth = inject(AuthService);
  private readonly admin = inject(UserAdminService);
  private readonly errors = inject(ApiErrors);
  private readonly toast = inject(ToastService);
  protected readonly language = inject(LanguageService);
  protected readonly theme = inject(ThemeService);
  protected readonly permissions = inject(PermissionService);

  protected readonly user = this.auth.currentUser;
  protected readonly languages = [{ code: 'fr', label: 'Français' }, { code: 'en', label: 'English' }, { code: 'ar', label: 'العربية' }];
  protected readonly themes: { value: ThemePreference; key: string }[] = [
    { value: 'system', key: 'COMMON.THEME_SYSTEM' },
    { value: 'light', key: 'COMMON.THEME_LIGHT' },
    { value: 'dark', key: 'COMMON.THEME_DARK' },
  ];
  protected readonly sessions = loadable<SessionRow[]>([]);
  protected readonly pw = formState({ current: '', next: '', confirm: '' });
  protected readonly saving = signal(false);
  protected readonly problem = computed(() => passwordProblem(this.pw.value().current, this.pw.value().next, this.pw.value().confirm));

  constructor() {
    void this.sessions.load(() => this.admin.sessions());
  }

  protected device(s: SessionRow): string {
    return describeDevice(s.userAgent);
  }

  protected setLanguage(code: string): void {
    this.language.setLanguage(code);
    // Number and date formats are fixed at start-up (LOCALE_ID), so a reload makes them follow the language too.
    setTimeout(() => location.reload(), 150);
  }

  protected async changePassword(): Promise<void> {
    if (this.problem()) {
      return;
    }
    this.saving.set(true);
    try {
      await this.admin.changePassword(this.pw.value().current, this.pw.value().next);
      this.pw.reset({ current: '', next: '', confirm: '' });
      this.toast.success('✓');
      await this.sessions.load(() => this.admin.sessions());
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.saving.set(false);
    }
  }

  protected async end(s: SessionRow): Promise<void> {
    try {
      await this.admin.endSession(s.id);
      await this.sessions.load(() => this.admin.sessions());
    } catch (error) {
      this.errors.report(error);
    }
  }

  protected async endOthers(): Promise<void> {
    try {
      await this.admin.endOtherSessions();
      await this.sessions.load(() => this.admin.sessions());
    } catch (error) {
      this.errors.report(error);
    }
  }
}
