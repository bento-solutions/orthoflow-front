import { ApplicationConfig, Injector, LOCALE_ID, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { TitleStrategy, provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideTranslateService } from '@ngx-translate/core';
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';
import { registerLocaleData } from '@angular/common';
import localeFr from '@angular/common/locales/fr';
import localeAr from '@angular/common/locales/ar';

import { routes } from './app.routes';
import { authInterceptor } from './core/interceptors/auth.interceptor';
import { TranslatedTitleStrategy } from './core/services/page-title.strategy';
import { installVoiceTestHook } from './core/voice/testing/voice-test-hook';
import { environment } from '../environments/environment';

registerLocaleData(localeFr);
registerLocaleData(localeAr);

// LOCALE_ID drives DatePipe/DecimalPipe/CurrencyPipe formatting (thousands
// separators, date order, etc.) and previously stayed at Angular's default
// en-US regardless of the language the user picked — French and Arabic
// users saw "1,500.00" instead of "1 500,00" (audit XI.3). Read the
// persisted choice at bootstrap since LOCALE_ID is a one-time DI token;
// switching language at runtime still requires a reload to reformat pipes,
// same limitation the app already has for direction (dir/RTL) on first paint.
function resolveLocaleId(): string {
  const saved = localStorage.getItem('orthoflow_lang');
  return saved === 'ar' || saved === 'en' ? saved : 'fr';
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Development builds only: drives the voice pipeline without a microphone.
    // The condition is a build-time constant, so a production bundle drops it.
    ...(environment.production ? [] : [provideAppInitializer(() => { installVoiceTestHook(inject(Injector)); })]),
    provideRouter(routes),
    { provide: TitleStrategy, useClass: TranslatedTitleStrategy },
    provideHttpClient(withInterceptors([authInterceptor])),
    { provide: LOCALE_ID, useValue: resolveLocaleId() },
    provideTranslateService({
      defaultLanguage: 'fr'
    }),
    ...provideTranslateHttpLoader({
      prefix: './i18n/',
      suffix: '.json'
    })
  ]
};
