import { Injectable, NgZone, OnDestroy, inject } from '@angular/core';
import { Observable, Subject, filter, map } from 'rxjs';

/** What changed on a patient's chart, in another window of the same browser. */
export interface ChartChange {
  readonly patientId: string;
  /** The tooth's state or note, a finding, the gums, or the treatments assigned. */
  readonly what: 'chart' | 'findings' | 'gums' | 'treatments';
}

const CHANNEL = 'orthoflow-patient-chart';

/**
 * Keeps the patient file and the 3D chart's own window in step. Both are the same app in two
 * windows of one browser, each with its own copy of the chart, the findings and the treatments:
 * whatever one of them saves, it says so here, and the other reloads that part from the server.
 *
 * Only "this patient's chart changed" crosses: never clinical data, which each window fetches
 * through the API with its own sign-in. A window does not hear its own messages, so a reload
 * never echoes back.
 */
@Injectable({ providedIn: 'root' })
export class ChartSyncService implements OnDestroy {
  private readonly zone = inject(NgZone);
  private readonly incoming = new Subject<ChartChange>();
  private readonly channel: BroadcastChannel | null = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL) : null;

  constructor() {
    if (this.channel) {
      this.channel.onmessage = (event: MessageEvent) => {
        const change = event.data as Partial<ChartChange> | null;
        if (change && typeof change.patientId === 'string' && typeof change.what === 'string') {
          this.zone.run(() => this.incoming.next({ patientId: change.patientId!, what: change.what! }));
        }
      };
    }
  }

  /** Tells the other windows that this patient's chart changed here. */
  announce(patientId: string, what: ChartChange['what']): void {
    try {
      this.channel?.postMessage({ patientId, what } satisfies ChartChange);
    } catch {
      /* a closed channel: nothing is listening any more */
    }
  }

  /** What another window changed on this patient's chart. */
  changes(patientId: () => string | null | undefined): Observable<ChartChange['what']> {
    return this.incoming.pipe(
      filter((change) => change.patientId === patientId()),
      map((change) => change.what),
    );
  }

  ngOnDestroy(): void {
    this.channel?.close();
  }
}
