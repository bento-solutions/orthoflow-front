import { Injectable, computed, inject, signal } from '@angular/core';
import { IntakeApi, PublicConfig } from './intake-api.service';

/**
 * Shared public booking & clinic contact settings loaded from `/public/booking/config`.
 * Used across all public pages for the emergency contact panel without duplicating requests
 * or hardcoding the Baileys WhatsApp/phone number client-side.
 */
@Injectable({ providedIn: 'root' })
export class PublicConfigService {
  private readonly intake = inject(IntakeApi);

  readonly config = signal<PublicConfig | null>(null);
  private inFlight: Promise<PublicConfig | null> | null = null;

  readonly clinicName = computed(() => this.config()?.clinicName ?? '');
  readonly baileysPhone = computed(() => (this.config()?.baileysPhone ?? '').trim());
  readonly emergencyMarker = computed(() => (this.config()?.emergencyMarker ?? 'URGENT').trim() || 'URGENT');

  readonly telHref = computed(() => {
    const phone = this.baileysPhone();
    if (!phone) return null;
    const clean = phone.replace(/[^+\d]/g, '');
    return clean ? `tel:${clean}` : null;
  });

  ensureLoaded(): Promise<PublicConfig | null> {
    if (this.config()) {
      return Promise.resolve(this.config());
    }
    if (typeof this.intake?.publicConfig !== 'function') {
      return Promise.resolve(null);
    }
    if (!this.inFlight) {
      this.inFlight = this.intake.publicConfig()
        .then((cfg) => {
          this.config.set(cfg);
          return cfg;
        })
        .catch(() => null)
        .finally(() => {
          this.inFlight = null;
        });
    }
    return this.inFlight;
  }

  whatsappEmergencyHref(prefilledText: string): string | null {
    const digits = this.baileysPhone().replace(/\D/g, '');
    if (!digits) return null;
    const marker = this.emergencyMarker();
    const text = prefilledText.toUpperCase().startsWith(marker.toUpperCase())
      ? prefilledText
      : `${marker} - ${prefilledText}`;
    return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
  }
}
