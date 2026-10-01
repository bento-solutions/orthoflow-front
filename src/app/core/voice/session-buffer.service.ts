import { Injectable, inject } from '@angular/core';
import { AuthService } from '../services/auth.service';

/**
 * What a dictated examination has recorded but not yet saved.
 *
 * ── Why there is a buffer at all ────────────────────────────────────────
 *
 * Findings used to be written to the clinical record as they were dictated.
 * That is safe against crashes and wrong for the workflow: the dentist wants
 * to review, correct and prune a consultation before any of it becomes part
 * of the record, and by then the writes have already happened. So dictation
 * now accumulates here and is committed once, at review.
 *
 * ── Why IndexedDB and not memory ────────────────────────────────────────
 *
 * Buffering moves the risk: a closed tab, a flat battery or a crashed browser
 * now loses a consultation that would previously have been half-written. This
 * is the answer to that — the buffer survives a reload, and the dossier offers
 * to resume it. It is a second line of defence rather than the only one: every
 * command is also audited server-side as it is spoken, so even a lost buffer
 * leaves a record of what was said.
 *
 * ── What is stored ─────────────────────────────────────────────────────
 *
 * Transcripts and resolved intents. Not audio: a consultation recording in a
 * browser profile is an exposure with no corresponding use, since the clip has
 * already been transcribed by the time an entry is written here.
 *
 * ── Whose it is ─────────────────────────────────────────────────────────
 *
 * This is health information in plain text in a browser profile that, in a
 * cabinet, several people use in turn. So a buffer belongs to the user who
 * dictated it: another account on the same PC neither sees nor resumes it, and
 * signing out on purpose wipes the lot. A session that merely expired keeps its
 * buffer, because the same dentist signing straight back in is exactly who
 * should be able to pick it up.
 */

export interface BufferedCommand {
  /** Server-side audit row id — what commit approves or rejects. */
  auditId: string;
  intent: string;
  entities: Record<string, unknown>;
  /** What the dentist actually said, for the review page's "heard" column. */
  transcript: string;
  /** Human-readable preview, as shown in the HUD at dictation time. */
  preview: string;
  /** Terms the fuzzy matcher repaired, so review can show what was corrected. */
  corrections: { from: string; to: string }[];
  at: number;
}

export interface BufferedSession {
  sessionId: string;
  /** Who dictated it. A buffer without one predates ownership and is discarded. */
  userId: string;
  patientId: string;
  patientName: string;
  locale: string;
  startedAt: number;
  updatedAt: number;
  commands: BufferedCommand[];
}

const DB_NAME = 'orthoflow-voice';
const DB_VERSION = 1;
const STORE = 'sessions';

/**
 * A buffer older than this is not resumable. A dentist coming back to a
 * two-day-old half-finished consultation is not resuming it — they are
 * looking at something they have forgotten the context of, and the server's
 * PENDING_REVIEW list is the right place to pick that up rather than a
 * browser-local blob.
 */
const EXPIRY_MS = 24 * 60 * 60 * 1000;

@Injectable({ providedIn: 'root' })
export class SessionBufferService {
  private auth = inject(AuthService);
  private dbPromise: Promise<IDBDatabase | null> | null = null;

  constructor() {
    // Signing out on purpose is leaving the machine: nothing dictated should
    // stay in this browser for whoever sits down next.
    this.auth.onSignOut(reason => {
      if (reason === 'user') void this.clearAll();
    });
  }

  private currentUserId(): string | null {
    return this.auth.currentUser()?.id ?? null;
  }

  /**
   * IndexedDB is unavailable in private windows in some browsers and can be
   * disabled outright. Every method resolves to a null-ish result in that
   * case rather than throwing: losing crash-resilience is a degradation, not
   * a reason to block a consultation.
   */
  private open(): Promise<IDBDatabase | null> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise<IDBDatabase | null>(resolve => {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }
      let request: IDBOpenDBRequest;
      try {
        request = indexedDB.open(DB_NAME, DB_VERSION);
      } catch {
        resolve(null);
        return;
      }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'sessionId' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
    return this.dbPromise;
  }

  private async withStore<T>(
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T | null> {
    const db = await this.open();
    if (!db) return null;
    return new Promise<T | null>(resolve => {
      try {
        const transaction = db.transaction(STORE, mode);
        const request = action(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async begin(session: Omit<BufferedSession, 'commands' | 'updatedAt' | 'userId'>): Promise<void> {
    const userId = this.currentUserId();
    // Nobody is signed in: there is no one to own it, so nothing is kept.
    if (!userId) return;
    await this.withStore('readwrite', store => store.put({
      ...session,
      userId,
      commands: [],
      updatedAt: Date.now(),
    } satisfies BufferedSession));
  }

  /**
   * Reads, changes and writes one session inside a single transaction.
   *
   * One transaction matters: a read and a later write made separately can be
   * interleaved with a {@link clearAll}, and the write would bring a wiped
   * session back to life.
   */
  private async change(sessionId: string, apply: (session: BufferedSession) => void): Promise<void> {
    const db = await this.open();
    if (!db) return;
    await new Promise<void>(resolve => {
      try {
        const transaction = db.transaction(STORE, 'readwrite');
        const store = transaction.objectStore(STORE);
        const read = store.get(sessionId);
        read.onsuccess = () => {
          const session = read.result as BufferedSession | undefined;
          if (!session) return;
          apply(session);
          session.updatedAt = Date.now();
          store.put(session);
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => resolve();
        transaction.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  /**
   * Appends one dictated command.
   *
   * Read-modify-write rather than an append-only store of individual commands:
   * a consultation is tens of entries, not thousands, and keeping the session
   * as one record means a partially-written buffer is never a possibility.
   */
  async append(sessionId: string, command: BufferedCommand): Promise<void> {
    await this.change(sessionId, session => {
      session.commands.push(command);
    });
  }

  /** Drops one command — the hands-free "annule ça" during dictation. */
  async remove(sessionId: string, auditId: string): Promise<void> {
    await this.change(sessionId, session => {
      session.commands = session.commands.filter(command => command.auditId !== auditId);
    });
  }

  /** The buffered session, if it exists and belongs to whoever is signed in. */
  async get(sessionId: string): Promise<BufferedSession | null> {
    const result = await this.withStore<BufferedSession>('readonly', store => store.get(sessionId));
    const userId = this.currentUserId();
    return result && userId && result.userId === userId ? result : null;
  }

  /** Called once the server has accepted the commit. */
  async clear(sessionId: string): Promise<void> {
    await this.withStore('readwrite', store => store.delete(sessionId));
  }

  /** Everything, for everyone — on an explicit sign-out. */
  async clearAll(): Promise<void> {
    await this.withStore('readwrite', store => store.clear());
  }

  /**
   * An unfinished session for this patient, if one is worth resuming.
   *
   * Scoped to the patient on purpose: offering to resume Ahmed's half-finished
   * examination while the dentist has Fatima's dossier open is how findings
   * end up on the wrong chart. And to the user: a colleague's unsaved
   * consultation is not theirs to resume or to read.
   */
  async findResumable(patientId: string): Promise<BufferedSession | null> {
    const userId = this.currentUserId();
    if (!userId) return null;
    const all = await this.withStore<BufferedSession[]>('readonly', store => store.getAll());
    if (!all) return null;

    const cutoff = Date.now() - EXPIRY_MS;
    // Opportunistic cleanup: expired buffers — and ones from before buffers had
    // an owner — have no other reaper, and this is the only code path that
    // reliably runs. Another user's live buffer is left strictly alone.
    const discard = all.filter(session => session.updatedAt < cutoff || !session.userId);
    for (const session of discard) {
      await this.clear(session.sessionId);
    }

    return all
      .filter(session => session.userId === userId
        && session.patientId === patientId
        && session.updatedAt >= cutoff
        && session.commands.length > 0)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
  }
}
