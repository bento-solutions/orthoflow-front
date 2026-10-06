import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { ToastService } from './toast.service';

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

  message(error: unknown): string {
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
    return this.translate.instant('COMMON.ERROR_GENERIC');
  }

  /** Shows the error as a toast and returns its text. */
  report(error: unknown): string {
    const text = this.message(error);
    this.toast.error(text);
    return text;
  }
}
