import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { ApiErrors } from '../../core/services/api-error.service';
import { SterilItem, SterilizationApi } from '../../core/services/sterilization-api.service';
import { IconComponent } from '../../shared/ui/icon.component';
import { QrScannerComponent } from '../../shared/ui/qr-scanner.component';
import { CycleCreateRequest, SterilizationHandoff } from './sterilization-handoff.service';
import { ItemActionsComponent, stateTone } from './item-actions.component';

/** Adds `item` to the front of `basket`, or moves it there if it is already in: scanning the same label twice is one item. */
export function addToBasket(basket: readonly SterilItem[], item: SterilItem): SterilItem[] {
  return [item, ...basket.filter(i => i.id !== item.id)];
}

/** The items of a basket that can go into an autoclave cycle (dirty ones; the others would be refused). */
export function loadableItems(basket: readonly SterilItem[]): SterilItem[] {
  return basket.filter(i => i.nextActions.includes('ADD_TO_CYCLE'));
}

/**
 * Scan an item's QR label with the camera, or type its code (a USB barcode reader types too),
 * and get what can be done with it right there: use it on the patient in the chair, send it to
 * cleaning, lubricate it. Everything scanned stays in a list, and what is ready for the autoclave
 * can be loaded into a cycle in one go.
 */
@Component({
  selector: 'app-scan',
  standalone: true,
  imports: [FormsModule, TranslateModule, IconComponent, QrScannerComponent, ItemActionsComponent],
  template: `
    <div class="grid gap-5 lg:grid-cols-[22rem_1fr]">
      <section class="card card-pad space-y-3">
        <h2 class="text-base font-bold text-ink-900">{{ 'STER.SCAN.TITLE' | translate }}</h2>
        <form class="flex gap-2" (ngSubmit)="submitCode()">
          <label class="field flex-1"><span class="sr-only">{{ 'STER.SCAN.CODE' | translate }}</span>
            <input class="input" name="code" autocomplete="off" autofocus [placeholder]="'STER.SCAN.CODE' | translate" [ngModel]="code()" (ngModelChange)="code.set($event)" /></label>
          <button type="submit" class="btn btn-primary" [disabled]="busy() || !code().trim()">{{ 'STER.SCAN.FIND' | translate }}</button>
        </form>
        <button type="button" class="btn btn-secondary w-full" [attr.aria-pressed]="camera()" (click)="camera.set(!camera())"><app-icon name="camera" [size]="16" /> {{ (camera() ? 'STER.SCAN.STOP_CAMERA' : 'STER.SCAN.START_CAMERA') | translate }}</button>
        <app-qr-scanner [active]="camera()" (scanned)="found($event)" />
        <p class="text-xs text-ink-500">{{ 'STER.SCAN.HINT' | translate }}</p>
      </section>

      <section>
        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-base font-bold text-ink-900">{{ 'STER.SCAN.BASKET' | translate }} <span class="text-ink-500">({{ basket().length }})</span></h2>
          <span class="flex gap-2">
            @if (loadableCount() > 0) { <button type="button" class="btn btn-primary btn-sm" (click)="startCycle()">{{ 'STER.SCAN.START_CYCLE' | translate: { count: loadableCount() } }}</button> }
            @if (basket().length) { <button type="button" class="btn btn-ghost btn-sm" (click)="basket.set([])">{{ 'STER.SCAN.CLEAR' | translate }}</button> }
          </span>
        </div>
        <ul class="space-y-2" aria-live="polite">
          @for (i of basket(); track i.id) {
            <li class="card p-4">
              <div class="flex flex-wrap items-start justify-between gap-2">
                <div><p class="font-bold text-ink-900"><span class="mono">{{ i.code }}</span> · {{ i.name }}</p><p class="text-xs text-ink-500">{{ 'STER.KINDS.' + i.kind | translate }}@if (i.serialNumber) { · {{ i.serialNumber }} }</p></div>
                <span class="pill" [class]="'pill ' + tone(i.state)">{{ 'STER.STATES.' + i.state | translate }}</span>
              </div>
              @if (!i.active) { <p class="mt-2 text-sm text-critical-700">{{ 'STER.SCAN.RETIRED' | translate }}</p> }
              @else if (i.lubricationDue) { <p class="mt-2 text-sm text-caution-700">{{ 'STER.SCAN.LUBRICATION_DUE' | translate }}</p> }
              <div class="mt-3"><app-item-actions [item]="i" (changed)="replace($event)" (addToCycle)="startCycleWith($event)" /></div>
            </li>
          } @empty {
            <li class="empty"><span class="empty-icon"><app-icon name="qr-code" [size]="20" /></span><p class="empty-title">{{ 'STER.SCAN.EMPTY' | translate }}</p></li>
          }
        </ul>
      </section>
    </div>
  `,
})
export class ScanComponent {
  private readonly api = inject(SterilizationApi);
  private readonly errors = inject(ApiErrors);
  private readonly handoff = inject(SterilizationHandoff);
  private readonly router = inject(Router);

  protected readonly tone = stateTone;
  protected readonly code = signal('');
  protected readonly camera = signal(false);
  protected readonly busy = signal(false);
  protected readonly basket = signal<SterilItem[]>([]);

  protected loadableCount(): number {
    return loadableItems(this.basket()).length;
  }

  protected submitCode(): void {
    const code = this.code().trim();
    if (code) {
      void this.found(code);
      this.code.set('');
    }
  }

  protected async found(code: string): Promise<void> {
    this.busy.set(true);
    try {
      const item = await this.api.scan(code);
      this.basket.update(b => addToBasket(b, item));
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.busy.set(false);
    }
  }

  protected replace(updated: SterilItem): void {
    this.basket.update(b => b.map(i => (i.id === updated.id ? updated : i)));
  }

  protected startCycle(): void {
    this.startCycleWith(...loadableItems(this.basket()));
  }

  protected startCycleWith(...items: SterilItem[]): void {
    this.handoff.request.set({ itemIds: items.map(i => i.id) } satisfies CycleCreateRequest);
    void this.router.navigate(['/sterilization/cycles']);
  }
}
