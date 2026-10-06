import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { Observable, Subject, filter } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';
import { parseSse } from './sse';

/** "Something changed": a type and the id of the record. Never patient data; refetch through the API. */
export interface LiveChange {
  type: string;
  id: string | null;
}

const MIN_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;

/**
 * Keeps one open stream to `GET /events` while someone is signed in, so two
 * receptionists see the same agenda without refreshing.
 *
 * The stream is read with `fetch` rather than `EventSource` because it must carry
 * the bearer token. It reconnects with a growing pause, restarts after the
 * server's own 30-minute timeout, and stops the moment the session ends. A screen
 * subscribes with {@link of} and refetches what it shows; the event itself says
 * nothing about the data.
 */
@Injectable({ providedIn: 'root' })
export class LiveEventsService {
  private readonly auth = inject(AuthService);
  private readonly subject = new Subject<LiveChange>();
  private abort: AbortController | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private delay = MIN_DELAY_MS;

  readonly changes$: Observable<LiveChange> = this.subject.asObservable();
  /** True while the stream is open, so a screen can say its view may be stale. */
  readonly connected = signal(false);

  constructor() {
    effect(() => {
      const token = this.auth.token();
      untracked(() => (token ? this.start(token) : this.stop()));
    });
  }

  /** Changes of the given types only. */
  of(...types: string[]): Observable<LiveChange> {
    return this.changes$.pipe(filter(change => types.includes(change.type)));
  }

  private start(token: string): void {
    this.stop();
    const abort = new AbortController();
    this.abort = abort;
    void this.run(token, abort);
  }

  private stop(): void {
    this.abort?.abort();
    this.abort = null;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.delay = MIN_DELAY_MS;
    this.connected.set(false);
  }

  private async run(token: string, abort: AbortController): Promise<void> {
    try {
      const response = await fetch(`${environment.apiUrl}/api/v1/events`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
        signal: abort.signal,
      });
      if (!response.ok || !response.body) {
        // A refused session will not be fixed by trying again; the next ordinary request signs the person out.
        if (response.status === 401 || response.status === 403) {
          return;
        }
        throw new Error(`events: ${response.status}`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const { messages, rest } = parseSse(buffer);
        buffer = rest;
        for (const message of messages) {
          this.deliver(message.event, message.data);
        }
      }
    } catch {
      /* dropped connection, or aborted by stop(): handled below */
    }
    this.connected.set(false);
    if (!abort.signal.aborted) {
      this.timer = setTimeout(() => this.auth.token() && this.start(this.auth.token()!), this.delay);
      this.delay = Math.min(this.delay * 2, MAX_DELAY_MS);
    }
  }

  private deliver(event: string, data: string): void {
    if (event === 'ready') {
      this.connected.set(true);
      this.delay = MIN_DELAY_MS;
      return;
    }
    if (event !== 'change') {
      return;
    }
    try {
      const parsed = JSON.parse(data) as { type?: unknown; id?: unknown };
      if (typeof parsed.type === 'string') {
        this.subject.next({ type: parsed.type, id: typeof parsed.id === 'string' ? parsed.id : null });
      }
    } catch {
      /* a malformed frame is dropped; the next change will refresh the screen */
    }
  }
}
