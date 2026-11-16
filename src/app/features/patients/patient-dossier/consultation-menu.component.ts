import { IconComponent } from '../../../shared/ui/icon.component';
import { Component, ElementRef, HostListener, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';

/**
 * The banner's one Consultation button: a short menu with the two ways to record, so the
 * actions stay on one line. Dictating findings (a voice session) and recording the whole
 * conversation (a consultation) both start from here.
 *
 * Each item emits from inside the click, so the parent can open the microphone within
 * the tap, which iOS requires.
 */
@Component({
  selector: 'app-consultation-menu',
  standalone: true,
  imports: [IconComponent, TranslateModule],
  template: `
    <button #trigger type="button" class="btn btn-primary cm-trigger" (click)="open.set(!open())" [disabled]="starting()"
            aria-haspopup="menu" [attr.aria-expanded]="open()" [attr.aria-controls]="open() ? 'consultation-menu' : null">
      <app-icon class="mi" name="mic" size="1em" />
      {{ (starting() ? 'VOICE.STARTING' : 'CONSULTATION.BUTTON') | translate }}
      <app-icon class="mi cm-caret" name="expand_more" size="1em" />
    </button>
    @if (open()) {
      <div #menu id="consultation-menu" class="cm-menu" role="menu" [attr.aria-label]="'CONSULTATION.BUTTON' | translate"
           (keydown)="onMenuKeydown($event)">
        <button type="button" role="menuitem" tabindex="-1" class="cm-item" (click)="pick('voice')">
          <app-icon class="mi" name="mic" size="1em" />
          <span class="cm-text"><strong>{{ 'VOICE.START' | translate }}</strong><small>{{ 'CONSULTATION.MENU_VOICE_HINT' | translate }}</small></span>
        </button>
        <button type="button" role="menuitem" tabindex="-1" class="cm-item" (click)="pick('consultation')" [disabled]="!consultationAvailable()"
                [attr.aria-describedby]="consultationAvailable() ? null : 'consultation-menu-off'">
          <app-icon class="mi" name="forum" size="1em" />
          <span class="cm-text"><strong>{{ 'CONSULTATION.MENU_NEW' | translate }}</strong>
            @if (consultationAvailable()) {
              <small>{{ 'CONSULTATION.BUTTON_HINT' | translate }}</small>
            } @else {
              <small id="consultation-menu-off" class="cm-off">{{ 'CONSULTATION.MENU_OFF' | translate }}</small>
            }
          </span>
        </button>
        @if (introHidden() && consultationAvailable()) {
          <button type="button" role="menuitem" tabindex="-1" class="cm-item cm-minor" (click)="pick('showIntro')">
            <app-icon class="mi" name="visibility" size="1em" />
            <span class="cm-text">{{ 'CONSULTATION.SHOW_INTRO_AGAIN' | translate }}</span>
          </button>
        }
      </div>
    }
  `,
  styles: [`
    :host { position: relative; display: inline-flex; }
    /* The banner's one main action, in the action colour like every other primary button (P1-9). */
    .cm-trigger { display: inline-flex; align-items: center; gap: .4rem; width: 100%; }
    .cm-trigger:disabled { opacity: .7; }
    .cm-caret { margin-inline-start: -.125rem; transition: transform .15s; }
    .cm-trigger[aria-expanded='true'] .cm-caret { transform: rotate(180deg); }
    .cm-menu {
      position: absolute; top: calc(100% + .375rem); inset-inline-start: 0; z-index: 40; min-width: 18rem; max-width: 22rem;
      display: flex; flex-direction: column; padding: .375rem; border-radius: .75rem;
      background: var(--surface); border: 1px solid rgb(var(--ink-200)); box-shadow: 0 12px 32px rgb(0 0 0 / .14);
    }
    .cm-item {
      display: flex; align-items: flex-start; gap: .625rem; width: 100%; padding: .5rem .625rem; border: 0; border-radius: .5rem;
      background: transparent; color: rgb(var(--ink-900)); text-align: start; cursor: pointer; font: inherit;
    }
    .cm-item:hover:not(:disabled), .cm-item:focus-visible { background: rgb(var(--ink-50)); outline: none; }
    .cm-item:focus-visible { box-shadow: inset 0 0 0 2px var(--focus-ring); }
    .cm-item:disabled { cursor: not-allowed; color: rgb(var(--ink-500)); }
    .cm-item > app-icon.mi { font-size: 1.25rem; margin-top: .0625rem; color: rgb(var(--petrol-700)); }
    .cm-item:disabled > app-icon.mi { color: rgb(var(--ink-400)); }
    .cm-text { display: flex; flex-direction: column; gap: .125rem; min-width: 0; font-size: .875rem; }
    .cm-text strong { font-weight: 600; }
    .cm-text small { font-size: .75rem; line-height: 1.35; color: rgb(var(--ink-500)); white-space: normal; }
    .cm-off { color: rgb(var(--caution-700)) !important; }
    .cm-minor { border-top: 1px solid rgb(var(--ink-100)); border-radius: 0 0 .5rem .5rem; margin-top: .25rem; padding-top: .625rem; }
    .cm-minor .cm-text { font-size: .8125rem; color: rgb(var(--ink-600)); }
    .cm-minor > app-icon.mi { font-size: 1.0625rem; color: rgb(var(--ink-500)); }
  `],
})
export class ConsultationMenuComponent {
  readonly consultationAvailable = input(false);
  /** The doctor asked not to see the consultation's consent card again. */
  readonly introHidden = input(false);
  readonly starting = input(false);

  readonly voice = output<void>();
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

  protected pick(item: 'voice' | 'consultation' | 'showIntro'): void {
    this.open.set(false);
    if (item === 'voice') this.voice.emit();
    else if (item === 'consultation') this.consultation.emit();
    else this.showIntro.emit();
  }

  protected onMenuKeydown(event: KeyboardEvent): void {
    const items = Array.from(this.menu()?.nativeElement.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const go: Record<string, number> = { ArrowDown: at + 1, ArrowUp: at - 1 + items.length, Home: 0, End: items.length - 1 };
    if (event.key in go) {
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
