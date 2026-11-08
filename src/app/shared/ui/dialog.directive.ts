import { AfterViewInit, Directive, ElementRef, OnDestroy, inject, input, output } from '@angular/core';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** What Tab can reach inside an element, in order. */
export function focusablesIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
    .filter((el) => !el.hidden && !el.closest('[hidden], [aria-hidden="true"]') && (el as HTMLInputElement).type !== 'hidden');
}

/** Sends Tab from the last stop back to the first, and Shift+Tab the other way, so focus cannot leave. */
export function keepTabInside(event: KeyboardEvent, root: HTMLElement): void {
  const items = focusablesIn(root);
  if (!items.length) {
    event.preventDefault();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === root)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * Makes the panel of a dialog behave as one: it says it is a dialog and what it is called, takes
 * focus when it appears, keeps Tab inside, closes on Escape and hands focus back to whatever
 * opened it. For panels with a look of their own; `<app-modal>` gives a new one all this.
 *
 * Goes on the element inside the `@if` that opens it, and the value is the id of its title:
 * `<div appDialog="edit-title" (dialogClosed)="close()">…<h3 id="edit-title">`.
 */
@Directive({
  selector: '[appDialog]',
  standalone: true,
  host: {
    role: 'dialog',
    'aria-modal': 'true',
    tabindex: '-1',
    '[attr.aria-labelledby]': 'appDialog() || null',
    '(keydown)': 'onKeydown($event)',
  },
})
export class DialogDirective implements AfterViewInit, OnDestroy {
  readonly appDialog = input('');
  readonly dialogClosed = output<void>();

  private readonly panel = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private opener: HTMLElement | null = null;

  ngAfterViewInit(): void {
    this.opener = document.activeElement as HTMLElement | null;
    const items = focusablesIn(this.panel);
    // The first field of the form, not the close button that happens to come first in the page.
    (items.find((el) => el.matches('input, select, textarea')) ?? items[0] ?? this.panel).focus();
  }

  ngOnDestroy(): void {
    if (this.opener?.isConnected) this.opener.focus();
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      this.dialogClosed.emit();
    } else if (event.key === 'Tab') {
      keepTabInside(event, this.panel);
    }
  }
}
