import { inject } from '@angular/core';
import { HttpInterceptorFn } from '@angular/common/http';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

/**
 * The public forms (online booking, self-registration, satisfaction) are for people with no
 * account: their only authority is the token in the link. A signed-in member of staff opening such
 * a link, to try it, must not send their session along or be signed out by an answer.
 */
export const isPublicRequest = (url: string): boolean => url.includes('/api/v1/public/');

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  const token = isPublicRequest(req.url) ? null : authService.token();
  const authedReq = token
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;

  return next(authedReq).pipe(
    catchError(err => {
      // 401 = the session is gone (no token, expired, or revoked server-side
      // — the backend now returns a real 401 for all three, audit H1/H2).
      // Clear it and bounce to /login. A 403 is "logged in, wrong role" and
      // must NOT log the user out. Never react to a failure on /auth/* — a
      // bad login is a 401 that the login page handles itself.
      const isAuthEndpoint = req.url.includes('/auth/');
      if (err.status === 401 && !isAuthEndpoint && !isPublicRequest(req.url)) {
        authService.logout('expired');
        router.navigate(['/login']);
      }
      // Every backend response carries X-Correlation-Id (CorrelationIdFilter);
      // logging it on every failed request means a support report can be
      // grepped straight to the matching backend log line (audit VII.5/P3#41).
      const correlationId = err.headers?.get?.('X-Correlation-Id');
      if (correlationId) {
        console.error(`[${req.method} ${req.url}] failed — correlation id: ${correlationId}`, err);
      }
      return throwError(() => err);
    })
  );
};
