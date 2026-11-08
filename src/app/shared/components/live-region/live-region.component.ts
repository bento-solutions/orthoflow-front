import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AnnouncerService } from '../../../core/services/announcer.service';

/** Mounted once, from the start: a live region only speaks if it was already there when its text changed. */
@Component({
  selector: 'app-live-region',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">{{ announcer.polite() }}</div>
    <div class="sr-only" role="alert" aria-live="assertive" aria-atomic="true">{{ announcer.assertive() }}</div>
  `,
})
export class LiveRegionComponent {
  protected readonly announcer = inject(AnnouncerService);
}
