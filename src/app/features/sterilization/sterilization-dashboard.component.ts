import { Component, computed, effect, inject, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { refreshOnLive } from '../../core/services/live-refresh';
import { ITEM_STATES, SterilDashboard, SterilizationApi } from '../../core/services/sterilization-api.service';
import { loadable } from '../../core/utils/loadable';
import { NumPipe } from '../../shared/pipes/money.pipe';
import { IconComponent } from '../../shared/ui/icon.component';
import { stateTone } from './item-actions.component';

/** Whether anything on the dashboard needs a person: a failed control is the one thing that must never wait. */
export function needsAttention(d: Pick<SterilDashboard, 'lubricationDue' | 'shelfLifeExceeded' | 'pendingControls' | 'endoAlerts'>): boolean {
  return d.lubricationDue.length + d.shelfLifeExceeded.length + d.pendingControls.length + d.endoAlerts.length > 0;
}

/**
 * The day's picture: how many items are sterile, in use, waiting to be cleaned or in the autoclave,
 * and what needs doing (handpieces to lubricate, sterile packs past their shelf life, cycles still
 * waiting for their control, endo files at their limit).
 */
@Component({
  selector: 'app-sterilization-dashboard',
  standalone: true,
  imports: [DatePipe, RouterLink, TranslateModule, NumPipe, IconComponent],
  template: `
    @if (data.data(); as d) {
      <section class="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4" [attr.aria-busy]="data.loading()" [attr.aria-label]="'STER.DASH.COUNTS' | translate">
        @for (s of states; track s) {
          <div class="tile p-4"><p class="kpi-label">{{ 'STER.STATES.' + s | translate }}</p>
            <p class="kpi-value"><span class="me-2 inline-block h-2.5 w-2.5 rounded-full align-middle" [class]="dot(s)" aria-hidden="true"></span>{{ d.counts[s] ?? 0 | num: 0 }}</p></div>
        }
      </section>

      @if (!attention()) {
        <div class="empty"><span class="empty-icon"><app-icon name="check-circle" [size]="20" /></span><p class="empty-title">{{ 'STER.DASH.ALL_GOOD' | translate }}</p></div>
      }

      <div class="grid gap-5 lg:grid-cols-2">
        @if (d.pendingControls.length) {
          <section class="card"><div class="card-head"><h2 class="card-title">{{ 'STER.DASH.PENDING_CONTROLS' | translate }}</h2></div>
            <ul class="divide-y divide-ink-100">@for (c of d.pendingControls; track c.id) {
              <li class="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"><span><strong>{{ c.autoclaveName }} · #{{ c.number }}</strong> <span class="text-ink-500">{{ c.startedAt | date: 'short' }} · {{ 'STER.CONTROL_TYPES.' + c.controlType | translate }} · {{ c.itemCount }}</span></span>
                <a class="btn btn-secondary btn-sm" routerLink="../cycles" [queryParams]="{ open: c.id }">{{ 'STER.DASH.RECORD_CONTROL' | translate }}</a></li> }</ul></section>
        }
        @if (d.shelfLifeExceeded.length) {
          <section class="card"><div class="card-head"><h2 class="card-title">{{ 'STER.DASH.SHELF_LIFE' | translate: { days: d.shelfLifeDays } }}</h2></div>
            <ul class="divide-y divide-ink-100">@for (i of d.shelfLifeExceeded; track i.id) {
              <li class="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"><span><strong class="mono">{{ i.code }}</strong> {{ i.name }}</span><span class="text-ink-500">{{ i.stateChangedAt | date: 'mediumDate' }}</span></li> }</ul></section>
        }
        @if (d.lubricationDue.length) {
          <section class="card"><div class="card-head"><h2 class="card-title">{{ 'STER.DASH.LUBRICATION' | translate }}</h2></div>
            <ul class="divide-y divide-ink-100">@for (i of d.lubricationDue; track i.id) {
              <li class="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"><span><strong class="mono">{{ i.code }}</strong> {{ i.name }}</span><span class="text-ink-500">{{ i.lastLubricatedAt ? (i.lastLubricatedAt | date: 'mediumDate') : ('STER.DASH.NEVER' | translate) }}</span></li> }</ul></section>
        }
        @if (d.endoAlerts.length) {
          <section class="card"><div class="card-head"><h2 class="card-title">{{ 'STER.DASH.ENDO' | translate }}</h2><a class="btn btn-ghost btn-sm" routerLink="../endo">{{ 'STER.TABS.ENDO' | translate }}</a></div>
            <ul class="divide-y divide-ink-100">@for (a of d.endoAlerts; track a.fileId) {
              <li class="px-4 py-2.5 text-sm"><strong>{{ a.kitName }}</strong> — {{ a.modelName }} <span class="text-critical-700">{{ a.useCount }} / {{ a.maxUses }}</span></li> }</ul></section>
        }
      </div>
    }
  `,
  styles: [`
    .kpi-label { font-size: var(--text-2xs); font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-muted); }
    .kpi-value { margin-top: 0.25rem; font-size: var(--text-2xl); font-weight: 800; color: var(--text); font-variant-numeric: tabular-nums; }
    .card-title { font-size: var(--text-md); font-weight: 700; color: var(--text); }
  `],
})
export class SterilizationDashboardComponent {
  private readonly api = inject(SterilizationApi);

  protected readonly states = ITEM_STATES;
  protected readonly data = loadable<SterilDashboard | null>(null);
  protected readonly attention = computed(() => (this.data.data() ? needsAttention(this.data.data()!) : false));

  constructor() {
    effect(() => {
      untracked(() => void this.data.load(() => this.api.dashboard()));
    });
    refreshOnLive(['sterilization'], () => void this.data.load(() => this.api.dashboard()));
  }

  protected dot(state: (typeof ITEM_STATES)[number]): string {
    return { READY: 'bg-positive-500', USED: 'bg-critical-500', DIRTY: 'bg-caution-500', PROCESSED: 'bg-petrol-500' }[state];
  }
}
