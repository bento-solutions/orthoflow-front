import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { StockService } from '../../../../core/services/stock.service';
import { PatientApiService } from '../../../../core/services/patient-api.service';
import { SalesOrder, SalesOrderLine, StockItem, SOStatus } from '../../../../core/models/stock.model';
import { Patient } from '../../../../core/models/patient.model';

import { RouterLink } from '@angular/router';
import { ConfirmDialogService } from '../../../../core/services/confirm-dialog.service';
import { ToastService } from '../../../../core/services/toast.service';

@Component({
  selector: 'app-sales-orders',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule, RouterLink],
  template: `
    <div class="p-6 max-w-7xl mx-auto space-y-6">
      
      <!-- Top Title Bar -->
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 class="text-3xl font-bold tracking-tight text-ink-900">{{ "STOCK.SALES_ORDERS_TITLE" | translate }}</h1>
          <p class="text-sm text-ink-500">{{ "STOCK.SALES_ORDERS_SUBTITLE" | translate }}</p>
        </div>
        <div class="flex items-center gap-3">
          <button type="button" (click)="openCreateSOModal()" class="flex items-center gap-2 px-4 py-2.5 bg-petrol-600 text-white font-medium rounded-xl hover:bg-petrol-700 transition shadow-sm">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            {{ "STOCK.RECORD_DIRECT_SALE" | translate }}
          </button>
        </div>
      </div>

      <!-- Module Navigation Pills -->
      <div class="flex flex-wrap gap-2 bg-ortho-navy/[0.03] p-1.5 rounded-xl border border-ortho-navy/5 max-w-max font-semibold text-xs">
        <a routerLink="/stock" class="px-4 py-2 rounded-lg transition text-ink-500 hover:text-ink-900 hover:bg-white/50">
          {{ "STOCK.CATALOG" | translate }}
        </a>
        <a routerLink="/stock/procurement" class="px-4 py-2 rounded-lg transition text-ink-500 hover:text-ink-900 hover:bg-white/50">
          {{ "STOCK.PROCUREMENT" | translate }}
        </a>
        <a routerLink="/stock/direct-sales" class="px-4 py-2 rounded-lg transition bg-white text-ink-900 shadow-sm">
          {{ "STOCK.SALES" | translate }}
        </a>
        <a routerLink="/stock/treatment-sessions" class="px-4 py-2 rounded-lg transition text-ink-500 hover:text-ink-900 hover:bg-white/50">
          {{ "STOCK.TREATMENT_SESSIONS" | translate }}
        </a>
        <a routerLink="/stock/leakage" class="px-4 py-2 rounded-lg transition bg-white text-ink-900 shadow-sm">
          {{ "STOCK.LEAKAGE" | translate }}
        </a>
        <a routerLink="/stock/forecast" class="px-4 py-2 rounded-lg transition bg-white text-ink-900 shadow-sm">
          {{ "STOCK.FORECAST" | translate }}
        </a>
      </div>


      <!-- Sales Orders Registry -->
      <div class="bg-white rounded-2xl border border-ortho-navy/5 shadow-sm overflow-hidden">
        
        <div class="p-4 border-b border-ortho-navy/5 bg-ortho-navy/[0.01] flex items-center justify-between">
          <h3 class="text-base font-bold text-ink-900">{{ "STOCK.SALES_ORDERS_HISTORY" | translate }}</h3>
          <span class="text-xs text-ink-500 font-medium">{{ "STOCK.SALES_ORDERS_HISTORY_SUBTITLE" | translate }}</span>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse text-sm">
            <thead>
              <tr class="bg-ortho-navy/[0.02] text-ink-500 font-semibold border-b border-ortho-navy/5">
                <th class="p-4">{{ "STOCK.SO_NUMBER" | translate }}</th>
                <th class="p-4">{{ "STOCK.PATIENT_NAME" | translate }}</th>
                <th class="p-4">{{ "STOCK.PURCHASE_DATE" | translate }}</th>
                <th class="p-4 text-center">{{ "STOCK.STATUS" | translate }}</th>
                <th class="p-4">{{ "STOCK.SOLD_ITEMS" | translate }}</th>
                <th class="p-4 text-right">{{ "STOCK.TOTAL_AMOUNT" | translate }}</th>
                <th class="p-4 text-right">{{ "STOCK.ACTIONS" | translate }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-ortho-navy/5">
              @for (so of salesOrders(); track so.id) {
                <tr class="hover:bg-ortho-navy/[0.01] transition">
                  <td class="p-4 font-mono text-xs font-bold text-ink-900">{{ so.soNumber }}</td>
                  <td class="p-4">
                    <div class="font-bold text-ink-900">{{ so.patient?.firstName }} {{ so.patient?.lastName }}</div>
                    <div class="text-[10px] text-ink-500">{{ "STOCK.EMAIL_LABEL" | translate }}: {{ so.patient?.email }}</div>
                  </td>
                  <td class="p-4 text-ink-500 font-medium">{{ so.createdAt | date:'yyyy-MM-dd HH:mm' }}</td>
                  <td class="p-4 text-center">
                    <span class="px-2.5 py-1 text-xs font-bold rounded-full border uppercase" [ngClass]="getSOStatusClasses(so.status!)">
                      {{ so.status }}
                    </span>
                  </td>
                  <td class="p-4">
                    <div class="flex flex-col gap-1">
                      @for (line of so.lines; track line.id) {
                        <div class="text-[11px] text-ink-600">
                          • {{ line.stockItem?.name }}: <span class="font-bold text-ink-900">{{ line.quantity }}</span> {{ "STOCK.UNITS" | translate }}
                        </div>
                      }
                    </div>
                  </td>
                  <td class="p-4 text-right font-bold text-emerald-600">{{ so.totalAmount | number:'1.2-2' }} DH</td>
                  <td class="p-4 text-right">
                    <div class="flex items-center justify-end gap-2">
                      @if (so.status === 'DRAFT') {
                        <button type="button" (click)="confirmSale(so)" class="px-2.5 py-1 text-xs font-semibold bg-emerald-50 text-emerald-600 hover:bg-emerald-100 rounded-lg border border-emerald-200 transition">
                          {{ "STOCK.CONFIRM_SALE" | translate }}
                        </button>
                        <button type="button" (click)="cancelSale(so)" class="px-2.5 py-1 text-xs font-semibold bg-red-50 text-red-600 hover:bg-red-100 rounded-lg border border-red-200 transition">
                          {{ "STOCK.CANCEL" | translate }}
                        </button>
                      }
                      <button type="button" (click)="deleteSale(so)" class="p-1 hover:bg-red-50 text-red-600/60 hover:text-red-600 rounded-lg transition" [disabled]="so.status === 'CONFIRMED'">
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
        <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ortho-navy/60 backdrop-blur-sm">
          <div class="bg-white rounded-2xl max-w-2xl w-full overflow-hidden border border-ortho-navy/5 shadow-2xl animate-fade-in flex flex-col max-h-[85vh]">
            <div class="px-6 py-4 border-b border-ortho-navy/5 flex items-center justify-between bg-ortho-navy/[0.01] shrink-0">
              <h3 class="text-lg font-bold text-ink-900">{{ "STOCK.RECORD_DIRECT_SALE" | translate }}</h3>
              <button type="button" (click)="closeCreateSOModal()" class="p-1 text-ink-500 hover:text-ink-900 hover:bg-ortho-navy/5 rounded-lg transition">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>
            
            <div class="flex-1 overflow-y-auto p-6 space-y-4">
              <!-- Select Patient -->
              <div>
                <label class="block text-xs font-bold text-ink-500 uppercase tracking-wide mb-1">{{ "STOCK.SELECT_PATIENT" | translate }} *</label>
                <select [(ngModel)]="selectedPatientId" class="w-full px-3 py-2 border border-ortho-navy/10 rounded-xl text-sm focus:outline-none focus:border-petrol-600 transition bg-white">
                  <option [value]="null">{{ "STOCK.SELECT_PATIENT_PLACEHOLDER" | translate }}</option>
                  @for (p of patients(); track p.id) {
                    <option [value]="p.id">{{ p.lastName }} {{ p.firstName }} ({{ "STOCK.CIN_LABEL" | translate }}: {{ p.cin || 'N/A' }})</option>
                  }
                </select>
              </div>

              <!-- Lines Editor -->
              @if (selectedPatientId) {
                <div class="space-y-3">
                  <div class="flex items-center justify-between border-b border-ortho-navy/5 pb-2">
                    <span class="text-xs font-bold text-ink-500 uppercase tracking-wide">{{ "STOCK.SALES_LINES" | translate }}</span>
                    <button type="button" (click)="addSOLine()" class="px-2.5 py-1 text-xs font-semibold bg-petrol-600 text-white hover:bg-petrol-700 transition rounded-lg">
                      + {{ "STOCK.ADD_ITEM" | translate }}
                    </button>
                  </div>

                  <div class="space-y-3">
                    @for (line of lines; track $index; let idx = $index) {
                      <div class="grid grid-cols-12 gap-3 items-end bg-gray-50/50 p-3 rounded-xl border border-gray-100 font-medium">
                        <div class="col-span-5">
                          <label class="block text-[10px] font-bold text-ink-600 uppercase mb-1">{{ "STOCK.CATALOG_ITEM" | translate }}</label>
                          <select [(ngModel)]="line.stockItem" (change)="onItemChange(idx)" class="w-full px-2.5 py-1.5 border border-ortho-navy/10 rounded-lg text-xs bg-white focus:outline-none">
                            <option [value]="null">{{ "STOCK.SELECT_ITEM_PLACEHOLDER" | translate }}</option>
                            @for (item of catalogItems(); track item.id) {
                              <option [ngValue]="item">{{ item.name }} (SKU: {{ item.sku }}) - Stock: {{ item.currentStock }}</option>
                            }
                          </select>
                        </div>
                        <div class="col-span-2">
                          <label class="block text-[10px] font-bold text-ink-600 uppercase mb-1">{{ "STOCK.QUANTITY" | translate }}</label>
                          <input type="number" [(ngModel)]="line.quantity" (change)="calculateSOTotal()" min="1" class="w-full px-2.5 py-1.5 border border-ortho-navy/10 rounded-lg text-xs bg-white text-center focus:outline-none" />
                        </div>
                        <div class="col-span-2">
                          <label class="block text-[10px] font-bold text-ink-600 uppercase mb-1">{{ "STOCK.UNIT_PRICE" | translate }} (DH)</label>
                          <input type="number" [(ngModel)]="line.unitPrice" (change)="calculateSOTotal()" min="0" class="w-full px-2.5 py-1.5 border border-ortho-navy/10 rounded-lg text-xs bg-white text-right focus:outline-none" />
                        </div>
                        <div class="col-span-2 text-right">
                          <span class="block text-[10px] font-bold text-ink-600 uppercase mb-1">{{ "STOCK.TOTAL" | translate }} (DH)</span>
                          <span class="font-bold text-xs text-ink-900 block py-1.5">{{ (line.quantity * line.unitPrice) | number:'1.2-2' }}</span>
                        </div>
                        <div class="col-span-1 text-center">
                          <button type="button" (click)="removeSOLine(idx)" class="p-1.5 hover:bg-red-50 text-red-600 rounded-lg transition mb-1">
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                          </button>
                        </div>
                      </div>
                    }
                  </div>

                  <div class="flex justify-end pt-3 border-t border-ortho-navy/5">
                    <div class="text-right">
                      <span class="text-xs font-bold text-ink-500 uppercase tracking-wider block">{{ "STOCK.GRAND_TOTAL" | translate }}</span>
                      <span class="text-xl font-bold text-emerald-600">{{ total | number:'1.2-2' }} DH</span>
                    </div>
                  </div>
                </div>
              }
            </div>

            <div class="px-6 py-4 border-t border-ortho-navy/5 flex items-center justify-end gap-3 bg-ortho-navy/[0.01] shrink-0">
              <button type="button" (click)="closeCreateSOModal()" class="px-4 py-2 border border-ortho-navy/10 rounded-xl text-sm font-semibold hover:bg-gray-50 transition text-ink-600">{{ "STOCK.CANCEL" | translate }}</button>
              <button type="button" (click)="saveSO()" [disabled]="!selectedPatientId || lines.length === 0" class="px-5 py-2 bg-petrol-600 text-white rounded-xl text-sm font-semibold hover:bg-petrol-700 transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">{{ "STOCK.SAVE_SALE_DRAFT" | translate }}</button>
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
  private stockService = inject(StockService);
  private confirmDialog = inject(ConfirmDialogService);
  private toast = inject(ToastService);
  private patientService = inject(PatientApiService);

  readonly salesOrders = signal<SalesOrder[]>([]);
  readonly patients = signal<Patient[]>([]);
  readonly catalogItems = signal<StockItem[]>([]);

  // Create Modal control
  readonly showSOCreationModal = signal(false);
  selectedPatientId: string | null = null;
  lines: SalesOrderLine[] = [];
  total = 0;

  ngOnInit() {
    this.loadAllData();
  }

  loadAllData() {
    this.stockService.getSalesOrders().subscribe(data => {
      this.salesOrders.set(data.sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime()));
    });
    this.patientService.getPatients().subscribe(data => this.patients.set(data));
    this.stockService.getStockItems().subscribe(data => this.catalogItems.set(data));
  }

  openCreateSOModal() {
    this.selectedPatientId = null;
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
    const pat = this.patients().find(p => p.id === this.selectedPatientId);
    if (!pat || this.lines.length === 0) {
      return;
    }

    const order: Partial<SalesOrder> = {
      patient: pat,
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
      `Are you sure you want to delete this sales order draft?`,
      { danger: true, confirmLabel: 'Delete' }
    );
    if (!confirmed) return;

    this.stockService.deleteSalesOrder(so.id!).subscribe({
      next: () => {
        this.toast.success('Sales order draft deleted.');
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
        return 'bg-gray-50 text-gray-600 border-gray-200';
      case 'CONFIRMED':
        return 'bg-emerald-50 text-emerald-600 border-emerald-200';
      case 'INVOICED':
        return 'bg-blue-50 text-blue-600 border-blue-200';
      case 'CANCELLED':
        return 'bg-red-50 text-red-600 border-red-200';
      default:
        return 'bg-gray-50 text-gray-600 border-gray-200';
    }
  }
}
