import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { ConsultationFocusService } from '../../../../core/consultation/consultation-focus.service';
import { DentalChartState } from '../../../../core/models/patient.model';
import { ToothFinding } from '../../../../core/models/clinical-record.model';
import { PatientTreatment } from '../../../../core/models/patient-treatment.model';
import { stagedToothFindings } from '../../../../core/voice/voice-chart-marks';
import { VoiceContextService } from '../../../../core/voice/voice-context.service';
import { VoiceOrchestratorService } from '../../../../core/voice/voice-orchestrator.service';
import { Dental3dChartComponent } from '../../../../features/dental-3d/dental-3d-chart.component';
import { CockpitConversationComponent } from './cockpit-conversation.component';
import { CockpitHelpComponent } from './cockpit-help.component';
import { CockpitSectionComponent } from './cockpit-section.component';

/**
 * The middle of the cockpit: the 3D chart, or one section, filling what is left
 * of the screen. The chart is the same component as everywhere else — one WebGL
 * context for the app — in its compact form, with what is staged drawn on it.
 */
@Component({
  selector: 'app-cockpit-stage',
  standalone: true,
  imports: [TranslateModule, Dental3dChartComponent, CockpitSectionComponent, CockpitHelpComponent, CockpitConversationComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ck-stage" [attr.data-view]="focus.view()">
      @switch (focus.view()) {
        @case ('chart') {
          @if (chart(); as state) {
            @defer (on immediate) {
              <app-dental-3d-chart class="ck-chart"
                [chart]="state"
                [findings]="findings()"
                [treatments]="treatments()"
                [staged]="staged()"
                [focusFdi]="focusFdi()"
                [selected]="focusFdi()"
                [sidePanel]="false"
                [compact]="true"
                [cameraFollows]="!focus.pinned()"
              />
            } @placeholder {
              <div class="ck-chart-placeholder" aria-hidden="true"></div>
            }
          } @else {
            <p class="ck-loading">{{ 'COMMON.LOADING' | translate }}</p>
          }
        }
        @case ('help') { <app-cockpit-help /> }
        @case ('transcript') { <app-cockpit-conversation class="ck-full" [typing]="false" /> }
        @default { <app-cockpit-section [view]="focus.view()" /> }
      }
    </div>
  `,
  styles: [`
    :host { display: block; min-height: 0; }
    .ck-stage { height: 100%; min-height: 0; overflow: auto; background: var(--surface); border: 1px solid rgb(var(--ink-200)); border-radius: .75rem; }
    .ck-stage[data-view='chart'] { overflow: hidden; display: flex; flex-direction: column; }
    .ck-chart { display: block; flex: 1; min-height: 0; }
    .ck-chart-placeholder { height: 100%; background: rgb(var(--ink-50)); }
    .ck-full { height: 100%; }
    .ck-loading { padding: 1rem; color: rgb(var(--ink-600)); }
  `],
})
export class CockpitStageComponent {
  protected readonly focus = inject(ConsultationFocusService);
  private readonly voice = inject(VoiceOrchestratorService);
  private readonly context = inject(VoiceContextService);

  readonly chart = input<DentalChartState | null>(null);
  readonly findings = input<ToothFinding[]>([]);
  readonly treatments = input<PatientTreatment[]>([]);

  protected readonly staged = computed(() => stagedToothFindings(this.voice.buffered()));
  protected readonly focusFdi = computed(() => this.voice.highlightedFdi() ?? this.context.selectedFdi());
}
