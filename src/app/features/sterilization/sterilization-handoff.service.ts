import { Injectable, signal } from '@angular/core';

/** Items picked on the scan screen that the cycles screen should open a new cycle with. */
export interface CycleCreateRequest {
  itemIds: string[];
}

/**
 * A one-way note from the scan screen to the cycles screen: "load these". The cycles screen takes
 * it when it opens and clears it, so a later visit does not reopen the dialog.
 */
@Injectable({ providedIn: 'root' })
export class SterilizationHandoff {
  readonly request = signal<CycleCreateRequest | null>(null);

  take(): CycleCreateRequest | null {
    const request = this.request();
    this.request.set(null);
    return request;
  }
}
