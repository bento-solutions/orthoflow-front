import { Component } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-auth-layout',
  standalone: true,
  imports: [TranslateModule],
  template: `
    <main class="min-h-screen bg-[rgb(var(--ink-50))]">
      <div class="grid min-h-screen lg:grid-cols-2">
        <!-- Form Side -->
        <section class="flex items-center justify-center px-8 py-12">
          <div class="w-full max-w-md">
            <ng-content></ng-content>
          </div>
        </section>

        <!-- Visual Side -->
        <aside
          class="relative hidden overflow-hidden lg:flex items-end bg-cover bg-center p-12"
          style="background-image: url('/banner.jpeg');"
        >
          <div class="absolute inset-0 bg-gradient-to-t from-petrol-900/90 via-petrol-900/40 to-petrol-900/10"></div>

          <div class="relative z-10 w-full max-w-lg">
            <h2 class="text-3xl font-bold text-white tracking-tight">{{ 'AUTH.VISUAL_TITLE' | translate }}</h2>
            <p class="mt-4 text-white/80 leading-relaxed text-lg">
              {{ 'AUTH.VISUAL_SUBTITLE' | translate }}
            </p>
          </div>
        </aside>
      </div>
    </main>
  `,
})
export class AuthLayoutComponent {}
