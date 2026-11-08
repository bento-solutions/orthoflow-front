import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnnouncerService } from './announcer.service';

describe('AnnouncerService', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('clears before speaking, so the same words said twice are heard twice', () => {
    const announcer = TestBed.inject(AnnouncerService);
    announcer.announce('Saved');
    vi.runAllTimers();
    expect(announcer.polite()).toBe('Saved');

    announcer.announce('Saved');
    expect(announcer.polite()).toBe('');
    vi.runAllTimers();
    expect(announcer.polite()).toBe('Saved');
  });

  it('interrupts only when asked to', () => {
    const announcer = TestBed.inject(AnnouncerService);
    announcer.announce('Could not save', 'assertive');
    vi.runAllTimers();
    expect(announcer.assertive()).toBe('Could not save');
    expect(announcer.polite()).toBe('');
  });
});
