import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';
import { LiveChange, LiveEventsService } from './live-events.service';

/** A fetch that answers with a stream the test can push chunks into and end. */
function fakeStream() {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start: c => (controller = c) });
  return {
    response: () => new Response(body, { status: 200 }),
    push: (text: string) => controller.enqueue(encoder.encode(text)),
    end: () => controller.close(),
  };
}

describe('LiveEventsService', () => {
  const token = signal<string | null>(null);
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    token.set(null);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    TestBed.configureTestingModule({ providers: [{ provide: AuthService, useValue: { token } }] });
  });

  afterEach(() => {
    token.set(null);
    TestBed.tick();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('opens nothing until someone is signed in', () => {
    TestBed.inject(LiveEventsService);
    TestBed.tick();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('streams with the bearer token and delivers changes, but not its own handshake', async () => {
    const stream = fakeStream();
    fetchMock.mockResolvedValue(stream.response());
    const service = TestBed.inject(LiveEventsService);
    const seen: LiveChange[] = [];
    service.changes$.subscribe(c => seen.push(c));

    token.set('jwt');
    TestBed.tick();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/v1/events');
    expect(init.headers.Authorization).toBe('Bearer jwt');

    stream.push('event:ready\ndata:ok\n\n');
    await vi.waitFor(() => expect(service.connected()).toBe(true));
    stream.push(': keep-alive\n\nevent:change\ndata:{"type":"finance","id":"x1"}\n\n');
    await vi.waitFor(() => expect(seen).toEqual([{ type: 'finance', id: 'x1' }]));
  });

  it('lets a screen listen for only the types it shows', async () => {
    const stream = fakeStream();
    fetchMock.mockResolvedValue(stream.response());
    const service = TestBed.inject(LiveEventsService);
    const seen: string[] = [];
    service.of('appointment').subscribe(c => seen.push(c.type));

    token.set('jwt');
    TestBed.tick();
    stream.push('event:change\ndata:{"type":"finance","id":null}\n\nevent:change\ndata:{"type":"appointment","id":"a"}\n\n');
    await vi.waitFor(() => expect(seen).toEqual(['appointment']));
  });

  it('drops a malformed change without breaking the stream', async () => {
    const stream = fakeStream();
    fetchMock.mockResolvedValue(stream.response());
    const service = TestBed.inject(LiveEventsService);
    const seen: LiveChange[] = [];
    service.changes$.subscribe(c => seen.push(c));

    token.set('jwt');
    TestBed.tick();
    stream.push('event:change\ndata:not json\n\nevent:change\ndata:{"type":"task","id":null}\n\n');
    await vi.waitFor(() => expect(seen).toEqual([{ type: 'task', id: null }]));
  });

  it('reconnects after the stream ends, and stops for good when the session does', async () => {
    vi.useFakeTimers();
    const first = fakeStream();
    const second = fakeStream();
    fetchMock.mockResolvedValueOnce(first.response()).mockResolvedValueOnce(second.response());
    TestBed.inject(LiveEventsService);

    token.set('jwt');
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(0);
    first.end();
    await vi.advanceTimersByTimeAsync(1_100);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    token.set(null);
    TestBed.tick();
    second.end();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not keep retrying a session the server refused', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(new Response('no', { status: 401 }));
    TestBed.inject(LiveEventsService);
    token.set('stale');
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
