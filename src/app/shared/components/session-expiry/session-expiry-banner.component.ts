import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';

/**
 * Says, on screen, that the session is about to end, and lets the person carry on (WCAG 2.2.1).
 *
 * A session lasts at most one clinic day and cannot be renewed past it. The warning at 30, 10 and
 * 5 minutes was only spoken, and only during a dictated examination: the front desk, or a doctor
 * outside a consultation, reached the end with no warning and lost what they were typing (audit A1).
 * Entering the password here signs in again in place, so nothing on the page is lost.
 *
 * Announced politely and never moves focus: the person may be in the middle of a sentence.
 */
@Component({
  selector: 'app-session-expiry-banner',
  standalone: true,
  imports: [FormsModule, TranslateModule],
  template: `
    @if (visible()) {
      <section class="banner" role="region" aria-labelledby="session-expiry-title">
        <div class="text">
          <h2 id="session-expiry-title" class="title">{{ 'AUTH.SESSION_ENDING_TITLE' | translate }}</h2>
          <p role="status" aria-live="polite">{{ 'AUTH.SESSION_ENDING_TEXT' | translate: { minutes: minutes() } }}</p>
        </div>
        <form class="form" (ngSubmit)="continue()">
          <label class="sr-only" for="session-expiry-password">{{ 'AUTH.PASSWORD_LABEL' | translate }}</label>
          <input id="session-expiry-password" class="input" type="password" name="password" autocomplete="current-password"
            [placeholder]="'AUTH.PASSWORD_LABEL' | translate" [(ngModel)]="password" [attr.aria-invalid]="failed() ? 'true' : null"
            [attr.aria-describedby]="failed() ? 'session-expiry-error' : null" />
          <button type="submit" class="btn btn-primary" [disabled]="busy() || !password">{{ 'AUTH.SESSION_CONTINUE' | translate }}</button>
          <button type="button" class="btn btn-ghost" (click)="dismiss()">{{ 'AUTH.SESSION_LATER' | translate }}</button>
          @if (failed()) {
            <p id="session-expiry-error" class="error" role="alert">{{ 'AUTH.LOGIN_FAILED' | translate }}</p>
          }
        </form>
      </section>
    }
  `,
  styles: [`
    .banner {
      position: fixed; inset-inline: var(--space-4, 1rem); top: var(--space-4, 1rem); z-index: 60;
      display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem 1.25rem;
      padding: 0.875rem 1rem; border-radius: 0.75rem;
      background: rgb(var(--surface, 255 255 255)); color: rgb(var(--ink-900, 17 24 39));
      border: 1px solid rgb(var(--caution-700, 180 83 9)); border-inline-start-width: 6px;
      box-shadow: 0 10px 30px rgb(0 0 0 / 0.18);
    }
    .text { flex: 1 1 18rem; min-width: 0; }
    .title { margin: 0 0 0.125rem; font-size: 0.95rem; font-weight: 700; }
    .text p { margin: 0; font-size: 0.9rem; }
    .form { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
    .form .input { min-width: 12rem; }
    .error { flex-basis: 100%; margin: 0; font-size: 0.85rem; color: rgb(var(--critical-700, 185 28 28)); }
  `],
})
export class SessionExpiryBannerComponent {
  private readonly auth = inject(AuthService);

  protected password = '';
  protected readonly busy = signal(false);
  protected readonly failed = signal(false);
  /** The warning the person put aside: the next, closer one shows again. */
  private readonly dismissedAt = signal<number | null>(null);

  protected readonly minutes = computed(() => this.auth.expiryWarning() ?? 0);
  protected readonly visible = computed(() => {
    const minutes = this.auth.expiryWarning();
    return minutes !== null && this.auth.isAuthenticated() && this.dismissedAt() !== minutes;
  });

  protected dismiss(): void {
    this.dismissedAt.set(this.auth.expiryWarning());
  }

  protected async continue(): Promise<void> {
    const email = this.auth.currentUser()?.email;
    if (!email || !this.password) return;
    this.busy.set(true);
    this.failed.set(false);
    try {
      await firstValueFrom(this.auth.login(email, this.password));
      this.password = '';
      this.dismissedAt.set(null);
    } catch {
      this.failed.set(true);
    } finally {
      this.busy.set(false);
    }
  }
}
