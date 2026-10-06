import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { ApiErrors } from '../../core/services/api-error.service';
import { SterilItem, SterilizationApi, TraceEntry } from '../../core/services/sterilization-api.service';
import { PatientPickerComponent, PickedPatient } from '../../shared/ui/patient-picker.component';

/** Entries grouped by calendar day, newest day first, so a long history reads as days rather than a wall of rows. */
export function byDay(entries: readonly TraceEntry[]): { day: string; entries: TraceEntry[] }[] {
  const days = new Map<string, TraceEntry[]>();
  for (const e of [...entries].sort((a, b) => b.at.localeCompare(a.at))) {
    const day = e.at.slice(0, 10);
    days.set(day, [...(days.get(day) ?? []), e]);
  }
  return [...days].map(([day, list]) => ({ day, entries: list }));
}

/**
 * Both directions of traceability. From a patient: every instrument, tray and handpiece used on
 * them, with the autoclave cycle each came from and how its control ended. From an item: where it
 * has been, who it was used on, and which cycles it went through.
 */
@Component({
  selector: 'app-sterilization-trace',
  standalone: true,
  imports: [DatePipe, FormsModule, RouterLink, TranslateModule, PatientPickerComponent],
  template: `
    <div class="mb-5 flex flex-wrap items-end gap-3">
      <div class="seg" role="group" [attr.aria-label]="'STER.TABS.TRACE' | translate">
        <button type="button" class="seg-item" [class.is-active]="mode() === 'patient'" [attr.aria-pressed]="mode() === 'patient'" (click)="mode.set('patient')">{{ 'STER.TRACE.BY_PATIENT' | translate }}</button>
        <button type="button" class="seg-item" [class.is-active]="mode() === 'item'" [attr.aria-pressed]="mode() === 'item'" (click)="mode.set('item')">{{ 'STER.TRACE.BY_ITEM' | translate }}</button>
      </div>
      @if (mode() === 'patient') {
        <div class="field w-80 max-w-full"><span class="label">{{ 'COMMON.PATIENT' | translate }}</span><app-patient-picker [value]="patient()" (valueChange)="patient.set($event)" [label]="'COMMON.PATIENT' | translate" /></div>
      } @else {
        <label class="field w-80 max-w-full"><span class="label">{{ 'STER.TRACE.ITEM' | translate }}</span>
          <select class="select" [ngModel]="itemId()" (ngModelChange)="itemId.set($event)">
            <option value="">—</option>@for (i of items(); track i.id) { <option [value]="i.id">{{ i.code }} — {{ i.name }}</option> }
          </select></label>
      }
    </div>

    @if (!target()) {
      <p class="rounded-md bg-ink-50 p-4 text-sm text-ink-600">{{ (mode() === 'patient' ? 'STER.TRACE.PICK_PATIENT' : 'STER.TRACE.PICK_ITEM') | translate }}</p>
    } @else {
      <div [attr.aria-busy]="loading()">
        @for (group of days(); track group.day) {
          <section class="mb-4">
            <h3 class="mb-1.5 text-sm font-semibold text-ink-700">{{ group.day + 'T12:00:00' | date: 'fullDate' }}</h3>
            <ul class="card divide-y divide-ink-100">
              @for (e of group.entries; track e.eventId) {
                <li class="px-4 py-2.5 text-sm">
                  <p class="font-semibold text-ink-900">{{ e.at | date: 'shortTime' }} · {{ 'STER.ACTION_NAMES.' + e.action | translate }} — <span class="mono">{{ e.itemCode }}</span> {{ e.itemName }}</p>
                  <p class="text-ink-600">
                    @if (mode() === 'item' && e.patientName) { <a class="text-ink-900 no-underline hover:underline" [routerLink]="['/patients', e.patientId]">{{ e.patientName }}</a> <span class="mono text-xs text-ink-500">{{ e.patientCode }}</span> · }
                    @if (e.cycleNumber) { {{ 'STER.TRACE.CYCLE' | translate }} #{{ e.cycleNumber }} · {{ e.autoclaveName }}@if (e.controlResult) { · <span [class.text-critical-700]="e.controlResult === 'FAILED'" [class.font-semibold]="e.controlResult === 'FAILED'">{{ 'STER.RESULTS.' + e.controlResult | translate }}</span> } · }
                    @if (e.performedBy) { {{ e.performedBy }} }
                    @if (e.note) { · {{ e.note }} }
                  </p>
                </li>
              }
            </ul>
          </section>
        } @empty {
          @if (!loading()) { <p class="py-8 text-center text-ink-500">{{ 'STER.TRACE.EMPTY' | translate }}</p> }
        }
      </div>
    }
  `,
})
export class SterilizationTraceComponent {
  private readonly api = inject(SterilizationApi);
  private readonly errors = inject(ApiErrors);

  protected readonly mode = signal<'patient' | 'item'>('patient');
  protected readonly patient = signal<PickedPatient | null>(null);
  protected readonly itemId = signal('');
  protected readonly items = signal<SterilItem[]>([]);
  protected readonly entries = signal<TraceEntry[]>([]);
  protected readonly loading = signal(false);
  protected readonly target = computed(() => (this.mode() === 'patient' ? this.patient()?.id : this.itemId()) || null);
  protected readonly days = computed(() => byDay(this.entries()));

  constructor() {
    this.api.items({ includeRetired: true }).then(i => this.items.set(i)).catch(() => undefined);
    effect(() => {
      const mode = this.mode();
      const target = this.target();
      untracked(() => void this.load(mode, target));
    });
  }

  private async load(mode: 'patient' | 'item', target: string | null): Promise<void> {
    this.entries.set([]);
    if (!target) {
      return;
    }
    this.loading.set(true);
    try {
      const entries = await (mode === 'patient' ? this.api.traceByPatient(target) : this.api.traceByItem(target));
      if (this.target() === target) {
        this.entries.set(entries);
      }
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.loading.set(false);
    }
  }
}
