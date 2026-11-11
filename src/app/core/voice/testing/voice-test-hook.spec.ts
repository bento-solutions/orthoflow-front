import { Injector } from '@angular/core';
import { afterEach, describe, expect, it } from 'vitest';
import { installVoiceTestHook } from './voice-test-hook';

/**
 * The hook drives the pipeline as if someone had spoken. That is a development
 * tool; a production build must not carry it.
 */
describe('the development voice hook', () => {
  const injector = Injector.create({ providers: [] });
  afterEach(() => { delete window.orthoflowVoiceTest; });

  it('is not installed in a production build', () => {
    window.orthoflowVoiceTest = {} as never;
    expect(installVoiceTestHook(injector, { production: true, devMode: true })).toBe(false);
    expect(window.orthoflowVoiceTest).toBeUndefined();
  });

  it('is not installed outside development mode', () => {
    expect(installVoiceTestHook(injector, { production: false, devMode: false })).toBe(false);
    expect(window.orthoflowVoiceTest).toBeUndefined();
  });

  it('is installed in a development build', () => {
    expect(installVoiceTestHook(injector, { production: false, devMode: true })).toBe(true);
    expect(typeof window.orthoflowVoiceTest?.hear).toBe('function');
  });
});
