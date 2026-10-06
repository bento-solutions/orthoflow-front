import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { TranslateService } from '@ngx-translate/core';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ApiErrors } from '../services/api-error.service';
import { ToastService } from '../services/toast.service';
import { loadable } from './loadable';

describe('loadable', () => {
  const toast = { error: vi.fn() };
  const translate = { instant: (key: string) => `[${key}]` };

  beforeEach(() => {
    toast.error.mockClear();
    TestBed.configureTestingModule({
      providers: [
        { provide: ToastService, useValue: toast },
        { provide: TranslateService, useValue: translate },
      ],
    });
  });

  const make = <T>(initial: T) => TestBed.runInInjectionContext(() => loadable(initial));

  it('holds the result and says when a request is out', async () => {
    const state = make<string[]>([]);
    let finish!: (v: string[]) => void;
    const pending = state.load(() => new Promise<string[]>(resolve => (finish = resolve)));
    expect(state.loading()).toBe(true);
    finish(['a']);
    await pending;
    expect(state.loading()).toBe(false);
    expect(state.data()).toEqual(['a']);
    expect(state.failed()).toBe(false);
  });

  it('keeps the previous data on screen when a reload fails, and says so once', async () => {
    const state = make<string[]>([]);
    await state.load(async () => ['kept']);
    const ok = await state.load(async () => {
      throw new HttpErrorResponse({ status: 0 });
    });
    expect(ok).toBe(false);
    expect(state.data()).toEqual(['kept']);
    expect(state.failed()).toBe(true);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith('[COMMON.ERROR_NETWORK]');
  });

  it('forgets an older answer that arrives after a newer request', async () => {
    const state = make<string>('');
    let first!: (v: string) => void;
    const slow = state.load(() => new Promise<string>(resolve => (first = resolve)));
    await state.load(async () => 'newer');
    first('older');
    await slow;
    expect(state.data()).toBe('newer');
    expect(state.loading()).toBe(false);
  });

  it('clears the failure flag after a good load', async () => {
    const state = make<number>(0);
    await state.load(async () => {
      throw new Error('x');
    });
    expect(state.failed()).toBe(true);
    await state.load(async () => 1);
    expect(state.failed()).toBe(false);
  });
});

describe('ApiErrors', () => {
  const translate = { instant: (key: string) => `[${key}]` };
  const errors = () => {
    TestBed.configureTestingModule({ providers: [{ provide: ToastService, useValue: { error: vi.fn() } }, { provide: TranslateService, useValue: translate }] });
    return TestBed.inject(ApiErrors);
  };

  it('shows the sentence the server wrote for a client error', () => {
    const e = new HttpErrorResponse({ status: 409, error: { detail: 'Only 166.00 remains to be paid on this statement' } });
    expect(errors().message(e)).toBe('Only 166.00 remains to be paid on this statement');
  });

  it('says it in the person\'s own words when the server cannot', () => {
    const api = errors();
    expect(api.message(new HttpErrorResponse({ status: 0 }))).toBe('[COMMON.ERROR_NETWORK]');
    expect(api.message(new HttpErrorResponse({ status: 403, error: { detail: 'You do not have permission to perform this action' } }))).toBe('[COMMON.ERROR_FORBIDDEN]');
    expect(api.message(new HttpErrorResponse({ status: 404 }))).toBe('[COMMON.ERROR_NOT_FOUND]');
    expect(api.message(new HttpErrorResponse({ status: 500, error: { detail: 'NullPointerException at ...' } }))).toBe('[COMMON.ERROR_GENERIC]');
    expect(api.message(new Error('boom'))).toBe('[COMMON.ERROR_GENERIC]');
  });

  it('lets a rate-limit message through, since it says when to try again', () => {
    expect(errors().message(new HttpErrorResponse({ status: 429, error: { detail: 'You have asked 20 questions in the last hour' } }))).toContain('20 questions');
  });
});
