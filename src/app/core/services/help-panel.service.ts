import { Injectable, signal } from '@angular/core';

/** Whether the help panel is open. Kept apart from the panel so the header can open it without importing it. */
@Injectable({ providedIn: 'root' })
export class HelpPanelService {
  readonly open = signal(false);

  toggle(): void {
    this.open.update(v => !v);
  }

  show(): void {
    this.open.set(true);
  }

  hide(): void {
    this.open.set(false);
  }
}
