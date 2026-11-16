import { StockNavComponent } from '../../stock-nav.component';
import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { StockService } from '../../../../core/services/stock.service';
import { SalesOrder, SalesOrderLine, StockItem, SOStatus } from '../../../../core/models/stock.model';
import { Patient } from '../../../../core/models/patient.model';
import { MoneyPipe } from '../../../../shared/pipes/money.pipe';
import { AppDatePipe } from '../../../../shared/pipes/app-date.pipe';

import { RouterLinkActive } from '@angular/router';
import { ConfirmDialogService } from '../../../../core/services/confirm-dialog.service';
import { ToastService } from '../../../../core/services/toast.service';
import { DialogDirective } from '../../../../shared/ui/dialog.directive';
import { PatientPickerComponent, PickedPatient } from '../../../../shared/ui/patient-picker.component';

@Component({
  selector: 'app-sales-orders',
  standalone: true,
  imports: [StockNavComponent, AppDatePipe, MoneyPipe, DialogDirective, CommonModule, FormsModule, TranslateModule, PatientPickerComponent],
  template: `
    <div class="space-y-6">
      
      <!-- Top Title Bar -->
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div class="flex items-center gap-3">
          <button type="button" (click)="openCreateSOModal()" class="btn btn-primary">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            {{ "STOCK.RECORD_DIRECT_SALE" | translate }}
          </button>
        </div>
      </div>

      <!-- Module Navigation Pills -->
      <app-stock-nav />


      <!-- Sales Orders Registry -->
      <div class="card overflow-hidden">
        
        <div class="p-4 border-b border-petrol-900/5 bg-petrol-900/[0.01] flex items-center justify-between">
          <h2 class="text-base font-bold text-ink-900">{{ "STOCK.SALES_ORDERS_HISTORY" | translate }}</h2>
          <span class="text-xs text-ink-500 font-medium">{{ "STOCK.SALES_ORDERS_HISTORY_SUBTITLE" | translate }}</span>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-start border-collapse text-sm">
            <thead>
              <tr class="bg-petrol-900/[0.02] text-ink-500 font-semibold border-b border-petrol-900/5">
                <th scope="col" class="p-4">{{ "STOCK.SO_NUMBER" | translate }}</th>
                <th scope="col" class="p-4">{{ "STOCK.PATIENT_NAME" | translate }}</th>
                <th scope="col" class="p-4">{{ "STOCK.PURCHASE_DATE" | translate }}</th>
                <th scope="col" class="p-4 text-center">{{ "STOCK.STATUS" | translate }}</th>
                <th scope="col" class="p-4">{{ "STOCK.SOLD_ITEMS" | translate }}</th>
                <th scope="col" class="p-4 text-end">{{ "STOCK.TOTAL_AMOUNT" | translate }}</th>
                <th scope="col" class="p-4 text-end">{{ "STOCK.ACTIONS" | translate }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-petrol-900/5">
              @for (so of salesOrders(); track so.id) {
                <tr class="hover:bg-petrol-900/[0.01] transition">
                  <td class="p-4 font-mono text-xs font-bold text-ink-900">{{ so.soNumber }}</td>
                  <td class="p-4">
                    <div class="font-bold text-ink-900">{{ so.patient?.firstName }} {{ so.patient?.lastName }}</div>
                    <div class="text-xs text-ink-500">{{ "STOCK.EMAIL_LABEL" | translate }}: <span class="ltr-data">{{ so.patient?.email }}</span></div>
                  </td>
                  <td class="p-4 text-ink-500 font-medium">{{ so.createdAt | appDate:'datetime' }}</td>
                  <td class="p-4 text-center">
                    <span class="px-2.5 py-1 text-xs font-bold rounded-full border uppercase" [ngClass]="getSOStatusClasses(so.status!)">
                      {{ ('STATUS.' + so.status) | translate }}
                    </span>
                  </td>
                  <td class="p-4">
                    <div class="flex flex-col gap-1">
                      @for (line of so.lines; track line.id) {
                        <div class="text-xs text-ink-600">
                          • {{ line.stockItem?.name }}: <span class="font-bold text-ink-900">{{ line.quantity }}</span> {{ "STOCK.UNITS" | translate }}
                        </div>
                      }
                    </div>
                  </td>
                  <td class="p-4 text-end font-bold text-ink-900">{{ so.totalAmount | money }}</td>
                  <td class="p-4 text-end">
                    <div class="flex items-center justify-end gap-2">
                      @if (so.status === 'DRAFT') {
                        <button type="button" (click)="confirmSale(so)" class="btn btn-secondary btn-sm">
                          {{ "STOCK.CONFIRM_SALE" | translate }}
                        </button>
                        <button type="button" (click)="cancelSale(so)" class="btn btn-secondary text-critical-700 btn-sm">
                          {{ "STOCK.CANCEL" | translate }}
                        </button>
                      }
                      <button [attr.aria-label]="'COMMON.DELETE' | translate" type="button" (click)="deleteSale(so)" class="btn btn-ghost btn-icon text-critical-700" [disabled]="so.status === 'CONFIRMED'">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                      </button>
                    </div>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="7" class="p-8 text-center text-ink-500">{{ "STOCK.NO_SALES_ORDERS_FOUND" | translate }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>

      <!-- Create Sales Order Modal -->
      @if (showSOCreationModal()) {
        <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-petrol-900/60 backdrop-blur-sm">
          <div appDialog="so-create-title" (dialogClosed)="closeCreateSOModal()" class="card max-w-2xl w-full overflow-hidden shadow-2xl animate-fade-in flex flex-col max-h-[85vh]">
            <div class="px-6 py-4 border-b border-petrol-900/5 flex items-center justify-between bg-petrol-900/[0.01] shrink-0">
              <h2 id="so-create-title" class="text-lg font-bold text-ink-900">{{ "STOCK.RECORD_DIRECT_SALE" | translate }}</h2>
              <button [attr.aria-label]="'COMMON.CLOSE' | translate" type="button" (click)="closeCreateSOModal()" class="btn btn-ghost btn-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>
            
            <div class="flex-1 overflow-y-auto p-6 space-y-4">
              <!-- Select Patient -->
              <div>
                <span class="block text-xs font-bold text-ink-500 uppercase tracking-wide mb-1">{{ "STOCK.SELECT_PATIENT" | translate }} <span aria-hidden="true">*</span></span>
                <!-- Searched on the server as you type: a dropdown of every patient stopped at the first 200 (audit P1). -->
                <app-patient-picker [value]="pickedPatient()" (valueChange)="pickPatient($event)" [label]="'STOCK.SELECT_PATIENT' | translate" />
              </div>

              <!-- Lines Editor -->
              @if (selectedPatientId) {
                <div class="space-y-3">
                  <div class="flex items-center justify-between border-b border-petrol-900/5 pb-2">
                    <span class="text-xs font-bold text-ink-500 uppercase tracking-wide">{{ "STOCK.SALES_LINES" | translate }}</span>
                    <button type="button" (click)="addSOLine()" class="btn btn-primary btn-sm">
                      + {{ "STOCK.ADD_ITEM" | translate }}
                    </button>
                  </div>

                  <div class="space-y-3">
                    @for (line of lines; track $index; let idx = $index) {
                      <div class="grid grid-cols-12 gap-3 items-end bg-ink-50/50 p-3 rounded-xl border border-ink-100 font-medium">
                        <div class="col-span-5">
                          <label [attr.for]="'sales-orders-line-stockItem-' + $index" class="block text-xs font-bold text-ink-600 uppercase mb-1">{{ "STOCK.CATALOG_ITEM" | translate }}</label>
                          <select [id]="'sales-orders-line-stockItem-' + $index" [(ngModel)]="line.stockItem" (change)="onItemChange(idx)" class="select w-full">
                            <option [value]="null">{{ "STOCK.SELECT_ITEM_PLACEHOLDER" | translate }}</option>
                            @for (item of catalogItems(); track item.id) {
                              <option [ngValue]="item">{{ item.name }} ({{ 'STOCK.UI.SKU' | translate }} {{ item.sku }}) - {{ 'STOCK.UI.IN_STOCK' | translate: { count: item.currentStock } }}</option>
                            }
                          </select>
                        </div>
                        <div class="col-span-2">
                          <label [attr.for]="'sales-orders-line-quantity-' + $index" class="block text-xs font-bold text-ink-600 uppercase mb-1">{{ "STOCK.QUANTITY" | translate }}</label>
                          <input [id]="'sales-orders-line-quantity-' + $index" type="number" [(ngModel)]="line.quantity" (change)="calculateSOTotal()" min="1" class="input w-full text-center" />
                        </div>
                        <div class="col-span-2">
                          <label [attr.for]="'sales-orders-line-unitPrice-' + $index" class="block text-xs font-bold text-ink-600 uppercase mb-1">{{ "STOCK.UNIT_PRICE" | translate }}</label>
                          <input [id]="'sales-orders-line-unitPrice-' + $index" type="number" [(ngModel)]="line.unitPrice" (change)="calculateSOTotal()" min="0" class="input w-full text-end" />
                        </div>
                        <div class="col-span-2 text-end">
                          <span class="block text-xs font-bold text-ink-600 uppercase mb-1">{{ "STOCK.TOTAL" | translate }}</span>
                          <span class="font-bold text-xs text-ink-900 block py-1.5">{{ (line.quantity * line.unitPrice) | money }}</span>
                        </div>
                        <div class="col-span-1 text-center">
                          <button [attr.aria-label]="'COMMON.DELETE' | translate" type="button" (click)="removeSOLine(idx)" class="btn btn-ghost btn-icon text-critical-700 mb-1">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                          </button>
                        </div>
                      </div>
                    }
                  </div>

                  <div class="flex justify-end pt-3 border-t border-petrol-900/5">
                    <div class="text-end">
                      <span class="text-xs font-bold text-ink-500 uppercase tracking-wider block">{{ "STOCK.GRAND_TOTAL" | translate }}</span>
                      <span class="text-xl font-bold text-ink-900">{{ total | money }}</span>
                    </div>
                  </div>
                </div>
              }
            </div>

            <div class="px-6 py-4 border-t border-petrol-900/5 flex items-center justify-end gap-3 bg-petrol-900/[0.01] shrink-0">
              <button type="button" (click)="closeCreateSOModal()" class="btn btn-secondary">{{ "STOCK.CANCEL" | translate }}</button>
              <button type="button" (click)="saveSO()" [disabled]="!selectedPatientId || lines.length === 0" class="btn btn-primary">{{ "STOCK.SAVE_SALE_DRAFT" | translate }}</button>
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
export class SalesOrdersComponent implements OnInit {
  private readonly translate = inject(TranslateService);
  private stockService = inject(StockService);
  private confirmDialog = inject(ConfirmDialogService);
  private toast = inject(ToastService);

  readonly salesOrders = signal<SalesOrder[]>([]);
  readonly pickedPatient = signal<PickedPatient | null>(null);
  readonly catalogItems = signal<StockItem[]>([]);

  // Create Modal control
  readonly showSOCreationModal = signal(false);
  selectedPatientId: string | null = null;
  lines: SalesOrderLine[] = [];

  pickPatient(patient: PickedPatient | null): void {
    this.pickedPatient.set(patient);
    this.selectedPatientId = patient?.id ?? null;
  }
  total = 0;

  ngOnInit() {
    this.loadAllData();
  }

  loadAllData() {
    this.stockService.getSalesOrders().subscribe(data => {
      this.salesOrders.set(data.sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime()));
    });
    this.stockService.getStockItems().subscribe(data => this.catalogItems.set(data));
  }

  openCreateSOModal() {
    this.selectedPatientId = null;
    this.pickedPatient.set(null);
    this.lines = [];
    this.total = 0;
    this.showSOCreationModal.set(true);
  }

  closeCreateSOModal() {
    this.showSOCreationModal.set(false);
  }

  addSOLine() {
    this.lines.push({
      stockItem: null as any,
      quantity: 1,
      unitPrice: 0
    });
    this.calculateSOTotal();
  }

  removeSOLine(idx: number) {
    this.lines.splice(idx, 1);
    this.calculateSOTotal();
  }

  onItemChange(idx: number) {
    const line = this.lines[idx];
    if (line.stockItem) {
      line.unitPrice = line.stockItem.purchasePrice * 1.5; // Retail price markup
    }
    this.calculateSOTotal();
  }

  calculateSOTotal() {
    this.total = this.lines.reduce((acc, curr) => acc + (curr.quantity * curr.unitPrice), 0);
  }

  saveSO() {
    if (!this.selectedPatientId || this.lines.length === 0) {
      return;
    }

    const order: Partial<SalesOrder> = {
      // The server takes the patient by id.
      patient: { id: this.selectedPatientId } as Patient,
      lines: this.lines.map(line => ({
        stockItem: { id: line.stockItem.id } as StockItem,
        quantity: line.quantity,
        unitPrice: line.unitPrice
      }))
    };

    this.stockService.createSalesOrder(order).subscribe(() => {
      this.loadAllData();
      this.closeCreateSOModal();
    });
  }

  confirmSale(so: SalesOrder) {
    // We confirm direct patient sale using dummy confirmedBy UUID
    this.stockService.confirmSalesOrder(so.id!).subscribe(() => {
      this.loadAllData();
    });
  }

  cancelSale(so: SalesOrder) {
    this.stockService.cancelSalesOrder(so.id!).subscribe(() => {
      this.loadAllData();
    });
  }

  async deleteSale(so: SalesOrder) {
    const confirmed = await this.confirmDialog.confirm(
      this.translate.instant('STOCK.UI.SO_DELETE_CONFIRM'),
      { danger: true, confirmLabel: this.translate.instant('COMMON.DELETE') }
    );
    if (!confirmed) return;

    this.stockService.deleteSalesOrder(so.id!).subscribe({
      next: () => {
        this.toast.success(this.translate.instant('STOCK.UI.SO_DELETED'));
        this.loadAllData();
      },
      error: (err) => {
        this.toast.error(err.error?.detail || err.error?.message || 'Could not delete the sales order.');
      }
    });
  }

  getSOStatusClasses(status: SOStatus): string {
    switch (status) {
      case 'DRAFT':
        return 'bg-ink-50 text-ink-600 border-ink-200';
      case 'CONFIRMED':
        return 'bg-positive-50 text-positive-700 border-positive-200';
      case 'INVOICED':
        return 'bg-petrol-50 text-petrol-700 border-petrol-200';
      case 'CANCELLED':
        return 'bg-critical-50 text-critical-700 border-critical-200';
      default:
        return 'bg-ink-50 text-ink-600 border-ink-200';
    }
  }
}
