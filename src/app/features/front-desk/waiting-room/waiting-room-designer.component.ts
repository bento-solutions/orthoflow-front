import { ChangeDetectionStrategy, Component, ElementRef, EventEmitter, Input, Output, ViewChild, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ApiErrors } from '../../../core/services/api-error.service';
import { ConfirmDialogService } from '../../../core/services/confirm-dialog.service';
import { PermissionService } from '../../../core/services/permission.service';
import { loadable } from '../../../core/utils/loadable';
import { IconComponent } from '../../../shared/ui/icon.component';
import { FrontDeskApi, SeatOccupant, WaitingCard, WaitingRoomLayout } from '../front-desk-api.service';
import { WaitingRoomFurnitureComponent } from './furniture.component';
import { SeatMarkerComponent } from './seat-marker.component';
import {
  FurnitureKind,
  GRID,
  ROOM_HEIGHT,
  ROOM_WIDTH,
  SEAT_CAPACITIES,
  clampSeats,
  clampToRoom,
  moduleSize,
  overlaps,
  rotatedSize,
  seatCentreInRoom,
  snap,
} from './furniture-geometry';

/** A module as the designer holds it: the stored shape plus a key that survives being unsaved. */
interface PlacedModule {
  key: string;
  id: string | null;
  kind: FurnitureKind;
  seats: number;
  x: number;
  y: number;
  rotation: number;
}

/** A seat resolved to a point on the plan, with whoever is in it. */
interface RenderedSeat {
  key: string;
  seatId: string;
  moduleKey: string;
  index: number;
  x: number;
  y: number;
  occupant: SeatOccupant | null;
}

type Mode = 'live' | 'edit';

/**
 * The waiting room as a plan you can draw on, and as a board you can read.
 *
 * <p>Two modes that deliberately do not overlap. In live mode the furniture is inert —
 * it is a picture of the room, and the only thing you can do to it is seat somebody. Edit
 * mode is the designer: drag, turn, resize, duplicate, delete, against a working copy
 * that is not written anywhere until Save. Cancel throws the copy away.
 *
 * <p>Occupancy is never part of that working copy. Seating a patient is its own call and
 * takes effect immediately, which is why it is disabled while the layout is being edited:
 * the seat you are assigning to might be about to move.
 */
@Component({
  selector: 'app-waiting-room-designer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, TranslateModule, IconComponent, WaitingRoomFurnitureComponent, SeatMarkerComponent],
  template: `
    <section class="card">
      <div class="card-head flex-wrap gap-3">
        <h2 class="text-lg font-bold text-ink-900">
          {{ 'FD.WR.TITLE' | translate }}
          <span class="pill pill-active ms-1">{{ occupiedCount() }} / {{ totalSeats() }}</span>
        </h2>
        <div class="flex flex-wrap items-center gap-1">
          <button type="button" class="btn btn-ghost btn-icon" (click)="zoomBy(-0.15)" [attr.aria-label]="'FD.WR.ZOOM_OUT' | translate">
            <app-icon name="minus" [size]="16" />
          </button>
          <span class="w-12 text-center text-xs font-bold tabular-nums text-ink-500">{{ zoomPercent() }}%</span>
          <button type="button" class="btn btn-ghost btn-icon" (click)="zoomBy(0.15)" [attr.aria-label]="'FD.WR.ZOOM_IN' | translate">
            <app-icon name="plus" [size]="16" />
          </button>
          <button type="button" class="btn btn-ghost btn-sm" (click)="resetView()">{{ 'FD.WR.RESET_VIEW' | translate }}</button>

          @if (canManage()) {
            @if (mode() === 'live') {
              <button type="button" class="btn btn-secondary btn-sm ms-2" (click)="startEditing()">
                <app-icon name="edit" [size]="15" /> {{ 'FD.WR.EDIT' | translate }}
              </button>
            } @else {
              <button type="button" class="btn btn-ghost btn-sm ms-2" (click)="cancelEditing()">{{ 'COMMON.CANCEL' | translate }}</button>
              <button type="button" class="btn btn-primary btn-sm" [disabled]="saving()" (click)="save()">
                {{ (saving() ? 'COMMON.LOADING' : 'FD.WR.SAVE') | translate }}
              </button>
            }
          }
        </div>
      </div>

      @if (blocked().length) {
        <p class="mx-5 mt-4 rounded-lg bg-critical-50 px-3 py-2 text-sm text-critical-700" role="alert">{{ blocked() }}</p>
      }

      <!-- ── Add seating: a bar across the top, so the plan keeps the full frame ── -->
      @if (mode() === 'edit') {
        <div class="flex flex-wrap items-end gap-x-5 gap-y-3 border-b border-ink-100 px-5 py-4"
             role="group" [attr.aria-label]="'FD.WR.ADD_TITLE' | translate">
          <div class="me-auto">
            <h3 class="text-sm font-bold text-ink-900">{{ 'FD.WR.ADD_TITLE' | translate }}</h3>
            <p class="mt-0.5 text-xs text-ink-500">{{ 'FD.WR.ADD_HINT' | translate }}</p>
          </div>

          <div class="flex gap-2">
            @for (k of kinds; track k) {
              <button
                type="button"
                class="rounded-xl border-2 px-3 py-2 text-center transition"
                [class.border-petrol-500]="pickKind() === k"
                [class.bg-petrol-50]="pickKind() === k"
                [class.border-ink-200]="pickKind() !== k"
                (click)="pickKind.set(k)"
                [attr.aria-pressed]="pickKind() === k"
              >
                <svg class="mx-auto block" [attr.width]="76" [attr.height]="26" [attr.viewBox]="previewBox(k)">
                  <svg:g appWrFurniture [kind]="k" [seats]="pickSeats()" [muted]="pickKind() !== k" />
                </svg>
                <span class="mt-1 block text-2xs font-bold text-ink-700">{{ 'FD.WR.KIND.' + k | translate }}</span>
              </button>
            }
          </div>

          <div>
            <p class="mb-1 text-2xs font-bold uppercase tracking-wider text-ink-500">{{ 'FD.WR.CAPACITY' | translate }}</p>
            <div class="flex gap-1" role="group" [attr.aria-label]="'FD.WR.CAPACITY' | translate">
              @for (n of capacities; track n) {
                <button
                  type="button"
                  class="h-9 w-9 rounded-lg border text-sm font-bold transition"
                  [class.border-petrol-500]="pickSeats() === n"
                  [class.bg-petrol-500]="pickSeats() === n"
                  [class.text-white]="pickSeats() === n"
                  [class.border-ink-200]="pickSeats() !== n"
                  [class.text-ink-700]="pickSeats() !== n"
                  (click)="pickSeats.set(n)"
                  [attr.aria-pressed]="pickSeats() === n"
                >
                  {{ n }}
                </button>
              }
            </div>
          </div>

          <button type="button" class="btn btn-primary btn-sm" (click)="add()">
            <app-icon name="plus" [size]="15" />
            {{ 'FD.WR.ADD_' + pickKind() + (pickSeats() === 1 ? '_ONE' : '') | translate: { count: pickSeats() } }}
          </button>

          <!-- ── The selected module, inline so the plan never jumps ── -->
          @if (selected(); as s) {
            <div class="flex items-end gap-2 rounded-xl border border-ink-200 px-3 py-2">
              <div>
                <p class="mb-1 text-2xs font-bold uppercase tracking-wider text-ink-500">
                  {{ 'FD.WR.SELECTED' | translate }} · {{ 'FD.WR.KIND.' + s.kind | translate }}
                </p>
                <div class="flex gap-1">
                  @for (n of capacities; track n) {
                    <button
                      type="button"
                      class="h-8 w-8 rounded-lg border text-xs font-bold"
                      [class.border-petrol-500]="s.seats === n"
                      [class.bg-petrol-50]="s.seats === n"
                      [class.border-ink-200]="s.seats !== n"
                      (click)="resize(s, n)"
                    >
                      {{ n }}
                    </button>
                  }
                </div>
              </div>
              <button type="button" class="btn btn-secondary btn-sm" (click)="rotate(s)">
                <app-icon name="refresh" [size]="14" /> {{ 'FD.WR.ROTATE' | translate }}
              </button>
              <button type="button" class="btn btn-secondary btn-sm" (click)="duplicate(s)">{{ 'FD.WR.DUPLICATE' | translate }}</button>
              <button type="button" class="btn btn-ghost btn-sm text-critical-700" (click)="remove(s)">{{ 'COMMON.DELETE' | translate }}</button>
            </div>
          }

          <button type="button" class="btn btn-ghost btn-sm text-critical-700" [disabled]="!modules().length" (click)="clearAll()">
            {{ 'FD.WR.CLEAR' | translate }}
          </button>
        </div>
      }

      <div class="p-5">
          <div class="relative overflow-auto rounded-xl border border-ink-200 bg-ink-50/40 p-3">
            <svg
              #canvas
              class="mx-auto block touch-none select-none"
              [attr.width]="ROOM_WIDTH * zoom()"
              [attr.height]="ROOM_HEIGHT * zoom()"
              [attr.viewBox]="'0 0 ' + ROOM_WIDTH + ' ' + ROOM_HEIGHT"
              (pointermove)="onPointerMove($event)"
              (pointerup)="endDrag()"
              (pointerleave)="endDrag()"
              (pointercancel)="endDrag()"
              role="group"
              [attr.aria-label]="'FD.WR.TITLE' | translate"
            >
              <defs>
                <pattern id="wr-grid" [attr.width]="GRID" [attr.height]="GRID" patternUnits="userSpaceOnUse">
                  <path [attr.d]="'M ' + GRID + ' 0 L 0 0 0 ' + GRID" fill="none" stroke="rgb(var(--ink-200))" stroke-width="0.5" />
                </pattern>
              </defs>
              <rect [attr.width]="ROOM_WIDTH" [attr.height]="ROOM_HEIGHT" fill="white" />
              @if (mode() === 'edit') {
                <rect [attr.width]="ROOM_WIDTH" [attr.height]="ROOM_HEIGHT" fill="url(#wr-grid)" />
              }
              <rect
                [attr.width]="ROOM_WIDTH - 1"
                [attr.height]="ROOM_HEIGHT - 1"
                x="0.5"
                y="0.5"
                fill="none"
                stroke="rgb(var(--ink-300))"
                stroke-width="1"
                rx="8"
              />

              @for (m of modules(); track m.key) {
                <g
                  [attr.transform]="transformFor(m)"
                  [class.is-editable]="mode() === 'edit'"
                  [class.is-selected]="selectedKey() === m.key"
                  [class.is-colliding]="collisions().has(m.key)"
                  class="module"
                  (pointerdown)="startDrag($event, m)"
                >
                  <!-- Hit area first, so thin outlines are still easy to grab. -->
                  <rect
                    class="hit"
                    [attr.width]="moduleSize(m).w"
                    [attr.height]="moduleSize(m).h"
                    rx="6"
                  />
                  <svg:g appWrFurniture [kind]="m.kind" [seats]="m.seats" />
                </g>
              }

              <!-- Markers sit above every module so a seat is never hidden by its neighbour. -->
              @for (s of seats(); track s.key) {
                <g [attr.transform]="'translate(' + s.x + ',' + s.y + ')'">
                  @if (s.occupant) {
                    <g
                      class="seat seat-taken"
                      (pointerenter)="hovered.set(s)"
                      (pointerleave)="hovered.set(null)"
                      (click)="onSeatClick(s)"
                      role="button"
                      tabindex="0"
                      [attr.aria-label]="s.occupant.patientName"
                    >
                      @if (highlighted === s.occupant.appointmentId) { <circle class="seat-ring" r="15" /> }
                      <svg:g appWrSeatMarker [gender]="s.occupant.gender" />
                    </g>
                  } @else if (assigningFor()) {
                    <!-- Assignment in progress: free seats light up and become targets. -->
                    <circle class="seat seat-free-target" r="11" (click)="placeHere(s)" role="button" tabindex="0"
                            [attr.aria-label]="'FD.WR.ASSIGN_HERE' | translate" />
                  } @else {
                    <circle class="seat seat-free" r="3.5" />
                  }
                </g>
              }
            </svg>

            @if (hovered(); as h) {
              @if (h.occupant; as o) {
                <div class="pointer-events-none absolute left-3 top-3 z-10 max-w-xs rounded-lg bg-ink-900/95 px-3 py-2 text-xs text-white shadow-lg" role="tooltip">
                  <p class="font-bold">{{ o.patientName || '—' }}</p>
                  <p class="mt-1 text-ink-200">{{ 'FD.WR.TIP_APPOINTMENT' | translate }}: {{ o.scheduledFor | date: 'shortTime' }}</p>
                  <p class="text-ink-200">{{ 'FD.WR.TIP_ARRIVED' | translate }}: {{ o.arrivedAt | date: 'shortTime' }}</p>
                  <p class="text-ink-200">{{ 'FD.WR.TIP_WAITING' | translate }}: {{ o.waitMinutes }} min</p>
                  <p class="text-ink-200">{{ 'FD.WR.TIP_TREATMENT' | translate }}: {{ o.typeName || '—' }}</p>
                </div>
              }
            }

            @if (!modules().length) {
              <p class="absolute inset-x-0 top-1/2 -translate-y-1/2 px-6 text-center text-sm text-ink-500">
                {{ 'FD.WR.EMPTY' | translate }}
              </p>
            }
          </div>

          @if (assigningFor(); as a) {
            <p class="mt-3 flex items-center justify-between gap-3 rounded-lg bg-petrol-50 px-3 py-2 text-sm text-petrol-800">
              <span>{{ 'FD.WR.PICK_SEAT_FOR' | translate }} <strong>{{ a.patientName }}</strong></span>
              <button type="button" class="btn btn-ghost btn-sm" (click)="assigningFor.set(null)">{{ 'COMMON.CANCEL' | translate }}</button>
            </p>
          }
      </div>
    </section>
  `,
  styles: [
    `
      .module .hit {
        fill: transparent;
      }
      .module.is-editable {
        cursor: grab;
      }
      .module.is-editable:active {
        cursor: grabbing;
      }
      .module.is-selected .hit {
        fill: rgb(var(--petrol-500) / 0.08);
        stroke: rgb(var(--petrol-500));
        stroke-width: 1.5;
        stroke-dasharray: 4 3;
      }
      .module.is-colliding .hit {
        fill: rgb(var(--critical-500, 220 38 38) / 0.1);
        stroke: rgb(var(--critical-500, 220 38 38));
        stroke-width: 1.5;
      }
      .seat-free {
        fill: rgb(var(--ink-300));
      }
      .seat-free-target {
        fill: rgb(var(--positive-500) / 0.18);
        stroke: rgb(var(--positive-500));
        stroke-width: 1.5;
        cursor: pointer;
      }
      .seat-taken {
        cursor: pointer;
      }
      .seat-ring {
        fill: none;
        stroke: rgb(var(--petrol-500));
        stroke-width: 2;
        stroke-dasharray: 3 3;
      }
    `,
  ],
})
export class WaitingRoomDesignerComponent {
  private readonly api = inject(FrontDeskApi);
  private readonly errors = inject(ApiErrors);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly permissions = inject(PermissionService);
  private readonly translate = inject(TranslateService);

  /** The appointment the list is pointing at, so its seat can be ringed on the plan. */
  @Input() highlighted: string | null = null;
  /** Raised whenever occupancy changed, so the board's figures can be refetched. */
  @Output() readonly changed = new EventEmitter<void>();
  /** Raised when an occupied seat is clicked, so the list can highlight that patient. */
  @Output() readonly seatPicked = new EventEmitter<string>();

  protected readonly ROOM_WIDTH = ROOM_WIDTH;
  protected readonly ROOM_HEIGHT = ROOM_HEIGHT;
  protected readonly GRID = GRID;
  protected readonly capacities = SEAT_CAPACITIES;
  protected readonly kinds: FurnitureKind[] = ['BENCH', 'SOFA'];

  protected readonly layout = loadable<WaitingRoomLayout | null>(null);
  protected readonly mode = signal<Mode>('live');
  protected readonly draft = signal<PlacedModule[]>([]);
  protected readonly selectedKey = signal<string | null>(null);
  protected readonly pickKind = signal<FurnitureKind>('BENCH');
  protected readonly pickSeats = signal(3);
  /**
   * The plan is drawn at 70% by default: at 1:1 the room dominated the screen and pushed
   * the waiting list below the fold. The stored coordinates are unaffected — this is only
   * how big it is drawn, and the zoom buttons still reach 1:1 and past it.
   */
  protected readonly zoom = signal(0.7);
  protected readonly saving = signal(false);
  protected readonly blocked = signal('');
  protected readonly hovered = signal<RenderedSeat | null>(null);
  protected readonly assigningFor = signal<WaitingCard | null>(null);

  protected readonly canManage = computed(() => this.permissions.can('WAITING_ROOM_MANAGE'));

  /** Stored modules in live mode, the unsaved working copy while editing. */
  protected readonly modules = computed<PlacedModule[]>(() =>
    this.mode() === 'edit'
      ? this.draft()
      : (this.layout.data()?.furniture ?? []).map(f => ({
          key: f.id,
          id: f.id,
          kind: f.kind as FurnitureKind,
          seats: f.seatCount,
          x: f.x,
          y: f.y,
          rotation: f.rotation,
        })),
  );

  protected readonly totalSeats = computed(() => this.modules().reduce((n, m) => n + m.seats, 0));
  protected readonly occupiedCount = computed(() => (this.layout.data()?.occupants ?? []).length);
  protected readonly selected = computed(() => this.modules().find(m => m.key === this.selectedKey()) ?? null);

  /** Every seat on the plan, placed and matched to whoever is in it. */
  protected readonly seats = computed<RenderedSeat[]>(() => {
    const bySeatId = new Map((this.layout.data()?.occupants ?? []).map(o => [o.seatId, o]));
    const editing = this.mode() === 'edit';
    return this.modules().flatMap(m =>
      Array.from({ length: m.seats }, (_, i) => {
        const p = seatCentreInRoom(m.kind, m.seats, m.rotation, { x: m.x, y: m.y }, i);
        const seatId = m.id ? `${m.id}#${i}` : '';
        return {
          key: `${m.key}#${i}`,
          seatId,
          moduleKey: m.key,
          index: i,
          x: p.x,
          y: p.y,
          // While the plan is being redrawn the markers would be chasing furniture
          // around, so the room is shown empty and seating is disabled.
          occupant: editing ? null : (bySeatId.get(seatId) ?? null),
        };
      }),
    );
  });

  /** Modules sharing floor with another — flagged rather than forbidden, so a drag stays fluid. */
  protected readonly collisions = computed(() => {
    const placed = this.modules().map(m => ({ key: m.key, origin: { x: m.x, y: m.y }, size: this.rotatedSize(m) }));
    const hit = new Set<string>();
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        if (overlaps(placed[i], placed[j])) {
          hit.add(placed[i].key);
          hit.add(placed[j].key);
        }
      }
    }
    return hit;
  });

  constructor() {
    void this.reload();
  }

  async reload(): Promise<void> {
    await this.layout.load(() => this.api.waitingRoomLayout());
  }

  // ── Geometry for the template ──

  protected moduleSize(m: PlacedModule) {
    return moduleSize(m.kind, m.seats);
  }

  private rotatedSize(m: PlacedModule) {
    return rotatedSize(m.kind, m.seats, m.rotation);
  }

  /** Place at the top-left, then turn about the module's own middle. */
  protected transformFor(m: PlacedModule): string {
    const own = moduleSize(m.kind, m.seats);
    const box = this.rotatedSize(m);
    const offsetX = m.x + (box.w - own.w) / 2;
    const offsetY = m.y + (box.h - own.h) / 2;
    return `translate(${offsetX},${offsetY}) rotate(${m.rotation},${own.w / 2},${own.h / 2})`;
  }

  protected previewBox(kind: FurnitureKind): string {
    const { w, h } = moduleSize(kind, this.pickSeats());
    return `-2 -2 ${w + 4} ${h + 4}`;
  }

  protected zoomPercent = computed(() => Math.round(this.zoom() * 100));

  protected zoomBy(by: number): void {
    this.zoom.update(z => Math.min(1.6, Math.max(0.4, Math.round((z + by) * 100) / 100)));
  }

  protected resetView(): void {
    this.zoom.set(0.7);
  }

  // ── Editing ──

  protected startEditing(): void {
    this.draft.set(this.modules().map(m => ({ ...m })));
    this.blocked.set('');
    this.assigningFor.set(null);
    this.mode.set('edit');
  }

  protected cancelEditing(): void {
    this.draft.set([]);
    this.selectedKey.set(null);
    this.blocked.set('');
    this.mode.set('live');
  }

  protected add(): void {
    const kind = this.pickKind();
    const seats = clampSeats(this.pickSeats());
    const key = `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const size = rotatedSize(kind, seats, 0);
    // Drop it somewhere free rather than always on top of the last one.
    const origin = this.freeSpot(size);
    this.draft.update(list => [...list, { key, id: null, kind, seats, x: origin.x, y: origin.y, rotation: 0 }]);
    this.selectedKey.set(key);
  }

  private freeSpot(size: { w: number; h: number }): { x: number; y: number } {
    const placed = this.draft().map(m => ({ origin: { x: m.x, y: m.y }, size: this.rotatedSize(m) }));
    for (let y = GRID * 2; y + size.h <= ROOM_HEIGHT; y += GRID * 4) {
      for (let x = GRID * 2; x + size.w <= ROOM_WIDTH; x += GRID * 4) {
        const candidate = { origin: { x, y }, size };
        if (!placed.some(p => overlaps(candidate, p))) {
          return { x, y };
        }
      }
    }
    return { x: GRID * 2, y: GRID * 2 };
  }

  protected resize(m: PlacedModule, seats: number): void {
    const next = clampSeats(seats);
    this.patch(m.key, cur => {
      const clamped = clampToRoom({ x: cur.x, y: cur.y }, rotatedSize(cur.kind, next, cur.rotation));
      return { ...cur, seats: next, x: clamped.x, y: clamped.y };
    });
  }

  protected rotate(m: PlacedModule): void {
    this.patch(m.key, cur => {
      const rotation = (cur.rotation + 90) % 360;
      const clamped = clampToRoom({ x: cur.x, y: cur.y }, rotatedSize(cur.kind, cur.seats, rotation));
      return { ...cur, rotation, x: clamped.x, y: clamped.y };
    });
  }

  protected duplicate(m: PlacedModule): void {
    const key = `new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const origin = this.freeSpot(rotatedSize(m.kind, m.seats, m.rotation));
    this.draft.update(list => [...list, { ...m, key, id: null, x: origin.x, y: origin.y }]);
    this.selectedKey.set(key);
  }

  protected remove(m: PlacedModule): void {
    this.draft.update(list => list.filter(x => x.key !== m.key));
    this.selectedKey.set(null);
  }

  protected async clearAll(): Promise<void> {
    const ok = await this.confirm.confirm(this.translate.instant('FD.WR.CLEAR_CONFIRM'), { danger: true });
    if (ok) {
      this.draft.set([]);
      this.selectedKey.set(null);
    }
  }

  private patch(key: string, change: (m: PlacedModule) => PlacedModule): void {
    this.draft.update(list => list.map(m => (m.key === key ? change(m) : m)));
  }

  // ── Dragging ──

  private drag: { key: string; dx: number; dy: number } | null = null;

  protected startDrag(event: PointerEvent, m: PlacedModule): void {
    this.selectedKey.set(m.key);
    if (this.mode() !== 'edit') {
      return;
    }
    const p = this.toRoom(event);
    this.drag = { key: m.key, dx: p.x - m.x, dy: p.y - m.y };
    (event.target as Element).setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  protected onPointerMove(event: PointerEvent): void {
    if (!this.drag) {
      return;
    }
    const p = this.toRoom(event);
    const d = this.drag;
    this.patch(d.key, cur =>
      // Free movement while the pointer is down, snapped on release: smooth to drag,
      // tidy once dropped.
      ({ ...cur, ...clampToRoom({ x: p.x - d.dx, y: p.y - d.dy }, rotatedSize(cur.kind, cur.seats, cur.rotation)) }),
    );
  }

  protected endDrag(): void {
    const d = this.drag;
    this.drag = null;
    if (!d) {
      return;
    }
    this.patch(d.key, cur => {
      const snapped = { x: snap(cur.x), y: snap(cur.y) };
      return { ...cur, ...clampToRoom(snapped, rotatedSize(cur.kind, cur.seats, cur.rotation)) };
    });
  }

  @ViewChild('canvas') private canvasRef?: ElementRef<SVGSVGElement>;

  /**
   * Screen point to room units.
   *
   * <p>Via the canvas's own screen matrix, which is exact whatever the zoom, the page
   * scroll or the pane width. The earlier version read {@code event.currentTarget},
   * which on pointerdown is the module being grabbed rather than the canvas: the scale
   * came out as the module's width over the room's, so the very first move threw the
   * furniture into a corner.
   */
  private toRoom(event: PointerEvent): { x: number; y: number } {
    const svg = this.canvasRef?.nativeElement;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) {
      return { x: 0, y: 0 };
    }
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }

  // ── Saving ──

  protected async save(): Promise<void> {
    this.saving.set(true);
    this.blocked.set('');
    try {
      const saved = await this.api.saveWaitingRoomLayout({
        waitingRoomId: this.layout.data()?.waitingRoomId,
        furniture: this.draft().map((m, i) => ({
          id: m.id ?? undefined,
          kind: m.kind,
          seatCount: m.seats,
          x: Math.round(m.x),
          y: Math.round(m.y),
          rotation: m.rotation,
          displayOrder: i,
        })),
      });
      this.layout.data.set(saved);
      this.draft.set([]);
      this.selectedKey.set(null);
      this.mode.set('live');
      this.changed.emit();
    } catch (error) {
      // A 409 here means the plan would strand somebody; the server says who, and that
      // is far more use than a generic failure toast.
      const message = this.conflictMessage(error);
      if (message) {
        this.blocked.set(message);
      } else {
        this.errors.report(error);
      }
    } finally {
      this.saving.set(false);
    }
  }

  private conflictMessage(error: unknown): string {
    const e = error as { status?: number; error?: { message?: string; detail?: string } };
    if (e?.status !== 409) {
      return '';
    }
    return e.error?.message || e.error?.detail || '';
  }

  // ── Seating people ──

  /** Begins assignment for a waiting patient; free seats become targets. */
  beginAssign(card: WaitingCard): void {
    if (this.mode() === 'edit') {
      return;
    }
    this.assigningFor.set(card);
  }

  protected async placeHere(seat: RenderedSeat): Promise<void> {
    const card = this.assigningFor();
    const m = this.modules().find(x => x.key === seat.moduleKey);
    if (!card || !m?.id) {
      return;
    }
    try {
      this.layout.data.set(await this.api.assignSeat({ appointmentId: card.appointmentId, furnitureId: m.id, seatIndex: seat.index }));
      this.assigningFor.set(null);
      this.changed.emit();
    } catch (error) {
      this.errors.report(error);
    }
  }

  protected onSeatClick(seat: RenderedSeat): void {
    if (seat.occupant) {
      this.seatPicked.emit(seat.occupant.appointmentId);
    }
  }

  async release(appointmentId: string): Promise<void> {
    try {
      this.layout.data.set(await this.api.releaseSeat(appointmentId));
      this.changed.emit();
    } catch (error) {
      this.errors.report(error);
    }
  }
}
