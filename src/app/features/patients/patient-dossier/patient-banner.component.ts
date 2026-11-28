import { Component, ElementRef, HostListener, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { ConsultationService } from '../../../core/consultation/consultation.service';
import { Appointment, Patient } from '../../../core/models/patient.model';
import { ClinicalRecordService } from '../../../core/services/clinical-record.service';
import { PermissionService } from '../../../core/services/permission.service';
import { VoiceSessionService } from '../../../core/voice/voice-session.service';
import { AlertStripComponent } from '../../../shared/components/medical-alerts/alert-strip.component';
import { AppDatePipe } from '../../../shared/pipes/app-date.pipe';
import { MoneyPipe } from '../../../shared/pipes/money.pipe';
import { IconComponent } from '../../../shared/ui/icon.component';
import { RegistrationInviteComponent } from '../registration-invite.component';
import { ConsultationMenuComponent } from './consultation-menu.component';

/** What the badge beside the name says, read from the same treatments as the summary. */
export interface PatientState {
  key: string;
  pill: 'pill-active' | 'pill-attention' | 'pill-done' | 'pill-idle';
}

/**
 * Whose file this is, what to know before touching them, and what to do next.
 *
 * - The name, the treatment state and the **medical alerts** on every tab (P0-2).
 * - **One main action**, Start consultation, in petrol; one secondary, Book appointment; the rest
 *   (registration link, print, edit, archive) in a More menu, Archive last and in red (P1-9, P0-7).
 * - It **stays in view**: once scrolled, it shrinks to one 48 px row with the name, the age, the
 *   alerts and Consultation, so the screen always says whose file it is (P0-3).
 */
@Component({
  selector: 'app-patient-banner',
  standalone: true,
  imports: [RouterLink, TranslateModule, AlertStripComponent, AppDatePipe, MoneyPipe, IconComponent, RegistrationInviteComponent, ConsultationMenuComponent],
  host: { '[class.is-compact]': 'compact()' },
  template: `
    <header class="pb" data-tour="dossier-banner">
      <div class="pb-row">
        <div class="pb-who">
          <h2 class="pb-name" [title]="fullName()">{{ fullName() }}</h2>
          @if (compact()) {
            @if (age() !== null) { <span class="pb-age">{{ 'PATIENTS.DOSSIER.AGE_SHORT' | translate: { age: age() } }}</span> }
          } @else {
            <span class="pill" [class]="'pill ' + state().pill">{{ state().key | translate }}</span>
          }
        </div>

        @if (compact()) {
          <app-alert-strip class="pb-alerts-inline" [alerts]="records.medicalAlerts()" [state]="records.alertsState()" [compact]="true"
                           (open)="openHistory.emit()" />
        }

        <div class="pb-actions no-print">
          <!-- Recording starts here and nowhere else: Start consultation. While one runs, its state takes the
               button's place; before the start (the drawer's ready bar) the button stays, since nothing records yet. -->
          @if (consultation.phase() === 'review') {
            <button type="button" class="btn btn-primary" data-banner-review (click)="openVoice.emit()">
              <app-icon name="clipboard-check" [size]="18" /> {{ 'CONSULTATION.REVIEW_BUTTON' | translate }}
            </button>
          } @else if (voiceSession.isActive()) {
            <button type="button" class="btn btn-recording" (click)="endSession.emit()" [disabled]="voiceSession.busy()">
              <app-icon name="stop-circle" [size]="18" />
              {{ (voiceSession.busy() ? 'VOICE.ENDING' : 'VOICE.END_AND_REVIEW') | translate }}
            </button>
          } @else if (voiceSession.reviewing()) {
            <button type="button" class="btn btn-primary" (click)="openVoice.emit()">
              <app-icon name="clipboard-check" [size]="18" /> {{ 'VOICE.REVIEWING' | translate }}
            </button>
          } @else if (consultation.isRecording()) {
            <button type="button" class="btn btn-primary" (click)="openVoice.emit()">
              <app-icon name="message" [size]="18" /> {{ 'CONSULTATION.IN_PROGRESS' | translate }}
            </button>
          } @else {
            <app-consultation-menu
              data-tour="dossier-consult"
              [consultationAvailable]="consultation.available()"
              [introHidden]="consultation.introHidden()"
              [starting]="starting()"
              (consultation)="startConsultation.emit()"
              (showIntro)="consultation.setIntroHidden(false)"
            />
          }

          @if (!compact()) {
            @if (canBook()) {
              <button type="button" class="btn btn-secondary" (click)="book.emit()">
                <app-icon name="calendar-plus" [size]="16" /><span class="pb-label">{{ 'PATIENTS.DOSSIER.BOOK' | translate }}</span>
              </button>
            }

            <div class="pb-more">
              <button #moreTrigger type="button" class="btn btn-ghost btn-icon" (click)="toggleMore()"
                      aria-haspopup="menu" [attr.aria-expanded]="moreOpen()" [attr.aria-controls]="moreOpen() ? 'patient-more-menu' : null"
                      [attr.aria-label]="'PATIENTS.DOSSIER.MORE' | translate" [title]="'PATIENTS.DOSSIER.MORE' | translate">
                <app-icon name="more" [size]="18" />
              </button>
              @if (moreOpen()) {
                <div #moreMenu id="patient-more-menu" class="pb-menu" role="menu" [attr.aria-label]="'PATIENTS.DOSSIER.MORE' | translate"
                     (keydown)="onMenuKeydown($event)">
                  @if (canWrite()) {
                    <button type="button" role="menuitem" tabindex="-1" class="pb-item" (click)="pick(); invite().create()">
                      <app-icon name="link" [size]="16" />{{ 'PAT.INVITE.BUTTON' | translate }}
                    </button>
                  }
                  <button type="button" role="menuitem" tabindex="-1" class="pb-item" (click)="pick(); print.emit()">
                    <app-icon name="print" [size]="16" />{{ 'COMMON.PRINT' | translate }}
                  </button>
                  @if (canWrite()) {
                    <a role="menuitem" tabindex="-1" class="pb-item" [routerLink]="['edit']" (click)="pick()">
                      <app-icon name="edit" [size]="16" />{{ 'PATIENTS.DOSSIER.EDIT_DETAILS' | translate }}
                    </a>
                  }
                  @if (canDelete()) {
                    <div class="pb-sep" role="separator"></div>
                    <button type="button" role="menuitem" tabindex="-1" class="pb-item pb-danger" (click)="pick(); archive.emit()">
                      <app-icon name="archive" [size]="16" />{{ 'PATIENTS.DOSSIER.UI.ARCHIVE' | translate }}
                    </button>
                  }
                </div>
              }
            </div>
          }
        </div>
      </div>

      @if (!compact()) {
        <app-alert-strip class="pb-alerts" [alerts]="records.medicalAlerts()" [state]="records.alertsState()" (open)="openHistory.emit()" />

        <dl class="pb-facts">
          <div><dt>{{ 'PATIENTS.DOSSIER.AGE' | translate }}</dt>
            <dd>@if (age() !== null) { {{ age() }} {{ 'PATIENTS.DOSSIER.YEARS' | translate }} } @else { — }</dd></div>
          <div><dt>{{ 'PATIENTS.DOSSIER.GENDER' | translate }}</dt>
            <dd>@if (patient().gender) { {{ 'PATIENTS.DOSSIER.GENDER_' + patient().gender | translate }} } @else { — }</dd></div>
          <div><dt>{{ 'PATIENTS.DOSSIER.PHONE' | translate }}</dt><dd><span class="ltr-data">{{ patient().phone || '—' }}</span></dd></div>
          <div><dt>{{ 'PATIENTS.DOSSIER.CIN' | translate }}</dt><dd><span class="ltr-data">{{ patient().cin || '—' }}</span></dd></div>
          <div><dt>{{ 'PATIENTS.DOSSIER.INSURANCE' | translate }}</dt><dd>{{ patient().insuranceProvider || ('PATIENTS.DOSSIER.PRIVATE' | translate) }}</dd></div>
          <div><dt>{{ 'PATIENTS.NEXT_APPOINTMENT' | translate }}</dt>
            <dd>
              @if (nextAppointment(); as appt) {
                {{ appt.dateTime | appDate:'datetime' }}
              } @else if (canBook()) {
                <button type="button" class="pb-link" (click)="book.emit()">{{ 'PATIENTS.DOSSIER.NO_UPCOMING_BOOK' | translate }}</button>
              } @else { <span class="pb-muted">{{ 'PATIENTS.DOSSIER.NO_UPCOMING_APPOINTMENT' | translate }}</span> }
            </dd></div>
          @if (balance() !== null) {
            <div><dt>{{ 'BILLING.OUTSTANDING' | translate }}</dt>
              <dd>
                @if (balance()! > 0) {
                  <button type="button" class="pb-link pb-due" (click)="openBilling.emit()">{{ balance() | money }}</button>
                } @else { <span class="pb-muted">{{ 0 | money }}</span> }
              </dd></div>
          }
          @if (pendingQuotes() > 0) {
            <div><dt>{{ 'QUOTE.TITLE' | translate }}</dt>
              <dd><button type="button" class="pb-link pb-quote" (click)="openBilling.emit()">{{ 'QUOTE.PENDING_BADGE' | translate: { count: pendingQuotes() } }}</button></dd></div>
          }
        </dl>
      }
    </header>

    <app-registration-invite [patientId]="patient().id" [name]="fullName()" [showButton]="false" />
  `,
  styles: [`
    :host { display: block; }
    .pb { padding: .75rem 1.25rem; }
    :host(.is-compact) .pb { padding-block: .375rem; min-height: 3rem; display: flex; align-items: center; }
    :host(.is-compact) .pb-row { width: 100%; margin: 0; }
    .pb-row { display: flex; align-items: center; gap: .75rem; min-width: 0; }
    .pb-who { display: flex; align-items: center; gap: .625rem; min-width: 0; flex: 0 1 auto; }
    /* In the one-row form the name keeps its room; the chips give way first. */
    :host(.is-compact) .pb-who { flex: 0 0 auto; max-width: 45%; }
    .pb-name { margin: 0; font-size: var(--text-xl); font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    :host(.is-compact) .pb-name { font-size: var(--text-md); }
    .pb-who .pill { flex: none; }
    .pb-age { flex: none; font-size: var(--text-sm); color: var(--text-muted); font-weight: 600; }
    .pb-alerts-inline { flex: 1 1 auto; min-width: 0; }
    .pb-actions { display: flex; align-items: center; gap: .5rem; margin-inline-start: auto; flex: none; }
    .pb-alerts { margin-top: .5rem; }
    .pb-label { white-space: nowrap; }
    .btn-recording { background: rgb(var(--critical-600)); color: rgb(var(--on-inverse)); border-color: transparent; }
    .btn-recording app-icon { animation: pb-pulse 1.6s ease-in-out infinite; }
    @keyframes pb-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .45; } }
    @media (prefers-reduced-motion: reduce) { .btn-recording app-icon { animation: none; } }

    .pb-more { position: relative; }
    .pb-menu {
      position: absolute; top: calc(100% + .375rem); inset-inline-end: 0; z-index: var(--z-overlay); min-width: 15rem;
      display: flex; flex-direction: column; padding: .375rem; border-radius: var(--radius-lg);
      background: var(--surface); border: 1px solid var(--border); box-shadow: var(--shadow-lg);
    }
    .pb-item {
      display: flex; align-items: center; gap: .625rem; width: 100%; min-height: 2.5rem; padding: .5rem .625rem;
      border: 0; border-radius: var(--radius-md); background: transparent; color: var(--text); font: inherit;
      font-size: var(--text-base); text-align: start; text-decoration: none; cursor: pointer;
    }
    .pb-item:hover, .pb-item:focus-visible { background: var(--surface-hover); outline: none; }
    .pb-item:focus-visible { box-shadow: inset 0 0 0 2px var(--focus-ring); }
    .pb-item app-icon { color: var(--text-muted); }
    .pb-danger, .pb-danger app-icon { color: rgb(var(--critical-700)); }
    .pb-sep { height: 1px; margin: .25rem 0; background: var(--border-subtle); }

    .pb-facts { display: flex; flex-wrap: wrap; gap: .5rem 1.75rem; margin: .75rem 0 0; }
    .pb-facts > div { display: flex; flex-direction: column; gap: .125rem; min-width: 0; }
    .pb-facts dt { font-size: var(--text-xs); font-weight: 650; color: var(--text-muted); }
    .pb-facts dd { margin: 0; font-size: var(--text-base); font-weight: 600; color: var(--text); }
    .pb-muted { color: var(--text-muted); font-weight: 500; }
    .pb-link { padding: 0; border: 0; background: none; font: inherit; font-weight: 600; color: var(--action-text); text-decoration: underline; cursor: pointer; }
    .pb-due { color: rgb(var(--critical-700)); }
    .pb-quote { color: rgb(var(--caution-700)); font-weight: 600; }

    /* Narrower: Book keeps its icon; on a phone the actions take their own row. */
    @media (max-width: 1279.98px) { .pb-label { display: none; } }
    @media (max-width: 767.98px) {
      .pb { padding: .75rem 1rem; }
      .pb-row { flex-wrap: wrap; }
      :host(:not(.is-compact)) .pb-actions { width: 100%; }
      :host(:not(.is-compact)) .pb-actions app-consultation-menu { flex: 1; }
      .pb-facts { gap: .5rem 1.25rem; }
      .pb-facts > div { flex: 1 1 40%; }
      :host(.is-compact) .pb-alerts-inline { display: none; }
    }
  `],
})
export class PatientBannerComponent {
  readonly patient = input.required<Patient>();
  readonly state = input.required<PatientState>();
  readonly nextAppointment = input<Appointment | null>(null);
  /** What the patient owes, or null when this person may not see billing. */
  readonly balance = input<number | null>(null);
  /** Devis handed to the patient and still waiting for an answer. */
  readonly pendingQuotes = input(0);
  readonly starting = input(false);
  /** The one-row form, once the page has scrolled. */
  readonly compact = input(false);

  readonly startConsultation = output<void>();
  readonly endSession = output<void>();
  readonly openVoice = output<void>();
  readonly openHistory = output<void>();
  readonly openBilling = output<void>();
  readonly book = output<void>();
  readonly print = output<void>();
  readonly archive = output<void>();

  protected readonly records = inject(ClinicalRecordService);
  protected readonly voiceSession = inject(VoiceSessionService);
  protected readonly consultation = inject(ConsultationService);
  private readonly permissions = inject(PermissionService);

  protected readonly canWrite = computed(() => this.permissions.can('PATIENT_WRITE'));
  protected readonly canDelete = computed(() => this.permissions.can('PATIENT_DELETE'));
  protected readonly canBook = computed(() => this.permissions.can('AGENDA_MANAGE'));

  protected readonly fullName = computed(() => `${this.patient().firstName} ${this.patient().lastName}`.trim());
  protected readonly age = computed(() => ageOn(this.patient().dateOfBirth));

  protected readonly invite = viewChild.required(RegistrationInviteComponent);
  protected readonly moreOpen = signal(false);
  private readonly moreTrigger = viewChild<ElementRef<HTMLButtonElement>>('moreTrigger');
  private readonly moreMenu = viewChild<ElementRef<HTMLElement>>('moreMenu');
  private readonly host = inject(ElementRef<HTMLElement>);

  constructor() {
    effect(() => (this.moreMenu()?.nativeElement.querySelector('[role=menuitem]') as HTMLElement | null)?.focus());
    // The compact row has no More menu: it must not stay open behind it.
    effect(() => { if (this.compact()) this.moreOpen.set(false); });
  }

  protected toggleMore(): void {
    this.moreOpen.set(!this.moreOpen());
  }

  protected pick(): void {
    this.moreOpen.set(false);
  }

  protected onMenuKeydown(event: KeyboardEvent): void {
    const items = Array.from(this.moreMenu()?.nativeElement.querySelectorAll<HTMLElement>('[role=menuitem]') ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    const go: Record<string, number> = { ArrowDown: at + 1, ArrowUp: at - 1 + items.length, Home: 0, End: items.length - 1 };
    if (event.key in go) {
      event.preventDefault();
      items[go[event.key] % items.length]?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.moreOpen.set(false);
      this.moreTrigger()?.nativeElement.focus();
    } else if (event.key === 'Tab') {
      this.moreOpen.set(false);
    }
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: MouseEvent): void {
    if (this.moreOpen() && !this.host.nativeElement.querySelector('.pb-more')?.contains(event.target as Node)) this.moreOpen.set(false);
  }
}

/** Whole years on `today`, or null without a usable date of birth. */
export function ageOn(dob: string | null | undefined, today: Date = new Date()): number | null {
  if (!dob) return null;
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return null;
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}
