import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthService, SignOutReason } from '../services/auth.service';
import { BufferedCommand, SessionBufferService } from './session-buffer.service';

/**
 * The unsaved half of a consultation, in a browser several people share.
 * What is pinned here: it belongs to whoever dictated it, it goes when they
 * sign out on purpose, and writing to it can never bring a wiped one back.
 */

// ── A small IndexedDB stand-in ──────────────────────────────────────────
//
// Just enough of the API the buffer uses, with the one property that matters
// to it: transactions run one after another, and a request's callback may
// queue more work inside the same transaction.

class FakeRequest<T> {
  result: T | undefined;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
}

class FakeTransaction {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  private queue: Array<() => void> = [];
  private started = false;
  done: Promise<void>;
  private finish!: () => void;

  constructor(private data: Map<string, unknown>, private release: (tx: FakeTransaction) => void) {
    this.done = new Promise(resolve => { this.finish = resolve; });
  }

  objectStore() {
    const enqueue = <T>(run: () => T): FakeRequest<T> => {
      const request = new FakeRequest<T>();
      this.queue.push(() => {
        request.result = run();
        request.onsuccess?.();
      });
      if (this.started) queueMicrotask(() => this.pump());
      return request;
    };
    return {
      get: (key: string) => enqueue(() => structuredClone(this.data.get(key))),
      getAll: () => enqueue(() => [...this.data.values()].map(value => structuredClone(value))),
      put: (value: { sessionId: string }) => enqueue(() => { this.data.set(value.sessionId, structuredClone(value)); }),
      delete: (key: string) => enqueue(() => { this.data.delete(key); }),
      clear: () => enqueue(() => { this.data.clear(); }),
    };
  }

  start(): void {
    this.started = true;
    queueMicrotask(() => this.pump());
  }

  private pump(): void {
    while (this.queue.length > 0) this.queue.shift()!();
    this.oncomplete?.();
    this.finish();
    this.release(this);
  }
}

function installFakeIndexedDb(): { data: Map<string, unknown>; uninstall: () => void } {
  const data = new Map<string, unknown>();
  let running: Promise<void> = Promise.resolve();
  const db = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => undefined,
    transaction: () => {
      const tx = new FakeTransaction(data, () => undefined);
      // Transactions are serial: this one starts when the previous has finished.
      running = running.then(() => { tx.start(); return tx.done; });
      return tx;
    },
  };
  const original = (globalThis as { indexedDB?: unknown }).indexedDB;
  (globalThis as { indexedDB?: unknown }).indexedDB = {
    open: () => {
      const request = new FakeRequest<typeof db>() as FakeRequest<typeof db> & { onupgradeneeded: (() => void) | null; onblocked: (() => void) | null };
      request.result = db;
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  };
  return {
    data,
    uninstall: () => { (globalThis as { indexedDB?: unknown }).indexedDB = original; },
  };
}

// ── Who is signed in ────────────────────────────────────────────────────

class FakeAuth {
  user: { id: string } | null = { id: 'dr-a' };
  private handlers = new Set<(reason: SignOutReason) => void>();
  currentUser = () => this.user;
  onSignOut(handler: (reason: SignOutReason) => void) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
  signOut(reason: SignOutReason) { this.handlers.forEach(handler => handler(reason)); }
}

const command = (auditId: string): BufferedCommand => ({
  auditId, intent: 'clinical.addFindings', entities: { fdi: '16' },
  transcript: 'dent 16 carie', preview: 'Dent 16 : carie', corrections: [], at: Date.now(),
});

describe('SessionBufferService', () => {
  let fake: ReturnType<typeof installFakeIndexedDb>;
  let auth: FakeAuth;
  let buffer: SessionBufferService;

  const begin = (sessionId = 's-1', patientId = 'p-1') =>
    buffer.begin({ sessionId, patientId, patientName: 'Ahmed', locale: 'fr-MA', startedAt: Date.now() });

  beforeEach(() => {
    fake = installFakeIndexedDb();
    auth = new FakeAuth();
    TestBed.configureTestingModule({ providers: [{ provide: AuthService, useValue: auth }] });
    buffer = TestBed.inject(SessionBufferService);
  });

  afterEach(() => fake.uninstall());

  it('keeps what a dentist dictates and hands it back to them', async () => {
    await begin();
    await buffer.append('s-1', command('a-1'));
    await buffer.append('s-1', command('a-2'));
    await buffer.remove('s-1', 'a-1');

    const stored = await buffer.get('s-1');
    expect(stored?.commands.map(c => c.auditId)).toEqual(['a-2']);
    expect((await buffer.findResumable('p-1'))?.sessionId).toBe('s-1');
  });

  it('does not show a colleague\'s unsaved consultation to another account', async () => {
    await begin();
    await buffer.append('s-1', command('a-1'));

    auth.user = { id: 'dr-b' };
    expect(await buffer.get('s-1')).toBeNull();
    expect(await buffer.findResumable('p-1')).toBeNull();

    // And looking did not disturb it: the owner can still resume.
    auth.user = { id: 'dr-a' };
    expect((await buffer.findResumable('p-1'))?.commands).toHaveLength(1);
  });

  it('keeps nothing when nobody is signed in', async () => {
    auth.user = null;
    await begin();
    expect(fake.data.size).toBe(0);
  });

  it('wipes every buffer when someone signs out on purpose', async () => {
    await begin('s-1', 'p-1');
    await begin('s-2', 'p-2');
    await buffer.append('s-1', command('a-1'));

    auth.signOut('user');
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(fake.data.size).toBe(0);
  });

  it('keeps the buffer when the session merely expired, so the same dentist can resume', async () => {
    await begin();
    await buffer.append('s-1', command('a-1'));

    auth.signOut('expired');
    await new Promise(resolve => setTimeout(resolve, 0));

    expect((await buffer.findResumable('p-1'))?.commands).toHaveLength(1);
  });

  it('does not let a late write bring a wiped buffer back', async () => {
    await begin();
    await buffer.append('s-1', command('a-1'));

    // A command lands at the very moment the dentist signs out.
    const late = buffer.append('s-1', command('a-2'));
    const wipe = buffer.clearAll();
    await Promise.all([late, wipe]);

    expect(fake.data.size).toBe(0);
  });

  it('discards a buffer older than a day and one from before buffers had an owner', async () => {
    await begin('s-old', 'p-1');
    await begin('s-new', 'p-1');
    await buffer.append('s-new', command('a-1'));
    const old = fake.data.get('s-old') as { updatedAt: number; commands: unknown[] };
    old.updatedAt = Date.now() - 25 * 60 * 60 * 1000;
    old.commands = [command('x')];
    fake.data.set('s-legacy', {
      sessionId: 's-legacy', patientId: 'p-1', patientName: 'Ahmed', locale: 'fr-MA',
      startedAt: 0, updatedAt: Date.now(), commands: [command('y')],
    });

    const resumable = await buffer.findResumable('p-1');

    expect(resumable?.sessionId).toBe('s-new');
    expect([...fake.data.keys()]).toEqual(['s-new']);
  });

  it('never offers a session for a different patient', async () => {
    await begin('s-1', 'p-1');
    await buffer.append('s-1', command('a-1'));

    expect(await buffer.findResumable('p-2')).toBeNull();
  });
});
