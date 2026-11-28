import { Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { PublicConfigService } from '../../../core/services/public-config.service';
import { IconComponent } from '../../ui/icon.component';

/**
 * Prominent emergency bypass button rendered on every public patient page.
 * Sticky full-width on mobile so a patient in acute pain never has to scroll
 * through booking slots; opens a two-action panel (Call / WhatsApp URGENT).
 */
@Component({
  selector: 'app-emergency-button',
  standalone: true,
  imports: [TranslateModule, IconComponent],
  template: `
    <div class="pointer-events-none fixed inset-x-0 bottom-0 z-40 p-3 sm:inset-x-auto sm:bottom-5 sm:end-5 sm:p-0">
      <button
        type="button"
        data-testid="emergency-trigger"
        (click)="openPanel()"
        class="pointer-events-auto flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-3 text-sm font-bold text-white shadow-lg ring-2 ring-red-700/20 transition hover:bg-red-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-300 sm:w-auto sm:rounded-full sm:px-5 sm:py-3"
      >
        <app-icon name="alert" [size]="18" />
        <span>{{ 'PUB.EMERGENCY.CTA' | translate }}</span>
      </button>
    </div>

    @if (open()) {
      <div
        class="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
        (click)="closePanel()"
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="emergency-dialog-title"
          class="w-full max-w-md rounded-t-2xl bg-surface p-5 shadow-2xl sm:rounded-2xl sm:p-6"
          (click)="$event.stopPropagation()"
        >
          <div class="flex items-start justify-between gap-3">
            <div class="flex items-center gap-2.5 text-red-700">
              <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-100">
                <app-icon name="alert" [size]="20" />
              </span>
              <h2 id="emergency-dialog-title" class="text-lg font-bold text-ink-900">
                {{ 'PUB.EMERGENCY.TITLE' | translate }}
              </h2>
            </div>
            <button
              type="button"
              data-testid="emergency-close"
              (click)="closePanel()"
              class="rounded-md p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-800"
              [attr.aria-label]="'PUB.EMERGENCY.CLOSE' | translate"
            >
              <app-icon name="x" [size]="18" />
            </button>
          </div>

          <p class="mt-3 text-sm leading-relaxed text-ink-700">
            {{ 'PUB.EMERGENCY.SUBTITLE' | translate }}
          </p>

          @if (telHref() || waHref()) {
            <div class="mt-5 flex flex-col gap-3">
              @if (telHref(); as tel) {
                <!-- Primary action on mobile (order-1 sm:order-2); on desktop WhatsApp or Call are both effortless. -->
                <a
                  data-testid="emergency-call"
                  [href]="tel"
                  class="order-1 flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-3 text-sm font-bold text-white no-underline shadow-sm hover:bg-red-700 sm:order-1"
                >
                  <app-icon name="phone" [size]="18" />
                  <span>{{ 'PUB.EMERGENCY.CALL' | translate }}</span>
                  <span class="ltr-data text-xs font-semibold opacity-90">({{ phone() }})</span>
                </a>
              }
              @if (waHref(); as wa) {
                <a
                  data-testid="emergency-whatsapp"
                  [href]="wa"
                  target="_blank"
                  rel="noopener"
                  class="order-2 flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-600 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 no-underline hover:bg-emerald-100 sm:order-2"
                >
                  <app-icon name="message" [size]="18" />
                  <span>{{ 'PUB.EMERGENCY.WHATSAPP' | translate }}</span>
                </a>
              }
            </div>
          } @else {
            <p class="mt-4 rounded-lg bg-ink-50 px-3 py-2 text-sm text-ink-700">
              {{ 'PUB.EMERGENCY.UNAVAILABLE' | translate }}
            </p>
          }

          <button
            type="button"
            (click)="closePanel()"
            class="mt-4 w-full rounded-lg border border-ink-200 px-4 py-2 text-sm font-semibold text-ink-700 hover:bg-ink-50"
          >
            {{ 'PUB.EMERGENCY.CLOSE' | translate }}
          </button>
        </div>
      </div>
    }
  `,
})
export class EmergencyButtonComponent implements OnInit {
  private readonly publicConfig = inject(PublicConfigService);
  private readonly translate = inject(TranslateService);

  protected readonly open = signal(false);
  protected readonly phone = this.publicConfig.baileysPhone;
  protected readonly telHref = this.publicConfig.telHref;
  protected readonly waHref = computed(() =>
    this.publicConfig.whatsappEmergencyHref(this.translate.instant('PUB.EMERGENCY.PREFILL')),
  );

  ngOnInit(): void {
    void this.publicConfig.ensureLoaded();
  }

  protected openPanel(): void {
    void this.publicConfig.ensureLoaded();
    this.open.set(true);
  }

  protected closePanel(): void {
    this.open.set(false);
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.open()) {
      this.closePanel();
    }
  }
}
