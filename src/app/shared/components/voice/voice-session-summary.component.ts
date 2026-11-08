import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { VoiceSessionService } from '../../../core/voice/voice-session.service';
import { ToastService } from '../../../core/services/toast.service';
import { DialogDirective } from '../../ui/dialog.directive';
import { TranslateModule, TranslateService } from '@ngx-translate/core';

/**
 * The consultation summary a dictated examination produces, for review and
 * sign-off.
 *
 * Everything shown here was read back from the server, not accumulated in the
 * browser — the doctor confirms what was actually persisted, which is the
 * only version of the summary worth signing. Findings are grouped the way a
 * consultation is actually reviewed: tooth by tooth, then diagnoses separated
 * from the work they imply.
 */
@Component({
  selector: 'app-voice-session-summary',
  standalone: true,
  imports: [TranslateModule, DialogDirective, CommonModule, FormsModule],
  template: `
    @if (session.summaryOpen() && session.summary(); as summary) {
      <div class="summary-backdrop" (click)="session.closeSummary()">
        <div class="summary-panel" appDialog="voice-summary-title" (dialogClosed)="session.closeSummary()" (click)="$event.stopPropagation()">

          <header class="summary-header">
            <div>
              <h2 id="voice-summary-title">{{ 'VOICE.SUMMARY.TITLE' | translate }}</h2>
              <p class="summary-sub">
                {{ 'VOICE.SUMMARY.COUNTS' | translate: { findings: summary.totalFindings, teeth: summary.teeth.length } }}
              </p>
            </div>
            <button type="button" class="icon-btn" (click)="session.closeSummary()" [attr.aria-label]="'COMMON.CLOSE' | translate">
              <span aria-hidden="true" class="material-icons">close</span>
            </button>
          </header>

          <div class="summary-body">
            @if (summary.teeth.length) {
              <section>
                <h3>{{ 'VOICE.SUMMARY.BY_TOOTH' | translate }}</h3>
                <ul class="tooth-list">
                  @for (tooth of summary.teeth; track tooth.fdi) {
                    <li>
                      <span class="fdi">{{ tooth.fdi }}</span>
                      <div>
                        <p class="tooth-name">{{ tooth.description }}</p>
                        <p class="tooth-findings">
                          @for (finding of tooth.findings; track finding.code) {
                            <span class="finding" [attr.data-kind]="finding.kind">{{ finding.label }}</span>
                          }
                        </p>
                        @for (finding of tooth.findings; track finding.code) {
                          @if (finding.note) { <p class="tooth-note">“{{ finding.note }}”</p> }
                        }
                      </div>
                    </li>
                  }
                </ul>
              </section>
            }

            @if (summary.diagnoses.length) {
              <section>
                <h3>{{ 'VOICE.SUMMARY.DIAGNOSES' | translate }}</h3>
                <ul class="plain">
                  @for (line of summary.diagnoses; track line) { <li>{{ line }}</li> }
                </ul>
              </section>
            }

            @if (summary.treatments.length) {
              <section>
                <h3>{{ 'VOICE.SUMMARY.TREATMENTS' | translate }}</h3>
                <ul class="plain">
                  @for (line of summary.treatments; track line) { <li>{{ line }}</li> }
                </ul>
              </section>
            }

            @if (summary.allergies.length) {
              <section>
                <h3>{{ 'VOICE.SUMMARY.ALLERGIES' | translate }}</h3>
                <ul class="plain">
                  @for (substance of summary.allergies; track substance) {
                    <li class="allergy">
                      <span aria-hidden="true" class="material-icons">warning</span> {{ substance }}
                    </li>
                  }
                </ul>
              </section>
            }

            @if (summary.medicalHistory.length) {
              <section>
                <h3>{{ 'VOICE.SUMMARY.HISTORY' | translate }}</h3>
                <ul class="plain">
                  @for (entry of summary.medicalHistory; track entry.label) {
                    <li><span class="cat">{{ entry.category.replace('_', ' ') | lowercase }}</span> {{ entry.label }}</li>
                  }
                </ul>
              </section>
            }

            @if (summary.notes.length) {
              <section>
                <h3>{{ 'VOICE.SUMMARY.NOTES' | translate }}</h3>
                <ul class="plain">
                  @for (note of summary.notes; track note.content) {
                    <li>
                      <span class="cat">{{ note.category.replace('_', ' ') | lowercase }}</span>
                      @if (note.fdi) { <span class="cat tooth">{{ 'VOICE.SUMMARY.TOOTH' | translate: { fdi: note.fdi } }}</span> }
                      {{ note.content }}
                    </li>
                  }
                </ul>
              </section>
            }

            @if (summary.followUps.length) {
              <section>
                <h3>{{ 'VOICE.SUMMARY.FOLLOW_UP' | translate }}</h3>
                <ul class="plain">
                  @for (item of summary.followUps; track item) { <li>{{ item }}</li> }
                </ul>
              </section>
            }

            @if (summary.totalFindings === 0 && summary.notes.length === 0 && summary.allergies.length === 0) {
              <p class="empty">{{ 'VOICE.SUMMARY.NOTHING' | translate }}</p>
            }

            <!-- Editable clinician remarks — appended to the summary on confirm -->
            <section class="notes-section">
              <h3>{{ 'VOICE.SUMMARY.REMARKS' | translate }}</h3>
              <p class="notes-hint">
                {{ 'VOICE.SUMMARY.REMARKS_HINT' | translate }}
              </p>
              <textarea
                class="notes-input"
                [(ngModel)]="clinicianNotes"
                name="clinicianNotes"
                rows="4"
                [placeholder]="'VOICE.SUMMARY.REMARKS_PLACEHOLDER' | translate"
                [attr.aria-label]="'VOICE.SUMMARY.REMARKS' | translate"
              ></textarea>
            </section>
          </div>

          <footer class="summary-footer">
            <p class="footer-note">
              {{ 'VOICE.SUMMARY.CONFIRM_HINT' | translate }}
            </p>
            <div class="footer-actions">
              <button type="button" class="btn btn-secondary" (click)="session.closeSummary()">{{ 'VOICE.SUMMARY.KEEP_EDITING' | translate }}</button>
              <button type="button" class="btn btn-primary" [disabled]="confirming()" (click)="confirm()">
                <span aria-hidden="true" class="material-icons">check_circle</span>
                {{ (confirming() ? 'VOICE.SUMMARY.CONFIRMING' : 'VOICE.SUMMARY.CONFIRM') | translate }}
              </button>
            </div>
          </footer>
        </div>
      </div>
    }
  `,
  styles: [`
    .summary-backdrop {
      position: fixed; inset: 0; background: rgba(15, 23, 42, 0.5); z-index: 2100;
      display: flex; align-items: center; justify-content: center; padding: 1rem;
    }
    .summary-panel {
      background: var(--surface); border-radius: 16px; width: 100%; max-width: 40rem;
      max-height: 88vh; display: flex; flex-direction: column;
      box-shadow: 0 24px 48px -12px rgba(0, 0, 0, 0.35); color: rgb(var(--ink-900));
    }
    .summary-header {
      display: flex; align-items: flex-start; justify-content: space-between;
      padding: 1.25rem 1.5rem 0.875rem; border-bottom: 1px solid rgb(var(--ink-200));
    }
    .summary-header h2 { margin: 0; font-size: 1.125rem; font-weight: 700; }
    .summary-sub { margin: 0.125rem 0 0; font-size: 0.8125rem; color: rgb(var(--ink-500)); }

    .summary-body { overflow-y: auto; padding: 1rem 1.5rem; flex: 1; }
    section { margin-bottom: 1.25rem; }
    section h3 {
      margin: 0 0 0.5rem; font-size: 0.6875rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.06em; color: rgb(var(--ink-500));
    }

    .tooth-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.625rem; }
    .tooth-list li { display: flex; gap: 0.75rem; align-items: flex-start; }
    .fdi {
      flex-shrink: 0; width: 2rem; height: 2rem; border-radius: 8px;
      background: rgb(var(--ink-900)); color: #fff; display: flex; align-items: center; justify-content: center;
      font-weight: 700; font-size: 0.8125rem;
    }
    .tooth-name { margin: 0; font-size: 0.8125rem; color: rgb(var(--ink-500)); }
    .tooth-findings { margin: 0.25rem 0 0; display: flex; flex-wrap: wrap; gap: 0.25rem; }
    .finding {
      font-size: 0.75rem; font-weight: 600; border-radius: 999px; padding: 0.125rem 0.5rem;
      background: rgb(var(--ink-100)); color: rgb(var(--ink-700));
    }
    .finding[data-kind='CONDITION'] { background: rgb(var(--critical-100)); color: rgb(var(--critical-700)); }
    .finding[data-kind='TREATMENT_REQUIRED'] { background: rgb(var(--caution-100)); color: rgb(var(--caution-700)); }
    .finding[data-kind='EXISTING'] { background: rgb(var(--petrol-100)); color: rgb(var(--petrol-700)); }
    .finding[data-kind='OBSERVATION'] { background: rgb(var(--ink-100)); color: rgb(var(--ink-600)); }
    .tooth-note { margin: 0.25rem 0 0; font-size: 0.8125rem; color: rgb(var(--ink-600)); font-style: italic; }

    .plain { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.375rem; }
    .plain li { font-size: 0.875rem; line-height: 1.45; }
    .cat {
      display: inline-block; font-size: 0.625rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.04em; background: rgb(var(--ink-100)); color: rgb(var(--ink-600));
      border-radius: 4px; padding: 0.0625rem 0.3125rem; margin-inline-end: 0.375rem;
    }
    .cat.tooth { background: rgb(var(--petrol-100)); color: rgb(var(--petrol-800)); }
    .allergy { display: flex; align-items: center; gap: 0.375rem; color: rgb(var(--critical-700)); font-weight: 600; }
    .allergy .material-icons { font-size: 1rem; }
    .empty { color: rgb(var(--ink-500)); font-size: 0.875rem; text-align: center; padding: 1.5rem 0; }

    .notes-section { margin-top: 0.25rem; padding-top: 1rem; border-top: 1px solid rgb(var(--ink-200)); }
    .notes-hint { margin: 0 0 0.5rem; font-size: 0.75rem; color: rgb(var(--ink-500)); line-height: 1.45; }
    .notes-input {
      width: 100%; box-sizing: border-box;
      border: 1px solid rgb(var(--ink-300)); border-radius: 8px;
      padding: 0.5rem 0.625rem; font-size: 0.875rem; font-family: inherit;
      color: rgb(var(--ink-900)); line-height: 1.5; resize: vertical;
    }
    .notes-input:focus {
      outline: 2px solid rgb(var(--petrol-300)); outline-offset: -1px;
      border-color: rgb(var(--petrol-400));
    }
    .notes-input::placeholder { color: rgb(var(--ink-500)); }

    .summary-footer { border-top: 1px solid rgb(var(--ink-200)); padding: 0.875rem 1.5rem 1.25rem; }
    .footer-note { margin: 0 0 0.75rem; font-size: 0.75rem; color: rgb(var(--ink-500)); line-height: 1.45; }
    .footer-actions { display: flex; gap: 0.5rem; justify-content: flex-end; }
  `],
})
export class VoiceSessionSummaryComponent {
  private readonly translate = inject(TranslateService);
  session = inject(VoiceSessionService);
  private toast = inject(ToastService);

  confirming = signal(false);
  /** Free-text remarks the doctor can append before signing off. */
  clinicianNotes = '';

  async confirm(): Promise<void> {
    this.confirming.set(true);
    try {
      await this.session.confirm(this.clinicianNotes.trim() || null);
      this.clinicianNotes = '';
      this.toast.success(this.translate.instant('VOICE.SUMMARY.CONFIRMED'));
    } catch {
      this.toast.error(this.translate.instant('VOICE.SUMMARY.CONFIRM_FAILED'));
    } finally {
      this.confirming.set(false);
    }
  }
}
