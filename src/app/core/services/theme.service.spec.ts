import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';
import { ThemeService } from './theme.service';
import { UserPreferencesService } from './user-preferences.service';

describe('ThemeService', () => {
  const token = signal<string | null>(null);
  let patch: ReturnType<typeof vi.fn>;
  let serverPrefs: Record<string, unknown>;

  const create = () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { token } },
        { provide: UserPreferencesService, useValue: { get: async () => serverPrefs, patch, clear: () => undefined } },
      ],
    });
    const service = TestBed.inject(ThemeService);
    TestBed.tick();
    return service;
  };

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.classList.remove('dark');
    token.set(null);
    serverPrefs = {};
    patch = vi.fn(async () => ({}));
  });

  it('follows the system until someone chooses', () => {
    const service = create();
    expect(service.preference()).toBe('system');
    expect(['light', 'dark']).toContain(document.documentElement.getAttribute('data-theme'));
  });

  it('applies an explicit choice to the document and remembers it for the next load', () => {
    const service = create();
    service.set('dark');
    TestBed.tick();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('orthoflow_theme')).toBe('dark');

    service.set('light');
    TestBed.tick();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('toggles between light and dark, leaving "system" on the first press', () => {
    const service = create();
    service.set('light');
    service.toggle();
    expect(service.preference()).toBe('dark');
    service.toggle();
    expect(service.preference()).toBe('light');
  });

  it('saves the choice on the server only for someone signed in', () => {
    const service = create();
    service.set('dark');
    expect(patch).not.toHaveBeenCalled();

    token.set('jwt');
    TestBed.tick();
    service.set('light');
    expect(patch).toHaveBeenCalledWith({ theme: 'light' });
  });

  it('adopts the choice the person made on another device when they sign in', async () => {
    serverPrefs = { theme: 'dark' };
    const service = create();
    expect(service.preference()).toBe('system');

    token.set('jwt');
    TestBed.tick();
    await vi.waitFor(() => expect(service.preference()).toBe('dark'));
    expect(localStorage.getItem('orthoflow_theme')).toBe('dark');
  });

  it('ignores a nonsense value from the server', async () => {
    serverPrefs = { theme: 'sepia' };
    const service = create();
    token.set('jwt');
    TestBed.tick();
    await Promise.resolve();
    expect(service.preference()).toBe('system');
  });
});
