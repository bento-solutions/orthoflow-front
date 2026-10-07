import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { StockService } from '../../../../core/services/stock.service';
import { Treatment, TreatmentConsumable, StockItem } from '../../../../core/models/stock.model';
import { ConfirmDialogService } from '../../../../core/services/confirm-dialog.service';
import { ToastService } from '../../../../core/services/toast.service';

@Component({
  selector: 'app-treatments-list',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule],
  template: `
    <div class="p-6 max-w-7xl mx-auto space-y-6">
      
      <!-- Top Title Bar -->
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 class="text-3xl font-bold tracking-tight text-ink-900">{{ "TREATMENTS.PAGE_TITLE" | translate }}</h1>
          <p class="text-sm text-ink-500">{{ "TREATMENTS.PAGE_SUBTITLE" | translate }}</p>
        </div>
        <div class="flex items-center gap-3">
          <button type="button" (click)="openAddModal()" class="flex items-center gap-2 px-4 py-2.5 bg-petrol-600 text-white font-medium rounded-xl hover:bg-petrol-700 transition shadow-sm">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            {{ "TREATMENTS.ADD_NEW_TREATMENT" | translate }}
          </button>
        </div>
      </div>

      <!-- Treatments Grid / Catalog -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        @for (t of treatments(); track t.id) {
          <div class="bg-white rounded-2xl border border-ortho-navy/5 shadow-sm p-6 hover:shadow-md transition duration-300 flex flex-col justify-between space-y-4">
            
            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <span class="px-2.5 py-0.5 bg-ortho-navy/5 text-ink-900 font-mono text-xs font-bold rounded-lg border border-ortho-navy/10 uppercase">{{ t.code }}</span>
                <div class="flex items-center gap-1.5">
                  <button type="button" (click)="openEditModal(t)" class="p-1 hover:bg-ortho-navy/5 text-ink-600 hover:text-ink-900 rounded transition">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>
                  </button>
                  <button type="button" (click)="deleteTreatment(t)" class="p-1 hover:bg-red-50 text-red-600/60 hover:text-red-600 rounded transition">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                  </button>
                </div>
              </div>

              <h3 class="font-bold text-lg text-ink-900 tracking-tight leading-tight">{{ t.name }}</h3>
              
              @if (t.actCode) {
                <p class="text-xs text-ink-500 font-semibold">{{ "TREATMENTS.ACT_CODE" | translate }}: <span class="font-mono text-ink-700">{{ t.actCode }}</span>@if (t.actCoefficient != null) { · {{ "TREATMENTS.ACT_COEFFICIENT" | translate }} <span class="text-ink-700">{{ t.actCoefficient }}</span> }</p>
              }
              <div class="flex items-baseline gap-1.5 pt-1">
                <span class="text-xs text-ink-500 font-semibold uppercase tracking-wide">{{ "TREATMENTS.BASE_PRICE" | translate }}:</span>
                <span class="text-lg font-extrabold text-ink-900">{{ t.basePrice | number:'1.2-2' }} DH</span>
              </div>
            </div>

            <!-- Consumables list summary -->
            <div class="border-t border-ortho-navy/5 pt-4 space-y-2 flex-1">
              <span class="text-[10px] font-bold text-ink-500 uppercase tracking-wider block">{{ "TREATMENTS.CONSUMABLES" | translate }} ({{ t.consumables?.length || 0 }})</span>

              <div class="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                @for (c of t.consumables; track $index) {
                  <div class="flex items-center justify-between text-xs font-semibold text-ink-700 bg-gray-50 border border-gray-100 rounded-lg p-2">
                    <span class="truncate max-w-[150px]">{{ c.stockItem?.name }}</span>
                    <div class="flex items-center gap-2 shrink-0">
                      <span class="font-bold text-ink-500">x{{ c.quantityUsed }}</span>
                      <span class="text-emerald-600 font-extrabold">{{ (c.quantityUsed * c.stockItem.pricePerUse) | number:'1.2-2' }} DH</span>
                    </div>
                  </div>
                } @empty {
                  <span class="text-xs text-ink-400 block py-1">{{ "TREATMENTS.NO_CONSUMABLES_CONFIGURED" | translate }}</span>
                }
              </div>
            </div>

            <!-- Cumulative cost summary -->
            <div class="border-t border-ortho-navy/5 pt-3 flex justify-between items-center text-xs">
              <span class="text-ink-500 font-bold uppercase tracking-wider">{{ "TREATMENTS.MATERIALS_COST" | translate }}</span>
              <span class="font-bold text-emerald-600">{{ getConsumablesTotal(t) | number:'1.2-2' }} DH</span>
            </div>

          </div>
        } @empty {
          <div class="col-span-full bg-white rounded-2xl border border-ortho-navy/5 shadow-sm p-12 text-center text-ink-500">
            {{ "TREATMENTS.NO_TREATMENTS_CONFIGURED" | translate }}
          </div>
        }
      </div>

      <!-- Add/Edit Modal -->
      @if (showModal()) {
        <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ortho-navy/60 backdrop-blur-sm">
          <div class="bg-white rounded-2xl max-w-xl w-full overflow-hidden border border-ortho-navy/5 shadow-2xl animate-fade-in flex flex-col max-h-[85vh]">
            <div class="px-6 py-4 border-b border-ortho-navy/5 flex items-center justify-between bg-ortho-navy/[0.01] shrink-0">
              <h3 class="text-lg font-bold text-ink-900">{{ editMode() ? ("TREATMENTS.EDIT_TREATMENT_PROCEDURE" | translate) : ("TREATMENTS.ADD_TREATMENT_PROCEDURE" | translate) }}</h3>
              <button type="button" (click)="closeModal()" class="p-1 text-ink-500 hover:text-ink-900 hover:bg-ortho-navy/5 rounded-lg transition">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>
            
            <div class="flex-1 overflow-y-auto p-6 space-y-4">
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label class="block text-xs font-bold text-ink-500 uppercase tracking-wide mb-1">{{ "TREATMENTS.PROCEDURE_CODE" | translate }} *</label>
                  <input type="text" [(ngModel)]="form.code" [placeholder]="'TREATMENTS.PROCEDURE_CODE_PLACEHOLDER' | translate" required class="w-full px-3 py-2 border border-ortho-navy/10 rounded-xl text-sm focus:outline-none focus:border-petrol-600 transition font-mono uppercase bg-white" />
                </div>
                <div>
                  <label class="block text-xs font-bold text-ink-500 uppercase tracking-wide mb-1">{{ "TREATMENTS.BASE_PRICE_DH" | translate }} *</label>
                  <input type="number" [(ngModel)]="form.basePrice" required min="0" class="w-full px-3 py-2 border border-ortho-navy/10 rounded-xl text-sm focus:outline-none focus:border-petrol-600 transition bg-white" />
                </div>
              </div>

              <div>
                <label class="block text-xs font-bold text-ink-500 uppercase tracking-wide mb-1">{{ "TREATMENTS.PROCEDURE_NAME" | translate }} *</label>
                <input type="text" [(ngModel)]="form.name" required class="w-full px-3 py-2 border border-ortho-navy/10 rounded-xl text-sm focus:outline-none focus:border-petrol-600 transition bg-white" />
              </div>

              <div>
                <div class="grid grid-cols-2 gap-4">
                  <div>
                    <label class="block text-xs font-bold text-ink-500 uppercase tracking-wide mb-1" for="act-code">{{ "TREATMENTS.ACT_CODE" | translate }}</label>
                    <input id="act-code" type="text" maxlength="30" [(ngModel)]="form.actCode" class="w-full px-3 py-2 border border-ortho-navy/10 rounded-xl text-sm focus:outline-none focus:border-petrol-600 transition font-mono bg-white" />
                  </div>
                  <div>
                    <label class="block text-xs font-bold text-ink-500 uppercase tracking-wide mb-1" for="act-coefficient">{{ "TREATMENTS.ACT_COEFFICIENT" | translate }}</label>
                    <input id="act-coefficient" type="number" min="0" step="any" [(ngModel)]="form.actCoefficient" class="w-full px-3 py-2 border border-ortho-navy/10 rounded-xl text-sm focus:outline-none focus:border-petrol-600 transition bg-white" />
                  </div>
                </div>
                <p class="mt-1.5 text-xs text-ink-500">{{ "TREATMENTS.ACT_HINT" | translate }}</p>
              </div>

              <!-- Consumables Configurator -->
              <div class="space-y-3">
                <div class="flex items-center justify-between border-b border-ortho-navy/5 pb-2">
                  <span class="text-xs font-bold text-ink-500 uppercase tracking-wide">{{ "TREATMENTS.STANDARD_MATERIAL_TEMPLATE" | translate }}</span>
                  <button type="button" (click)="addConsumableLine()" class="px-2.5 py-1 text-xs font-semibold bg-petrol-600 text-white hover:bg-petrol-700 transition rounded-lg">
                    + {{ "TREATMENTS.ADD_MATERIAL" | translate }}
                  </button>
                </div>

                <div class="space-y-3">
                  @for (c of formConsumables; track $index; let idx = $index) {
                    <div class="grid grid-cols-12 gap-3 items-end bg-gray-50/50 p-3 rounded-xl border border-gray-100 font-semibold text-xs text-ink-900">
                      <div class="col-span-6">
                        <label class="block text-[10px] font-bold text-ink-600 uppercase mb-1">{{ "TREATMENTS.STOCK_ITEM" | translate }}</label>
                        <select [(ngModel)]="c.stockItem" (change)="onItemChange(idx)" class="w-full px-2.5 py-1.5 border border-ortho-navy/10 rounded-lg text-xs bg-white focus:outline-none">
                          <option [value]="null">{{ "TREATMENTS.SELECT_ITEM" | translate }}</option>
                          @for (item of catalogItems(); track item.id) {
                            <option [ngValue]="item">{{ item.name }} ({{ "STOCK.SKU" | translate }}: {{ item.sku }})</option>
                          }
                        </select>
                      </div>
                      <div class="col-span-2">
                        <label class="block text-[10px] font-bold text-ink-600 uppercase mb-1">{{ "TREATMENTS.QTY_USED" | translate }}</label>
                        <input type="number" [(ngModel)]="c.quantityUsed" min="0.0001" step="any" class="w-full px-2.5 py-1.5 border border-ortho-navy/10 rounded-lg text-xs bg-white text-center focus:outline-none font-mono" />
                      </div>
                      <div class="col-span-3 text-right">
                        <span class="block text-[10px] font-bold text-ink-600 uppercase mb-1">{{ "TREATMENTS.MATERIALS_COST" | translate }}</span>
                        <span class="font-bold text-emerald-600 block py-1.5 text-xs">{{ (c.quantityUsed * (c.stockItem?.pricePerUse || 0)) | number:'1.2-2' }} DH</span>
                      </div>
                      <div class="col-span-1 text-center">
                        <button type="button" (click)="removeConsumableLine(idx)" class="p-1.5 hover:bg-red-50 text-red-600 rounded-lg transition mb-1">
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </button>
                      </div>
                    </div>
                  }
                </div>

                <div class="flex justify-end pt-3 border-t border-ortho-navy/5">
                  <div class="text-right">
                    <span class="text-xs font-bold text-ink-500 uppercase tracking-wider block">{{ "TREATMENTS.CUMULATIVE_MATERIAL_COST" | translate }}</span>
                    <span class="text-lg font-bold text-emerald-600">{{ formCumulativeCost() | number:'1.2-2' }} DH</span>
                  </div>
                </div>
              </div>
            </div>

            <div class="px-6 py-4 border-t border-ortho-navy/5 flex items-center justify-end gap-3 bg-ortho-navy/[0.01] shrink-0">
              <button type="button" (click)="closeModal()" class="px-4 py-2 border border-ortho-navy/10 rounded-xl text-sm font-semibold hover:bg-gray-50 transition text-ink-600">{{ "COMMON.CANCEL" | translate }}</button>
              <button type="button" (click)="saveTreatment()" [disabled]="!form.code || !form.name || !form.basePrice" class="px-5 py-2 bg-petrol-600 text-white rounded-xl text-sm font-semibold hover:bg-petrol-700 transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">{{ "TREATMENTS.SAVE_TREATMENT" | translate }}</button>
            </div>
          </div>
        </div>
      }

    </div>
  `,
  styles: [`
    .animate-fade-in {
      animation: fadeIn 0.25s ease-out forwards;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: scale(0.95); }
      to { opacity: 1; transform: scale(1); }
    }
  `]
})
export class TreatmentsListComponent implements OnInit {
  private stockService = inject(StockService);
  private confirmDialog = inject(ConfirmDialogService);
  private toast = inject(ToastService);

  readonly treatments = signal<Treatment[]>([]);
  readonly catalogItems = signal<StockItem[]>([]);

  // Modal controls
  readonly showModal = signal(false);
  readonly editMode = signal(false);
  form: Partial<Treatment> = {};
  formConsumables: TreatmentConsumable[] = [];

  // Compute total material cost for active form lines
  readonly formCumulativeCost = computed(() => {
    return this.formConsumables.reduce((acc, curr) => {
      const p = curr.stockItem?.pricePerUse || 0;
      return acc + (curr.quantityUsed * p);
    }, 0);
  });

  ngOnInit() {
    this.loadAllData();
  }

  loadAllData() {
    this.stockService.getTreatments().subscribe(data => this.treatments.set(data));
    this.stockService.getStockItems().subscribe(data => this.catalogItems.set(data));
  }

  getConsumablesTotal(t: Treatment): number {
    if (!t.consumables) return 0;
    return t.consumables.reduce((acc, curr) => acc + (curr.quantityUsed * curr.stockItem.pricePerUse), 0);
  }

  openAddModal() {
    this.editMode.set(false);
    this.form = {
      code: '',
      name: '',
      basePrice: 0
    };
    this.formConsumables = [];
    this.addConsumableLine();
    this.showModal.set(true);
  }

  openEditModal(t: Treatment) {
    this.editMode.set(true);
    this.form = { ...t };
    // Clone lines so edits don't affect original data instantly
    this.formConsumables = t.consumables ? t.consumables.map(c => ({ ...c })) : [];
    this.showModal.set(true);
  }

  closeModal() {
    this.showModal.set(false);
  }

  addConsumableLine() {
    this.formConsumables.push({
      stockItem: null as any,
      quantityUsed: 1
    });
  }

  removeConsumableLine(idx: number) {
    this.formConsumables.splice(idx, 1);
  }

  onItemChange(idx: number) {
    // Optional callbacks if needed
  }

  saveTreatment() {
    if (!this.form.code || !this.form.name || !this.form.basePrice) {
      return;
    }

    // A blank box means "not set", which the server stores as no code and no coefficient.
    this.form.actCode = this.form.actCode?.trim() || undefined;
    if (this.form.actCoefficient == null || (this.form.actCoefficient as unknown) === '') this.form.actCoefficient = undefined;

    // Attach mapped lines
    this.form.consumables = this.formConsumables
      .filter(c => c.stockItem && c.stockItem.id)
      .map(c => ({
        stockItem: { id: c.stockItem.id, pricePerUse: c.stockItem.pricePerUse } as StockItem,
        quantityUsed: c.quantityUsed
      }));

    if (this.editMode()) {
      this.stockService.updateTreatment(this.form.id!, this.form).subscribe(() => {
        this.loadAllData();
        this.closeModal();
      });
    } else {
      this.stockService.createTreatment(this.form).subscribe(() => {
        this.loadAllData();
        this.closeModal();
      });
    }
  }

  async deleteTreatment(t: Treatment) {
    const confirmed = await this.confirmDialog.confirm(
      `Are you sure you want to delete treatment procedure '${t.name}'?`,
      { danger: true, confirmLabel: 'Delete' }
    );
    if (!confirmed) return;

    this.stockService.deleteTreatment(t.id!).subscribe({
      next: () => {
        this.toast.success('Treatment procedure deleted.');
        this.loadAllData();
      },
      error: (err) => {
        this.toast.error(err.error?.detail || err.error?.message || 'Could not delete the treatment procedure.');
      }
    });
  }
}
