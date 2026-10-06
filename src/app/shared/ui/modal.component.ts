import { Component, ElementRef, effect, input, output, viewChild } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { IconComponent } from './icon.component';

let nextId = 1;

/**
 * A dialog over the page. Moves focus into itself when it opens, keeps Tab inside
 * it, closes on Escape and returns focus to whatever opened it, which is what a
 * keyboard or screen-reader user needs from a modal and what a bare `position:
 * fixed` div does not give them.
 *
 * Put the actions in a `modal-footer` slot:
 * `<div modal-footer><button class="btn btn-primary">…</button></div>`.
 * A form that must not be lost to a stray click passes `[dismissable]="false"`.
 */
@Component({
  selector: 'app-modal',
  standalone: true,
  imports: [TranslateModule, IconComponent],
  template: `
    @if (open()) {
      <div class="fixed inset-0 flex items-end justify-center p-0 sm:items-center sm:p-4" style="z-index: var(--z-modal)">
        <div class="animate-fade absolute inset-0 bg-black/50" (click)="dismissable() && closed.emit()" aria-hidden="true"></div>
        <div
          #panel
          role="dialog"
          aria-modal="true"
          tabindex="-1"
          [attr.aria-labelledby]="titleId"
          class="relative flex max-h-[92vh] w-full flex-col rounded-t-xl border border-ink-200 bg-surface shadow-xl outline-none sm:rounded-xl"
          [class.sm:max-w-md]="size() === 'sm'"
          [class.sm:max-w-xl]="size() === 'md'"
          [class.sm:max-w-3xl]="size() === 'lg'"
          [class.sm:max-w-5xl]="size() === 'xl'"
          (keydown)="onKeydown($event)"
        >
          <header class="flex items-start justify-between gap-4 border-b border-ink-100 px-5 py-4">
            <h2 [id]="titleId" class="text-lg font-bold leading-tight text-ink-900">{{ title() }}</h2>
            @if (dismissable()) {
              <button type="button" class="btn btn-ghost btn-icon -me-2 -mt-1" (click)="closed.emit()" [attr.aria-label]="'COMMON.CLOSE' | translate">
                <app-icon name="close" [size]="18" />
              </button>
            }
          </header>
          <div #body class="min-h-0 flex-1 overflow-y-auto px-5 py-4"><ng-content /></div>
          <footer class="flex flex-wrap items-center justify-end gap-2 border-t border-ink-100 px-5 py-3 empty:hidden">
            <ng-content select="[modal-footer]" />
          </footer>
        </div>
      </div>
    }
  `,
})
export class ModalComponent {
  readonly open = input(false);
  readonly title = input.required<string>();
  readonly size = input<'sm' | 'md' | 'lg' | 'xl'>('md');
  readonly dismissable = input(true);
  readonly closed = output<void>();

  protected readonly titleId = `modal-title-${nextId++}`;
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly body = viewChild<ElementRef<HTMLElement>>('body');
  private opener: HTMLElement | null = null;

  constructor() {
    effect(() => {
      const panel = this.panel()?.nativeElement;
      if (panel) {
        this.opener = (document.activeElement as HTMLElement | null) ?? null;
        // After the view settles, so focus lands on the first field rather than on the (not yet laid out) panel.
        // The first field of the form, not the close button that happens to come first in the page.
        queueMicrotask(() => {
          const body = this.body()?.nativeElement;
          (this.focusables(body ?? panel)[0] ?? this.focusables(panel)[0] ?? panel).focus();
        });
      } else if (this.opener) {
        this.opener.focus?.();
        this.opener = null;
      }
    });
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.dismissable()) {
      event.stopPropagation();
      this.closed.emit();
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }
    const panel = this.panel()?.nativeElement;
    if (!panel) {
      return;
    }
    const items = this.focusables(panel);
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panel)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private focusables(root: HTMLElement): HTMLElement[] {
    return Array.from(
      root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'),
    ).filter(el => !el.hidden && !el.closest('[hidden], [aria-hidden="true"]') && (el as HTMLInputElement).type !== 'hidden');
  }
}
