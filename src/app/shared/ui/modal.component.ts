import { Component, ElementRef, effect, inject, input, output, viewChild } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { IconComponent } from './icon.component';
import { focusablesIn, keepTabInside } from './dialog.directive';

let nextId = 1;

/**
 * Whether an ancestor of `el` makes a stacking context, which would keep a `position: fixed`
 * overlay below whatever the page stacks above that ancestor (a sticky header, say).
 */
export function trappedInStackingContext(el: HTMLElement): boolean {
  const view = el.ownerDocument.defaultView;
  if (!view) return false;
  for (let node = el.parentElement; node && node !== el.ownerDocument.body; node = node.parentElement) {
    const s = view.getComputedStyle(node);
    const parent = node.parentElement ? view.getComputedStyle(node.parentElement).display : '';
    if (
      s.position === 'fixed' || s.position === 'sticky'
      || (s.zIndex !== 'auto' && s.zIndex !== '' && (s.position !== 'static' || /flex|grid/.test(parent)))
      || (s.transform && s.transform !== 'none') || (s.filter && s.filter !== 'none')
      || (s.perspective && s.perspective !== 'none') || (s.opacity !== '' && Number(s.opacity) < 1)
      || s.isolation === 'isolate' || /transform|opacity|filter|perspective/.test(s.willChange || '')
      || /paint|layout|strict|content/.test(s.contain || '')
      || (s.mixBlendMode && s.mixBlendMode !== 'normal')
      || /blur|brightness|contrast|drop-shadow|grayscale|hue|invert|opacity|saturate|sepia|url/.test(s.backdropFilter || '')
    ) {
      return true;
    }
  }
  return false;
}

/**
 * A dialog over the page. Moves focus into itself when it opens, keeps Tab inside
 * it, closes on Escape and returns focus to whatever opened it, which is what a
 * keyboard or screen-reader user needs from a modal and what a bare `position:
 * fixed` div does not give them.
 *
 * Put the actions in a `modal-footer` slot:
 * `<div modal-footer><button class="btn btn-primary">…</button></div>`.
 * A form that must not be lost to a stray click passes `[dismissable]="false"`.
 *
 * A sticky, transformed or z-indexed ancestor makes a stacking context, and a modal inside one
 * can never rise above the rest of the page: in the patient file, a modal opened from the 3D
 * chart's sticky tooth panel or the sticky consultation panel slid under the sticky patient
 * banner. When it opens inside such an ancestor, the overlay moves to `<body>`; Angular keeps
 * updating the moved nodes and removes them with the view.
 */
@Component({
  selector: 'app-modal',
  standalone: true,
  imports: [TranslateModule, IconComponent],
  template: `
    @if (open()) {
      <div #overlay class="fixed inset-0 flex items-end p-0" style="z-index: var(--z-modal)"
           [class.justify-center]="placement() === 'center'" [class.sm:items-center]="placement() === 'center'" [class.sm:p-4]="placement() === 'center'"
           [class.justify-end]="placement() === 'side'" [class.sm:items-stretch]="placement() === 'side'">
        <div class="animate-fade absolute inset-0 bg-black/50" (click)="dismissable() && closed.emit()" aria-hidden="true"></div>
        <div
          #panel
          role="dialog"
          aria-modal="true"
          tabindex="-1"
          [attr.aria-labelledby]="titleId"
          class="relative flex max-h-[92vh] w-full flex-col rounded-t-xl border border-ink-200 bg-surface shadow-xl outline-none"
          [class.sm:rounded-xl]="placement() === 'center'"
          [class.sm:rounded-none]="placement() === 'side'" [class.sm:max-h-none]="placement() === 'side'" [class.sm:h-full]="placement() === 'side'"
          [class.sm:border-y-0]="placement() === 'side'" [class.sm:border-e-0]="placement() === 'side'"
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
  /** Centred over the page, or a panel along the end edge that keeps the page beside it. */
  readonly placement = input<'center' | 'side'>('center');
  readonly dismissable = input(true);
  readonly closed = output<void>();

  protected readonly titleId = `modal-title-${nextId++}`;
  private readonly document = inject(DOCUMENT);
  private readonly overlay = viewChild<ElementRef<HTMLElement>>('overlay');
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly body = viewChild<ElementRef<HTMLElement>>('body');
  private opener: HTMLElement | null = null;

  constructor() {
    // Out of every stacking context the page puts around it (see above).
    effect(() => {
      const overlay = this.overlay()?.nativeElement;
      if (overlay && overlay.parentElement !== this.document.body && trappedInStackingContext(overlay)) {
        this.document.body.appendChild(overlay);
      }
    });
    effect(() => {
      const panel = this.panel()?.nativeElement;
      if (panel) {
        this.opener = (document.activeElement as HTMLElement | null) ?? null;
        // After the view settles, so focus lands on the first field rather than on the (not yet laid out) panel.
        // The first field of the form, not the close button that happens to come first in the page.
        queueMicrotask(() => {
          const body = this.body()?.nativeElement;
          (focusablesIn(body ?? panel)[0] ?? focusablesIn(panel)[0] ?? panel).focus();
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
    if (panel) keepTabInside(event, panel);
  }
}
