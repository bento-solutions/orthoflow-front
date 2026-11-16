import { Component, input, output } from '@angular/core';
import { IconComponent, IconName } from './icon.component';

/**
 * The one empty state (UX audit P1-10, P2): an icon, a title that says what is missing, one
 * sentence on why it matters or what to do, and one action. It replaces five families of
 * empty-state classes. `compact` is for a card or a side panel.
 *
 * `<app-empty-state icon="calendar" [title]="…" [text]="…" [actionLabel]="…" (action)="book()" />`
 */
@Component({
  selector: 'app-empty-state',
  standalone: true,
  imports: [IconComponent],
  template: `
    <div class="empty" [class.empty-compact]="compact()">
      <span class="empty-icon" aria-hidden="true"><app-icon [name]="icon()" [size]="compact() ? 18 : 22" /></span>
      <p class="empty-title">{{ title() }}</p>
      @if (text()) { <p class="empty-text">{{ text() }}</p> }
      @if (actionLabel()) {
        <button type="button" class="btn btn-primary btn-sm mt-1" (click)="action.emit()">
          <app-icon [name]="actionIcon()" [size]="14" />{{ actionLabel() }}
        </button>
      }
      <ng-content />
    </div>
  `,
  styles: [':host { display: block; }'],
})
export class EmptyStateComponent {
  readonly icon = input<IconName>('inbox');
  readonly title = input.required<string>();
  readonly text = input<string | null>(null);
  readonly actionLabel = input<string | null>(null);
  readonly actionIcon = input<IconName>('plus');
  readonly compact = input(false);
  readonly action = output<void>();
}
