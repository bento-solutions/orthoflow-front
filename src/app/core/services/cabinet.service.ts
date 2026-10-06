import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { PracticeProfile, PracticeProfileService } from './practice-profile.service';

export interface CabinetInfo {
  name: string;
  logoUrl?: string; // an object URL from the server, or a data URL before the first sign-in
  role?: 'doctor' | 'assistant';
  ice?: string;
  vat?: string;
  patente?: string;
  address?: string;
  rib?: string;
  tel?: string;
}

const PLACEHOLDER_NAME = 'Cabinet';

/** True for a clinic profile nobody has filled in: the placeholder the server creates for a new practice. */
export function isUnconfigured(profile: PracticeProfile): boolean {
  return (profile.name || PLACEHOLDER_NAME) === PLACEHOLDER_NAME && !profile.ice && !profile.address && !profile.phone && !profile.logoFileId;
}

/**
 * The clinic's name and legal details as the rest of the app reads them.
 *
 * These used to live only in each browser's localStorage, so a document printed from
 * another PC lost its legal details. The server now holds them
 * ({@link PracticeProfileService}); this service stays as the shape the sidebar,
 * the consultation summary and the onboarding guard already use, and as the
 * pre-sign-in store for the onboarding wizard, which runs before an account (and
 * so before a server profile) exists.
 *
 * Migration, once per browser: when someone signs in and the server profile is still
 * the unconfigured placeholder while this browser holds clinic details, those are
 * pushed to the server (logo included) and the local copy is removed. After that the
 * server is the only source.
 */
@Injectable({ providedIn: 'root' })
export class CabinetService {
  private readonly STORAGE_KEY = 'orthoflow_cabinet_info';
  private readonly server = inject(PracticeProfileService);
  private migrating = false;

  readonly cabinetInfo = signal<CabinetInfo | null>(this.loadCabinetInfo());

  readonly isOnboarded = computed(() => {
    const info = this.cabinetInfo();
    return !!(info && info.name.trim().length > 0);
  });

  constructor() {
    effect(() => {
      const profile = this.server.profile();
      const logo = this.server.logoUrl();
      if (profile) {
        untracked(() => void this.adopt(profile, logo));
      }
    });
  }

  /** Before sign-in this is the only store; after it, the server is, and this keeps the local shape in step. */
  saveCabinetInfo(info: CabinetInfo): void {
    const profile = this.server.profile();
    if (profile) {
      void this.server.save({ ...profile, name: info.name, ice: info.ice, taxId: info.vat, patente: info.patente, address: info.address, rib: info.rib, phone: info.tel });
      return;
    }
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(info));
      this.cabinetInfo.set(info);
    } catch (e) {
      console.error('Failed to save cabinet info to localStorage', e);
    }
  }

  clearCabinetInfo(): void {
    try {
      localStorage.removeItem(this.STORAGE_KEY);
      this.cabinetInfo.set(null);
    } catch (e) {
      console.error('Failed to clear cabinet info', e);
    }
  }

  private async adopt(profile: PracticeProfile, logoUrl: string | null): Promise<void> {
    const local = this.loadCabinetInfo();
    if (local?.name?.trim() && isUnconfigured(profile) && !this.migrating) {
      this.migrating = true;
      try {
        await this.migrate(local, profile);
      } finally {
        this.migrating = false;
      }
      return;
    }
    this.cabinetInfo.set({
      name: profile.name,
      logoUrl: logoUrl ?? undefined,
      ice: profile.ice || undefined,
      vat: profile.taxId || undefined,
      patente: profile.patente || undefined,
      address: profile.address || undefined,
      rib: profile.rib || undefined,
      tel: profile.phone || undefined,
    });
  }

  private async migrate(local: CabinetInfo, profile: PracticeProfile): Promise<void> {
    try {
      await this.server.save({
        ...profile, name: local.name.trim(), ice: local.ice, taxId: local.vat, patente: local.patente, address: local.address, rib: local.rib, phone: local.tel,
      });
      if (local.logoUrl?.startsWith('data:image/png') || local.logoUrl?.startsWith('data:image/jpeg')) {
        const blob = await (await fetch(local.logoUrl)).blob();
        await this.server.uploadLogo(new File([blob], 'logo', { type: blob.type }));
      }
      localStorage.removeItem(this.STORAGE_KEY);
    } catch {
      // Not moved: keep the local copy and try again at the next sign-in. Nothing is lost.
      this.cabinetInfo.set(local);
    }
  }

  private loadCabinetInfo(): CabinetInfo | null {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch (e) {
      console.error('Failed to load cabinet info from localStorage', e);
      return null;
    }
  }
}
