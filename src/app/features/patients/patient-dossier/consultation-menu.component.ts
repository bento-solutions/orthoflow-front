import { PermissionService } from '../../../core/services/permission.service';
import { IconComponent } from '../../../shared/ui/icon.component';
import { Component, ElementRef, HostListener, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

/**
 * The banner's one main action: **Start consultation**. A tap opens the drawer's ready bar along the
 * bottom, where the doctor picks how it runs (analysed at the end, the default, or live) and starts
 * recording. Dictation has no entry of its own any more: following along live is the drawer's Live mode.
 *
 * Two small extras sit beside it, never in the way of the main tap:
 * - when the clinic has consultations off, the tap explains who can turn them on instead of failing silently;
 * - when the doctor asked not to see the consent card again, a caret offers it back.
 *
 * The button emits from inside the click, so the parent can open the microphone within the tap,
 * which iOS requires.
 */
@Component({
  selector: 'app-consultation-menu',
  standalone: true,
  imports: [IconComponent, TranslateModule],
  template: `
    <div class="cm-group">
      <button #trigger type="button" class="btn btn-primary cm-trigger" data-start-consultation (click)="start()" [disabled]="starting()"
              [class.is-off]="!consultationAvailable()" [attr.aria-describedby]="consultationAvailable() ? null : 'consultation-off'"
              [attr.aria-expanded]="consultationAvailable() ? null : open()">
        <app-icon class="mi" name="mic" size="1em" />
        {{ (starting() ? 'VOICE.STARTING' : 'CONSULTATION.BUTTON') | translate }}
      </button>
      @if (introHidden() && consultationAvailable()) {
        <button type="button" class="btn btn-primary cm-more" (click)="open.set(!open())" [disabled]="starting()"
                aria-haspopup="menu" [attr.aria-expanded]="open()" [attr.aria-controls]="open() ? 'consultation-menu' : null"
                [attr.aria-label]="'CONSULTATION.MORE_OPTIONS' | translate" [title]="'CONSULTATION.MORE_OPTIONS' | translate">
          <app-icon class="mi cm-caret" name="chevron-down" size="1em" />
        </button>
      }
    </div>
    @if (!consultationAvailable()) {
      <!-- Says who can turn it on, so the doctor is not left at a closed door (UI V2 audit M8). -->
      <span id="consultation-off" class="sr-only">{{ (isAdmin() ? 'CONSULTATION.MENU_OFF_ADMIN' : 'CONSULTATION.MENU_OFF') | translate }}</span>
    }
    @if (open()) {
      @if (consultationAvailable()) {
        <div #menu id="consultation-menu" class="cm-menu" role="menu" [attr.aria-label]="'CONSULTATION.MORE_OPTIONS' | translate"
             (keydown)="onMenuKeydown($event)">
          <button type="button" role="menuitem" tabindex="-1" class="cm-item" (click)="pickShowIntro()">
            <app-icon class="mi" name="eye" size="1em" />
            <span class="cm-text">{{ 'CONSULTATION.SHOW_INTRO_AGAIN' | translate }}</span>
          </button>
        </div>
      } @else {
        <div #menu class="cm-menu cm-note" role="status">
          <app-icon class="mi" name="info" size="1em" />
          <span class="cm-off">{{ (isAdmin() ? 'CONSULTATION.MENU_OFF_ADMIN' : 'CONSULTATION.MENU_OFF') | translate }}</span>
        </div>
      }
    }
  `,
  styles: [`
    :host { position: relative; display: inline-flex; }
    .cm-group { display: inline-flex; width: 100%; }
    /* The banner's one main action, in the action colour like every other primary button (P1-9). */
    .cm-trigger { display: inline-flex; align-items: center; justify-content: center; gap: .4rem; flex: 1; white-space: nowrap; }
    .cm-trigger:disabled { opacity: .7; }
    .cm-trigger.is-off { opacity: .6; }
    .cm-group:has(.cm-more) .cm-trigger { border-start-end-radius: 0; border-end-end-radius: 0; }
    .cm-more {
      padding-inline: .5rem; border-start-start-radius: 0; border-end-start-radius: 0;
      border-inline-start: 1px solid rgb(255 255 255 / .35);
    }
    .cm-caret { transition: transform .15s; }
    .cm-more[aria-expanded='true'] .cm-caret { transform: rotate(180deg); }
    .cm-menu {
      position: absolute; top: calc(100% + .375rem); inset-inline-start: 0; z-index: var(--z-overlay);
      /* Never wider than the screen (UI V2 audit H1). */
      min-width: min(18rem, calc(100vw - 2rem)); max-width: min(22rem, calc(100vw - 2rem));
      display: flex; flex-direction: column; padding: .375rem; border-radius: var(--radius-lg);
      background: var(--surface); border: 1px solid var(--border); box-shadow: var(--shadow-lg);
    }
    .cm-note { flex-direction: row; align-items: flex-start; gap: .5rem; padding: .625rem .75rem; font-size: var(--text-sm); line-height: 1.4; }
    .cm-note > app-icon.mi { margin-top: .125rem; color: rgb(var(--caution-700)); flex: none; }
    /* On a phone the menu is a sheet along the bottom, in the thumb's reach and never clipped. */
    @media (max-width: 480px) {
      .cm-menu { position: fixed; inset: auto .5rem calc(.5rem + env(safe-area-inset-bottom, 0px)) .5rem; min-width: 0; max-width: none; }
      .cm-item { min-height: 3rem; }
    }
    .cm-item {
      display: flex; align-items: center; gap: .625rem; width: 100%; padding: .5rem .625rem; border: 0; border-radius: var(--radius-md);
      background: transparent; color: rgb(var(--ink-900)); text-align: start; cursor: pointer; font: inherit;
    }
    .cm-item:hover, .cm-item:focus-visible { background: rgb(var(--ink-50)); outline: none; }
    .cm-item:focus-visible { box-shadow: inset 0 0 0 2px var(--focus-ring); }
    .cm-item > app-icon.mi { font-size: var(--text-md); color: rgb(var(--ink-500)); }
    .cm-text { font-size: var(--text-sm); color: rgb(var(--ink-700)); }
    .cm-off { color: rgb(var(--caution-700)); }
  `],
})
export class ConsultationMenuComponent {
  readonly consultationAvailable = input(false);
  /** The doctor asked not to see the consultation's consent card again. */
  readonly introHidden = input(false);
  readonly starting = input(false);
  protected readonly isAdmin = inject(PermissionService).isAdmin;

  readonly consultation = output<void>();
  readonly showIntro = output<void>();

  protected readonly open = signal(false);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly menu = viewChild<ElementRef<HTMLElement>>('menu');

  constructor() {
    // The menu takes focus when it opens; arrows move through it from there.
    effect(() => (this.menu()?.nativeElement.querySelector('button:not(:disabled)') as HTMLButtonElement | null)?.focus());
  }

  /** Starts the consultation, or — when the clinic has it off — says why it cannot. */
  protected start(): void {
    if (!this.consultationAvailable()) {
      this.open.set(!this.open());
      return;
    }
    this.open.set(false);
    this.consultation.emit();
  }

  protected pickShowIntro(): void {
    this.open.set(false);
    this.showIntro.emit();
  }

  protected onMenuKeydown(event: KeyboardEvent): void {
    const items = Array.from(this.menu()?.nativeElement.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const go: Record<string, number> = { ArrowDown: at + 1, ArrowUp: at - 1 + items.length, Home: 0, End: items.length - 1 };
    if (event.key in go && items.length) {
      event.preventDefault();
      items[go[event.key] % items.length]?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.open.set(false);
      this.trigger().nativeElement.focus();
    } else if (event.key === 'Tab') {
      this.open.set(false);
    }
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }
}
