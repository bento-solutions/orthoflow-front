import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, output, signal } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { hasMeasurements, statusOf } from '../../../core/clinical/perio/perio-data';
import { MID_GAP, ToothNumbering, archWidth, slotsOf, toothLabel } from '../../../core/clinical/perio/perio-layout';
import { Arch, PerioData, TOOTH_STATUSES, ToothStatus, ToothStatusMap } from '../../../core/clinical/perio/perio.model';
import { PerioIconComponent } from './perio-icon.component';

export interface PerioStatusChange {
  readonly tooth: string;
  readonly status: ToothStatus;
}

interface Open {
  readonly tooth: string;
  readonly left: number;
  readonly top: number;
}

const POPOVER_WIDTH = 224;

/**
 * The tooth numbers between the two faces of an arch. Each is a button: it shows the tooth's status (a
 * missing tooth is red, a pontic amber, an implant blue) and opens the menu that changes it.
 */
@Component({
  selector: 'app-perio-numbers',
  standalone: true,
  imports: [TranslateModule, PerioIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:click)': 'onDocumentClick($event)', '(document:keydown.escape)': 'close()' },
  template: `
    <div class="row">
      <div class="spacer"></div>
      <div class="numbers" [style.width.px]="width()">
        @for (slot of slots(); track slot.code) {
          <div class="cell" [style.width.px]="slot.width">
            <button type="button" class="chip" [class]="'chip ' + statusOf(slot.code)" [class.open]="open()?.tooth === slot.code"
                    [attr.aria-label]="ariaLabel(slot.code)" [attr.aria-haspopup]="'listbox'" [attr.aria-expanded]="open()?.tooth === slot.code"
                    [title]="ariaLabel(slot.code)" (click)="toggle(slot.code, $event)">
              <span>{{ label(slot.code) }}</span>
              @switch (statusOf(slot.code)) {
                @case ('missing') { <app-perio-icon name="missing" [size]="12" class="i-missing"/> }
                @case ('implant') { <app-perio-icon name="implant" [size]="12" class="i-implant"/> }
                @case ('pontic') { <app-perio-icon name="pontic" [size]="12" class="i-pontic"/> }
              }
            </button>
          </div>
          @if (slot.index === 7) { <div [style.width.px]="gap"></div> }
        }
      </div>
    </div>
    @if (open(); as o) {
      <div class="popover" role="listbox" [attr.aria-label]="'PERIO.STATUS.TITLE' | translate"
           [style.left.px]="o.left" [style.top.px]="o.top" (click)="$event.stopPropagation()">
        @for (s of statuses; track s) {
          <button type="button" role="option" class="option" [class]="'option ' + s" [class.selected]="s === statusOf(o.tooth)"
                  [attr.aria-selected]="s === statusOf(o.tooth)" (click)="choose(o.tooth, s)">
            <span class="glyph">
              @switch (s) {
                @case ('present') { <span class="dot"></span> }
                @case ('missing') { <app-perio-icon name="missing" [size]="16" class="i-missing"/> }
                @case ('pontic') { <app-perio-icon name="pontic" [size]="16" class="i-pontic"/> }
                @case ('implant') { <app-perio-icon name="implant" [size]="16" class="i-implant"/> }
              }
            </span>
            <span class="name">{{ 'PERIO.STATUS.' + s.toUpperCase() | translate }}</span>
            @if (s === statusOf(o.tooth)) { <app-perio-icon name="check" [size]="16" class="tick"/> }
          </button>
        }
        @if (warnsOnClear(o.tooth)) {
          <p class="warn">{{ 'PERIO.STATUS.WARN_CLEARS' | translate }}</p>
        }
      </div>
    }
  `,
  styles: [`
    :host { display: block; }
    .row { display: flex; align-items: center; gap: 8px; }
    .spacer { width: 112px; flex-shrink: 0; }
    .numbers { display: flex; flex-direction: row; height: 24px; }
    .cell { display: flex; align-items: center; justify-content: center; height: 24px; flex-shrink: 0; }
    .chip { display: flex; align-items: center; justify-content: center; gap: 2px; height: 22px; min-width: 26px; padding: 0 4px;
            border: 0; border-radius: 6px; cursor: pointer; font: inherit; font-size: 14px; line-height: 20px; font-weight: 500;
            font-variant-numeric: tabular-nums; transition: background-color .15s, color .15s;
            background: rgba(9, 9, 11, 0.15); color: var(--perio-fg); }
    .chip:hover, .chip.open { background: rgba(9, 9, 11, 0.25); }
    .chip.missing { background: #fecaca; color: #7f1d1d; }
    .chip.missing:hover, .chip.missing.open { background: #fca5a5; }
    .chip.pontic { background: #fde68a; color: #78350f; }
    .chip.pontic:hover, .chip.pontic.open { background: #fcd34d; }
    .chip.implant { background: #bfdbfe; color: #1e3a8a; }
    .chip.implant:hover, .chip.implant.open { background: #93c5fd; }
    .chip:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--perio-ring); }
    .i-missing { color: #b91c1c; } .i-implant { color: #1d4ed8; } .i-pontic { color: #b45309; }
    .popover { position: fixed; z-index: 50; width: 224px; padding: 4px; border: 1px solid var(--perio-border); border-radius: 6px;
               background: #fff; color: var(--perio-fg); font-size: 14px; line-height: 20px;
               box-shadow: 0 4px 6px -1px rgb(0 0 0 / .1), 0 2px 4px -2px rgb(0 0 0 / .1); }
    .option { display: flex; width: 100%; align-items: center; gap: 8px; padding: 6px 8px; border: 0; border-radius: 6px; background: transparent;
              color: inherit; font: inherit; text-align: left; cursor: pointer; transition: background-color .15s; }
    .option:hover, .option:focus-visible { background: var(--perio-muted); outline: none; }
    .option.selected { font-weight: 500; }
    .option.selected.present { background: var(--perio-muted); }
    .option.selected.missing { background: #fef2f2; color: #b91c1c; }
    .option.selected.pontic { background: #fffbeb; color: #b45309; }
    .option.selected.implant { background: #eff6ff; color: #1d4ed8; }
    .glyph { display: flex; align-items: center; justify-content: center; width: 16px; height: 16px; flex-shrink: 0; }
    .dot { width: 8px; height: 8px; border-radius: 9999px; background: rgba(9, 9, 11, 0.4); }
    .name { flex: 1; }
    .tick { color: rgba(9, 9, 11, 0.6); }
    .warn { margin: 4px 0 0; padding: 6px 8px; border-top: 1px solid var(--perio-border); font-size: 11px; line-height: 16.5px; color: #b45309; }
  `],
})
export class PerioNumbersComponent {
  readonly arch = input.required<Arch>();
  readonly data = input.required<PerioData>();
  readonly status = input<ToothStatusMap>({});
  readonly numbering = input<ToothNumbering>('FDI');

  readonly statusChange = output<PerioStatusChange>();

  private readonly translate = inject(TranslateService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly gap = MID_GAP;
  protected readonly statuses = TOOTH_STATUSES;
  protected readonly open = signal<Open | null>(null);
  protected readonly slots = computed(() => slotsOf(this.arch()));
  protected readonly width = computed(() => archWidth(this.arch()));

  protected statusOf(tooth: string): ToothStatus {
    return statusOf(this.status(), tooth);
  }

  protected label(tooth: string): string {
    return toothLabel(tooth, this.numbering());
  }

  protected ariaLabel(tooth: string): string {
    return this.translate.instant('PERIO.STATUS.ARIA', {
      number: this.label(tooth),
      status: this.translate.instant('PERIO.STATUS.' + this.statusOf(tooth).toUpperCase()),
    });
  }

  protected warnsOnClear(tooth: string): boolean {
    return this.statusOf(tooth) === 'present' && hasMeasurements(this.data()[tooth]);
  }

  protected toggle(tooth: string, event: MouseEvent): void {
    event.stopPropagation();
    if (this.open()?.tooth === tooth) {
      this.close();
      return;
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const left = Math.min(Math.max(8, rect.left + rect.width / 2 - POPOVER_WIDTH / 2), window.innerWidth - POPOVER_WIDTH - 8);
    this.open.set({ tooth, left, top: rect.bottom + 6 });
  }

  protected choose(tooth: string, status: ToothStatus): void {
    this.close();
    if (status !== this.statusOf(tooth)) this.statusChange.emit({ tooth, status });
  }

  protected close(): void {
    this.open.set(null);
  }

  protected onDocumentClick(event: Event): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.close();
  }
}
