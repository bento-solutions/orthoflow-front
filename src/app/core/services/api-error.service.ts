import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { ToastAction, ToastService } from './toast.service';
import { PROFILE_INCOMPLETE, PROFILE_LINK, profileFieldLabels } from '../utils/profile-fields';

/**
 * Turns whatever a failed request threw into one sentence a person can act on.
 *
 * The backend answers with RFC 7807 problem documents whose `detail` already says
 * what went wrong in plain words ("Only 166.00 remains to be paid on this
 * statement"); those are shown as they are. They are in English, which is the one
 * place the interface is not translated. What the server cannot say (no answer at
 * all, a refusal, a 500) is said here, in the person's language.
 */
@Injectable({ providedIn: 'root' })
export class ApiErrors {
  private readonly translate = inject(TranslateService);
  private readonly toast = inject(ToastService);

  message(error: unknown, fallbackKey = 'COMMON.ERROR_GENERIC'): string {
    const missing = this.missingProfileFields(error);
    if (missing) {
      return this.translate.instant('COMMON.ERROR_PROFILE_INCOMPLETE', { fields: profileFieldLabels(missing, this.translate) });
    }
    if (error instanceof HttpErrorResponse) {
      if (error.status === 0) {
        return this.translate.instant('COMMON.ERROR_NETWORK');
      }
      // The server's 403 text is generic English; the translated one says the same thing in the person's language.
      if (error.status === 403) {
        return this.translate.instant('COMMON.ERROR_FORBIDDEN');
      }
      const detail = (error.error as { detail?: unknown } | null)?.detail;
      if (typeof detail === 'string' && detail.trim() !== '' && error.status < 500) {
        return detail;
      }
      if (error.status === 404) {
        return this.translate.instant('COMMON.ERROR_NOT_FOUND');
      }
      if (error.status === 429) {
        return typeof detail === 'string' ? detail : this.translate.instant('COMMON.ERROR_TOO_MANY');
      }
    }
    return this.translate.instant(fallbackKey);
  }

  /**
   * Shows the error as a toast and returns its text. {@code fallbackKey} says what failed when the
   * server could not ("The export failed."). A document refused for an incomplete clinic profile
   * gets a link to the profile.
   */
  report(error: unknown, fallbackKey?: string): string {
    const text = this.message(error, fallbackKey);
    if (this.missingProfileFields(error)) {
      const action: ToastAction = { label: this.translate.instant('COMMON.OPEN_CLINIC_PROFILE'), link: PROFILE_LINK };
      this.toast.error(text, 0, action);
    } else {
      this.toast.error(text);
    }
    return text;
  }

  /** The profile fields the server named when it refused a document, or null for any other error. */
  private missingProfileFields(error: unknown): string[] | null {
    if (!(error instanceof HttpErrorResponse)) {
      return null;
    }
    const body = error.error as { code?: unknown; missing?: unknown } | null;
    if (body?.code !== PROFILE_INCOMPLETE || !Array.isArray(body.missing)) {
      return null;
    }
    return body.missing.filter((f): f is string => typeof f === 'string');
  }
}
