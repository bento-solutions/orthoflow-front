import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CabinetService, isUnconfigured } from './cabinet.service';
import { PracticeProfile, PracticeProfileService } from './practice-profile.service';

const PLACEHOLDER = { name: 'Cabinet', currency: 'MAD' } as PracticeProfile;
const CONFIGURED = { name: 'Cabinet Dr Tazi', ice: '001234', taxId: 'IF77', address: '12 rue X', phone: '0522', currency: 'MAD' } as PracticeProfile;

describe('CabinetService', () => {
  const profile = signal<PracticeProfile | null>(null);
  const logoUrl = signal<string | null>(null);
  const save = vi.fn();
  const uploadLogo = vi.fn();

  const create = () => {
    TestBed.configureTestingModule({ providers: [{ provide: PracticeProfileService, useValue: { profile, logoUrl, save, uploadLogo } }] });
    const service = TestBed.inject(CabinetService);
    TestBed.tick();
    return service;
  };

  beforeEach(() => {
    localStorage.clear();
    profile.set(null);
    logoUrl.set(null);
    save.mockReset().mockResolvedValue(undefined);
    uploadLogo.mockReset().mockResolvedValue(undefined);
  });

  it('knows an unfilled clinic profile from a real one', () => {
    expect(isUnconfigured(PLACEHOLDER)).toBe(true);
    expect(isUnconfigured(CONFIGURED)).toBe(false);
    expect(isUnconfigured({ name: 'Cabinet', logoFileId: 'f1' } as PracticeProfile)).toBe(false);
  });

  it('keeps the onboarding wizard working before there is any account', () => {
    const service = create();
    expect(service.isOnboarded()).toBe(false);
    service.saveCabinetInfo({ name: 'Cabinet Dr Tazi', ice: '001' });
    expect(service.isOnboarded()).toBe(true);
    expect(save).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('orthoflow_cabinet_info')!).name).toBe('Cabinet Dr Tazi');
  });

  it('reads the server profile once someone is signed in', () => {
    const service = create();
    profile.set(CONFIGURED);
    TestBed.tick();
    expect(service.cabinetInfo()).toMatchObject({ name: 'Cabinet Dr Tazi', ice: '001234', vat: 'IF77', tel: '0522' });
  });

  it('pushes this browser\'s clinic details to a server that has none, then forgets them locally', async () => {
    localStorage.setItem('orthoflow_cabinet_info', JSON.stringify({ name: 'Cabinet Local', ice: '999', vat: 'IF1', tel: '0600' }));
    const service = create();
    expect(service.cabinetInfo()?.name).toBe('Cabinet Local');

    profile.set(PLACEHOLDER);
    TestBed.tick();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toMatchObject({ name: 'Cabinet Local', ice: '999', taxId: 'IF1', phone: '0600' });
    await vi.waitFor(() => expect(localStorage.getItem('orthoflow_cabinet_info')).toBeNull());
    expect(uploadLogo).not.toHaveBeenCalled();
  });

  it('does not overwrite details the server already has with an older local copy', () => {
    localStorage.setItem('orthoflow_cabinet_info', JSON.stringify({ name: 'Stale Local Name' }));
    const service = create();
    profile.set(CONFIGURED);
    TestBed.tick();
    expect(save).not.toHaveBeenCalled();
    expect(service.cabinetInfo()?.name).toBe('Cabinet Dr Tazi');
  });

  it('keeps the local copy when the migration cannot be completed', async () => {
    save.mockRejectedValue(new Error('offline'));
    localStorage.setItem('orthoflow_cabinet_info', JSON.stringify({ name: 'Cabinet Local' }));
    const service = create();
    profile.set(PLACEHOLDER);
    TestBed.tick();
    await vi.waitFor(() => expect(save).toHaveBeenCalled());
    await Promise.resolve();
    expect(localStorage.getItem('orthoflow_cabinet_info')).not.toBeNull();
    expect(service.cabinetInfo()?.name).toBe('Cabinet Local');
  });
});
