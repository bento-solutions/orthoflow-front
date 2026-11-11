import {
  ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, inject, input, output, signal,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { TranslateModule } from '@ngx-translate/core';
import { ConsultationService } from '../../../../core/consultation/consultation.service';
import { ConsultationFocusService } from '../../../../core/consultation/consultation-focus.service';
import { DentalChartState } from '../../../../core/models/patient.model';
import { ToothFinding } from '../../../../core/models/clinical-record.model';
import { PatientTreatment } from '../../../../core/models/patient-treatment.model';
import { CockpitControlsComponent } from './cockpit-controls.component';
import { CockpitConversationComponent } from './cockpit-conversation.component';
import { CockpitLastActionComponent } from './cockpit-last-action.component';
import { CockpitRailComponent } from './cockpit-rail.component';
import { CockpitStageComponent } from './cockpit-stage.component';

/**
 * One screen while a consultation is recording (docs/VOICE-COCKPIT-PLAN.md part I
 * §2). It replaces the dossier's tabs, the dictation panel, the side panel and the
 * dock: one status bar, one End, the stage in the middle, and — always in view —
 * what was last done and what was last heard.
 *
 * It owns nothing but the layout. The page itself never scrolls: the cockpit
 * measures where it starts and fills what is left of the window, and each part
 * scrolls inside itself.
 *
 * - **≥ 1100 px:** control bar across the top; rail and stage on the left; the
 *   last-action card and the conversation on the right.
 * - **below:** a "now" strip (the last sentence and the last action; a tap opens
 *   the conversation as a sheet), the rail, the stage, and the control bar at the
 *   bottom, in the thumb's reach, above the safe area.
 */
@Component({
  selector: 'app-consultation-cockpit',
  standalone: true,
  imports: [TranslateModule, CockpitControlsComponent, CockpitRailComponent, CockpitStageComponent, CockpitLastActionComponent, CockpitConversationComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ck" [style.height.px]="height()" data-cockpit>
      <app-cockpit-controls class="ck-a-controls" (leave)="leave.emit()" />

      <button type="button" class="ck-now ck-a-now" (click)="sheet.set(true)" [attr.aria-label]="'COCKPIT.OPEN_CONVERSATION' | translate">
        @if (lastLine(); as line) {
          <span class="ck-now-line"><span class="ck-now-time">{{ time(line.at) }}</span> {{ line.text }}</span>
        } @else {
          <span class="ck-now-line ck-muted">{{ 'COCKPIT.HINT' | translate }}</span>
        }
        @if (focus.lastAction(); as last) {
          <span class="ck-now-action" [attr.data-kind]="last.kind">
            <span class="material-icons" aria-hidden="true">{{ last.kind === 'unsure' ? 'help' : 'check_circle' }}</span>{{ last.title }}
          </span>
        }
      </button>

      <app-cockpit-rail class="ck-a-rail" />
      <app-cockpit-stage class="ck-a-stage" [chart]="chart()" [findings]="findings()" [treatments]="treatments()" />

      <aside class="ck-a-side" [attr.aria-label]="'COCKPIT.SIDE' | translate">
        <app-cockpit-last-action />
        <app-cockpit-conversation class="ck-side-conv" />
      </aside>

      @if (sheet()) {
        <div class="ck-sheet" role="dialog" aria-modal="true" [attr.aria-label]="'COCKPIT.CONVERSATION' | translate">
          <div class="ck-sheet-body">
            <button type="button" class="ck-sheet-close" (click)="sheet.set(false)" [attr.aria-label]="'COMMON.CLOSE' | translate">
              <span class="material-icons" aria-hidden="true">close</span>
            </button>
            <app-cockpit-last-action />
            <app-cockpit-conversation class="ck-side-conv" />
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .ck { display: grid; gap: .5rem; padding: .5rem; box-sizing: border-box; min-height: 0; overflow: hidden;
      grid-template-columns: minmax(0, 1fr) minmax(18rem, 24rem);
      grid-template-rows: auto auto minmax(0, 1fr);
      grid-template-areas: "controls controls" "rail side" "stage side"; }
    .ck-a-controls { grid-area: controls; min-width: 0; }
    .ck-a-rail { grid-area: rail; min-width: 0; }
    .ck-a-stage { grid-area: stage; min-height: 0; min-width: 0; }
    .ck-a-side { grid-area: side; display: flex; flex-direction: column; gap: .5rem; min-height: 0; }
    .ck-side-conv { flex: 1; min-height: 0; }
    .ck-a-now { display: none; }
    .ck-muted { color: rgb(var(--ink-600)); }

    @media (max-width: 1099.98px) {
      .ck { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto auto minmax(0, 1fr) auto;
        grid-template-areas: "now" "rail" "stage" "controls"; padding: .375rem .375rem calc(.375rem + env(safe-area-inset-bottom, 0px)); gap: .375rem; }
      .ck-a-side { display: none; }
      .ck-a-now { grid-area: now; display: flex; flex-direction: column; gap: .125rem; text-align: start; padding: .5rem .625rem; border-radius: .75rem; background: var(--surface); border: 1px solid rgb(var(--ink-200)); min-width: 0; }
      .ck-now-line { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: .9rem; color: rgb(var(--ink-900)); }
      .ck-now-time { font-size: .75rem; color: rgb(var(--ink-600)); font-variant-numeric: tabular-nums; }
      .ck-now-action { display: flex; align-items: center; gap: .25rem; font-weight: 700; color: rgb(var(--positive-800)); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
      .ck-now-action[data-kind='unsure'] { color: rgb(var(--caution-800)); }
      .ck-now-action .material-icons { font-size: 1.1rem; }
    }
    .ck-sheet { position: fixed; inset: 0; z-index: 50; background: rgb(0 0 0 / .4); display: flex; align-items: flex-end; }
    .ck-sheet-body { position: relative; width: 100%; height: 80dvh; display: flex; flex-direction: column; gap: .5rem; padding: 2.75rem .5rem calc(.5rem + env(safe-area-inset-bottom, 0px)); background: var(--app-bg); border-radius: 1rem 1rem 0 0; }
    .ck-sheet-close { position: absolute; top: .375rem; inset-inline-end: .375rem; width: 2.5rem; height: 2.5rem; display: grid; place-items: center; border-radius: .5rem; }
  `],
})
export class ConsultationCockpitComponent {
  protected readonly c = inject(ConsultationService);
  protected readonly focus = inject(ConsultationFocusService);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly document = inject(DOCUMENT);

  readonly chart = input<DentalChartState | null>(null);
  readonly findings = input<ToothFinding[]>([]);
  readonly treatments = input<PatientTreatment[]>([]);
  /** The back arrow: the doctor leaves the dossier; the consultation stays open on the server. */
  readonly leave = output<void>();

  protected readonly sheet = signal(false);
  protected readonly height = signal<number | null>(null);
  protected readonly lastLine = computed(() => this.c.lines().at(-1) ?? null);

  constructor() {
    const root = this.document.documentElement;
    root.classList.add('cockpit-mode');
    const measure = () => {
      const top = (this.host.nativeElement as HTMLElement).getBoundingClientRect().top;
      const view = this.document.defaultView;
      if (!view) return;
      this.height.set(Math.max(320, Math.floor(view.innerHeight - Math.max(0, top))));
    };
    afterNextRender(() => measure());
    const view = this.document.defaultView;
    view?.addEventListener('resize', measure);
    view?.visualViewport?.addEventListener('resize', measure);
    inject(DestroyRef).onDestroy(() => {
      root.classList.remove('cockpit-mode');
      view?.removeEventListener('resize', measure);
      view?.visualViewport?.removeEventListener('resize', measure);
    });
  }

  protected time(at: number): string {
    if (!at) return '';
    const d = new Date(at);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
}
