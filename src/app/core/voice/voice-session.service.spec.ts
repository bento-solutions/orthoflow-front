import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionBufferService } from './session-buffer.service';
import { VoiceApiService, VoiceSessionDto } from './voice-api.service';
import { VoiceContextService } from './voice-context.service';
import { VoiceOrchestratorService } from './voice-orchestrator.service';
import { SESSION_TIMEOUT_MS, SESSION_WARNING_LEAD_MS, VoiceSessionService } from './voice-session.service';

/**
 * An examination that goes quiet. A long procedure is mostly silence, and
 * closing the microphone under a dentist who cannot look at the screen —
 * without a word — loses whatever they say next.
 */

const MINUTE = 60_000;

const session = (status: VoiceSessionDto['status']): VoiceSessionDto => ({
  id: 's-1', patientId: 'p-1', actorId: 'u-1', status, locale: 'fr-MA',
  summary: null, startedAt: '', endedAt: null, confirmedAt: null,
});

describe('VoiceSessionService — inactivity', () => {
  let service: VoiceSessionService;
  let calls: string[];
  let notices: string[];
  let completeFails: boolean;

  beforeEach(async () => {
    vi.useFakeTimers();
    calls = [];
    notices = [];
    completeFails = false;

    TestBed.configureTestingModule({
      providers: [
        {
          provide: VoiceApiService,
          useValue: {
            startSession: () => of(session('ACTIVE')),
            completeSession: (_id: string, body: { status: VoiceSessionDto['status'] }) => {
              calls.push(`complete ${body.status}`);
              return completeFails ? throwError(() => ({ status: 0 })) : of(session(body.status));
            },
            summarizeSession: () => of({ summary: 'Compte rendu.', provider: 'p', model: 'm', commandCount: 1, truncated: false, error: null }),
          },
        },
        {
          provide: VoiceContextService,
          useValue: {
            snapshot: () => ({ patientId: 'p-1', patientName: 'Ahmed', locale: 'fr-MA' }),
            setSessionId: () => undefined,
            clearConversation: () => undefined,
          },
        },
        { provide: SessionBufferService, useValue: { begin: async () => undefined, clear: async () => undefined } },
        {
          provide: VoiceOrchestratorService,
          useValue: {
            resetBuffer: () => undefined,
            stopListening: () => calls.push('stop'),
            finishListening: async () => { calls.push('finish'); },
            notify: (key: string) => notices.push(key),
          },
        },
      ],
    });
    service = TestBed.inject(VoiceSessionService);
    await service.start();
  });

  afterEach(() => vi.useRealTimers());

  it('warns five minutes before it closes, once', async () => {
    await vi.advanceTimersByTimeAsync(SESSION_TIMEOUT_MS - SESSION_WARNING_LEAD_MS - MINUTE);
    expect(notices).toEqual([]);

    await vi.advanceTimersByTimeAsync(MINUTE + 1);
    expect(notices).toEqual(['idleWarning']);
    expect(service.isActive()).toBe(true);
  });

  it('closes the examination into review, and says it has', async () => {
    await vi.advanceTimersByTimeAsync(SESSION_TIMEOUT_MS + 1);

    expect(calls).toContain('complete PENDING_REVIEW');
    expect(notices).toEqual(['idleWarning', 'idleEnded']);
    expect(service.reviewing()).toBe(true);
  });

  it('is put back by anything the dentist says, warning and all', async () => {
    await vi.advanceTimersByTimeAsync(SESSION_TIMEOUT_MS - SESSION_WARNING_LEAD_MS - MINUTE);
    service.touchSession();

    // The old deadline passes without either notice.
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    expect(notices).toEqual([]);
    expect(service.isActive()).toBe(true);

    // The new one is a whole timeout away.
    await vi.advanceTimersByTimeAsync(SESSION_TIMEOUT_MS);
    expect(notices).toEqual(['idleWarning', 'idleEnded']);
  });

  it('does not claim to have closed when it could not reach the server', async () => {
    completeFails = true;

    await vi.advanceTimersByTimeAsync(SESSION_TIMEOUT_MS + 1);

    expect(notices).toEqual(['idleWarning']);
    expect(service.isActive()).toBe(true);
  });

  it('sets no alarm for an examination the dentist has already ended', async () => {
    await service.end();
    notices.length = 0;

    await vi.advanceTimersByTimeAsync(SESSION_TIMEOUT_MS * 2);

    expect(notices).toEqual([]);
  });
});

describe('VoiceSessionService — ending', () => {
  let service: VoiceSessionService;
  let calls: string[];

  beforeEach(async () => {
    calls = [];
    TestBed.configureTestingModule({
      providers: [
        {
          provide: VoiceApiService,
          useValue: {
            startSession: () => of(session('ACTIVE')),
            completeSession: (_id: string, body: { status: VoiceSessionDto['status'] }) => {
              calls.push(`complete ${body.status}`);
              return of(session(body.status));
            },
            summarizeSession: () => of({ summary: 'x', provider: 'p', model: 'm', commandCount: 1, truncated: false, error: null }),
          },
        },
        {
          provide: VoiceContextService,
          useValue: {
            snapshot: () => ({ patientId: 'p-1', patientName: 'Ahmed', locale: 'fr-MA' }),
            setSessionId: () => undefined,
            clearConversation: () => undefined,
          },
        },
        { provide: SessionBufferService, useValue: { begin: async () => undefined, clear: async () => undefined } },
        {
          provide: VoiceOrchestratorService,
          useValue: {
            resetBuffer: () => undefined,
            stopListening: () => calls.push('stop'),
            finishListening: async () => { calls.push('finish'); },
            notify: () => undefined,
          },
        },
      ],
    });
    service = TestBed.inject(VoiceSessionService);
    await service.start();
  });

  it('waits for the last sentences before it moves the examination into review', async () => {
    await service.end();

    // Closing the session first is what used to drop them.
    expect(calls.slice(0, 2)).toEqual(['finish', 'complete PENDING_REVIEW']);
  });

  it('does not wait when it was the dentist\'s voice that ended it', async () => {
    await service.end({ waitForClips: false });

    expect(calls.slice(0, 2)).toEqual(['stop', 'complete PENDING_REVIEW']);
    expect(calls).not.toContain('finish');
  });
});

/**
 * A recorded consultation adopts a session the server created and takes over
 * the way out of it. These pin the seams it relies on.
 */
describe('VoiceSessionService — held by a consultation', () => {
  let service: VoiceSessionService;
  let calls: string[];
  let started: number;

  beforeEach(() => {
    vi.useFakeTimers();
    calls = [];
    started = 0;
    TestBed.configureTestingModule({
      providers: [
        {
          provide: VoiceApiService,
          useValue: {
            startSession: () => { started++; return of(session('ACTIVE')); },
            completeSession: (_id: string, body: { status: VoiceSessionDto['status'] }) => {
              calls.push(`complete ${body.status}`);
              return of(session(body.status));
            },
            summarizeSession: () => of({ summary: 'Compte rendu.', provider: 'p', model: 'm', commandCount: 1, truncated: false, error: null }),
          },
        },
        {
          provide: VoiceContextService,
          useValue: {
            snapshot: () => ({ patientId: 'p-1', patientName: 'Ahmed', locale: 'fr-MA' }),
            setSessionId: (id: string | null) => calls.push(`context ${id}`),
            clearConversation: () => undefined,
          },
        },
        { provide: SessionBufferService, useValue: { begin: async () => { calls.push('buffer.begin'); }, clear: async () => { calls.push('buffer.clear'); } } },
        {
          provide: VoiceOrchestratorService,
          useValue: {
            resetBuffer: () => undefined,
            stopListening: () => calls.push('stop'),
            finishListening: async () => { calls.push('finish'); },
            notify: () => undefined,
          },
        },
      ],
    });
    service = TestBed.inject(VoiceSessionService);
  });

  afterEach(() => vi.useRealTimers());

  it('does not open a second session under one that is running', async () => {
    const first = await service.start();
    const second = await service.start();

    expect(started).toBe(1);
    expect(second).toBe(first);
  });

  it('takes over a session the server already created, set up as a started one is', async () => {
    await service.adopt(session('ACTIVE'));

    expect(service.isActive()).toBe(true);
    expect(started).toBe(0);
    expect(calls).toContain('buffer.begin');
    expect(calls).toContain('context s-1');
    expect(service.startedAt()).not.toBeNull();
  });

  it('hands every ordinary end to the consultation while it holds the session', async () => {
    const routed: Array<{ waitForClips?: boolean }> = [];
    await service.adopt(session('ACTIVE'));
    service.setRouting({ end: async options => { routed.push(options); }, abandon: async () => undefined });

    await service.end({ waitForClips: false });

    expect(routed).toEqual([{ waitForClips: false }]);
    // the session itself was not ended by that call
    expect(calls).not.toContain('complete PENDING_REVIEW');
    expect(service.isActive()).toBe(true);
  });

  it('lets the consultation end it for real when it says so', async () => {
    await service.adopt(session('ACTIVE'));
    service.setRouting({ end: async () => undefined, abandon: async () => undefined });

    await service.end({ direct: true });

    expect(calls).toContain('complete PENDING_REVIEW');
    expect(service.reviewing()).toBe(true);
  });

  it('routes a discard the same way, and does it for real when asked', async () => {
    let routed = 0;
    await service.adopt(session('ACTIVE'));
    service.setRouting({ end: async () => undefined, abandon: async () => { routed++; } });

    await service.abandon();
    expect(routed).toBe(1);
    expect(calls).not.toContain('complete ABANDONED');

    await service.abandon({ direct: true });
    expect(calls).toContain('complete ABANDONED');
    expect(service.session()).toBeNull();
  });

  it('ends as it always did once the consultation lets go', async () => {
    await service.adopt(session('ACTIVE'));
    service.setRouting({ end: async () => undefined, abandon: async () => undefined });
    service.setRouting(null);

    await service.end();

    expect(calls).toContain('complete PENDING_REVIEW');
  });

  it('clears what it holds when the consultation saved the session elsewhere', async () => {
    await service.adopt(session('PENDING_REVIEW'));
    calls.length = 0;

    await service.finishExternally();

    expect(calls).toEqual(['buffer.clear', 'context null']);
    expect(service.session()?.status).toBe('COMPLETED');
    expect(service.startedAt()).toBeNull();
    expect(service.isActive()).toBe(false);
    expect(service.reviewing()).toBe(false);
  });
});
