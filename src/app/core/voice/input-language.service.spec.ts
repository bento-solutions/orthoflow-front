import { beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { LanguageService } from '../services/language.service';
import { InputLanguageService } from './input-language.service';

describe('InputLanguageService', () => {
  const appLang = signal('fr');

  function create(): InputLanguageService {
    TestBed.configureTestingModule({
      providers: [{ provide: LanguageService, useValue: { currentLang: appLang } }],
    });
    return TestBed.inject(InputLanguageService);
  }

  beforeEach(() => {
    localStorage.clear();
    appLang.set('fr');
  });

  it('follows the application language until one is chosen', () => {
    const service = create();
    expect(service.language()).toBe('fr');
    expect(service.isPinned()).toBe(false);
    appLang.set('en');
    expect(service.language()).toBe('en');
    expect(service.locale()).toBe('en-US');
  });

  it('keeps a chosen language when the application language changes', () => {
    const service = create();
    service.set('ar');
    appLang.set('en');
    expect(service.language()).toBe('ar');
    expect(service.locale()).toBe('ar-MA');
    expect(service.isPinned()).toBe(true);
  });

  it('remembers the choice on this device and can return to the default', () => {
    create().set('en');
    TestBed.resetTestingModule();
    const again = create();
    expect(again.language()).toBe('en');
    again.set(null);
    expect(localStorage.getItem('orthoflow_voice_input_language')).toBeNull();
    expect(again.isPinned()).toBe(false);
  });

  it('ignores a stored value it does not know', () => {
    localStorage.setItem('orthoflow_voice_input_language', 'klingon');
    expect(create().isPinned()).toBe(false);
  });
});
