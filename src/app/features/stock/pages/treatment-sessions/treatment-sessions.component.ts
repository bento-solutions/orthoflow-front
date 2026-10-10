import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { StockService } from '../../../../core/services/stock.service';
import { PatientApiService } from '../../../../core/services/patient-api.service';
import { 
  TreatmentInvoice, 
  Treatment, 
  TreatmentPrice,
  TreatmentInvoiceConsumable, 
  StockItem, 
  TreatmentInvoiceStatus,
  InvoiceDiscount,
  DiscountType,
  DiscountTarget
} from '../../../../core/models/stock.model';
import { Patient } from '../../../../core/models/patient.model';

import { RouterLink } from '@angular/router';
import { ConfirmDialogService } from '../../../../core/services/confirm-dialog.service';
import { ToastService } from '../../../../core/services/toast.service';

@Component({
  selector: 'app-treatment-sessions',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslateModule, RouterLink],
  template: `
    <div class="p-6 max-w-7xl mx-auto space-y-6">
      
      <!-- Top Title Bar -->
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 class="text-3xl font-bold tracking-tight text-ink-900">{{ "TREATMENTS.SESSIONS_BILLING_TITLE" | translate }}</h1>
          <p class="text-sm text-ink-500">{{ "TREATMENTS.SESSIONS_BILLING_SUBTITLE" | translate }}</p>
        </div>
        <div class="flex items-center gap-3">
          <button type="button" (click)="openLogModal()" class="flex items-center gap-2 px-4 py-2.5 bg-petrol-600 text-white font-medium rounded-xl hover:bg-petrol-700 transition shadow-sm">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            {{ "TREATMENTS.LOG_SESSION" | translate }}
          </button>
        </div>
      </div>

      <!-- Module Navigation Pills -->
      <div class="flex flex-wrap gap-2 bg-ortho-navy/[0.03] p-1.5 rounded-xl border border-ortho-navy/5 max-w-max font-semibold text-xs">
        <a routerLink="/stock" class="px-4 py-2 rounded-lg transition text-ink-500 hover:text-ink-900 hover:bg-white/50">
          {{ "STOCK.NAV_CATALOG" | translate }}
        </a>
        <a routerLink="/stock/procurement" class="px-4 py-2 rounded-lg transition text-ink-500 hover:text-ink-900 hover:bg-white/50">
          {{ "STOCK.PROCUREMENT" | translate }}
        </a>
        <a routerLink="/stock/direct-sales" class="px-4 py-2 rounded-lg transition text-ink-500 hover:text-ink-900 hover:bg-white/50">
          {{ "STOCK.NAV_SALES" | translate }}
        </a>
        <a routerLink="/stock/treatment-sessions" class="px-4 py-2 rounded-lg transition bg-white text-ink-900 shadow-sm">
          {{ "STOCK.TREATMENT_SESSIONS" | translate }}
        </a>
      </div>


      <!-- Invoices Registry -->
      <div class="bg-white rounded-2xl border border-ortho-navy/5 shadow-sm overflow-hidden">
        
        <div class="p-4 border-b border-ortho-navy/5 bg-ortho-navy/[0.01] flex items-center justify-between">
          <h3 class="text-base font-bold text-ink-900">{{ "TREATMENTS.INVOICES_REGISTRY" | translate }}</h3>
          <span class="text-xs text-ink-500 font-medium">{{ "TREATMENTS.INVOICES_REGISTRY_SUBTITLE" | translate }}</span>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse text-sm">
            <thead>
              <tr class="bg-ortho-navy/[0.02] text-ink-500 font-semibold border-b border-ortho-navy/5">
                <th class="p-4">{{ "TREATMENTS.INVOICE_NUMBER" | translate }}</th>
                <th class="p-4">{{ "TREATMENTS.PATIENT" | translate }}</th>
                <th class="p-4">{{ "TREATMENTS.TREATMENT" | translate }}</th>
                <th class="p-4">{{ "TREATMENTS.SESSION_DATE" | translate }}</th>
                <th class="p-4 text-center">{{ "COMMON.STATUS" | translate }}</th>
                <th class="p-4 text-right">{{ "TREATMENTS.MATERIALS_COST" | translate }}</th>
                <th class="p-4 text-right">{{ "TREATMENTS.GRAND_TOTAL" | translate }}</th>
                <th class="p-4 text-right">{{ "COMMON.ACTIONS" | translate }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-ortho-navy/5">
              @for (inv of invoices(); track inv.id) {
                <tr class="hover:bg-ortho-navy/[0.01] transition">
                  <td class="p-4 font-mono text-xs font-bold text-ink-900">{{ inv.invoiceNumber || 'DRAFT' }}</td>
                  <td class="p-4">
                    <div class="font-bold text-ink-900">{{ inv.patient?.firstName }} {{ inv.patient?.lastName }}</div>
                    <div class="text-[10px] text-ink-500">CIN: {{ inv.patient?.cin || 'N/A' }}</div>
                  </td>
                  <td class="p-4 font-semibold text-ink-700">{{ inv.treatment?.name }}</td>
                  <td class="p-4 text-ink-500 font-medium">{{ inv.sessionDate | date:'yyyy-MM-dd HH:mm' }}</td>
                  <td class="p-4 text-center">
                    <span class="px-2.5 py-1 text-xs font-bold rounded-full border uppercase" [ngClass]="getInvoiceStatusClasses(inv.status!)">
                      {{ inv.status }}
                    </span>
                  </td>
                  <td class="p-4 text-right font-medium text-emerald-600">{{ inv.consumablesCost | number:'1.2-2' }} DH</td>
                  <td class="p-4 text-right font-bold text-ink-900">{{ inv.total | number:'1.2-2' }} DH</td>
                  <td class="p-4 text-right">
                    <div class="flex items-center justify-end gap-2">
                      @if (inv.status === 'DRAFT') {
                        <button type="button" (click)="openDraftEditModal(inv)" class="px-2.5 py-1 text-xs font-semibold bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg border border-blue-200 transition">
                          {{ "TREATMENTS.EDIT_DRAFT" | translate }}
                        </button>
                        <button type="button" (click)="finalizeInvoice(inv)" class="px-2.5 py-1 text-xs font-semibold bg-emerald-50 text-emerald-600 hover:bg-emerald-100 rounded-lg border border-emerald-200 transition">
                          {{ "TREATMENTS.FINALIZE" | translate }}
                        </button>
                      } @else if (inv.status === 'FINALIZED') {
                        <button type="button" (click)="cancelInvoice(inv)" class="px-2.5 py-1 text-xs font-semibold bg-red-50 text-red-600 hover:bg-red-100 rounded-lg border border-red-200 transition">
                          {{ "TREATMENTS.CANCEL_SESSION" | translate }}
                        </button>
                      }
                      <button type="button" (click)="deleteInvoice(inv)" class="p-1 hover:bg-red-50 text-red-600/60 hover:text-red-600 rounded-lg transition" [disabled]="inv.status === 'FINALIZED'">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                      </button>
                    </div>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="8" class="p-8 text-center text-ink-500">{{ "TREATMENTS.NO_SESSIONS" | translate }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>

      <!-- Log Session Modal / Editor -->
      @if (showLogModal()) {
        <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ortho-navy/60 backdrop-blur-sm">
          <div class="bg-white rounded-2xl max-w-4xl w-full overflow-hidden border border-ortho-navy/5 shadow-2xl animate-fade-in flex flex-col max-h-[90vh]">
            
            <div class="px-6 py-4 border-b border-ortho-navy/5 flex items-center justify-between bg-ortho-navy/[0.01] shrink-0">
              <div>
                <h3 class="text-lg font-bold text-ink-900">{{ editDraftMode() ? ("TREATMENTS.EDIT_SESSION" | translate) : ("TREATMENTS.LOG_SESSION" | translate) }}</h3>
                <p class="text-xs text-ink-500">{{ "TREATMENTS.SESSION_MODAL_SUBTITLE" | translate }}</p>
              </div>
              <button type="button" (click)="closeLogModal()" class="p-1 text-ink-500 hover:text-ink-900 hover:bg-ortho-navy/5 rounded-lg transition">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>
            
            <div class="flex-1 overflow-y-auto p-6 space-y-5">
              
              @if (!activeDraft()) {
                <!-- Step 1: Select Patient and Treatment -->
                <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div>
                    <label class="block text-xs font-bold text-ink-500 uppercase tracking-wide mb-1.5">{{ "TREATMENTS.SELECT_PATIENT" | translate }} *</label>
                    <select [(ngModel)]="logPatientId" class="w-full px-3 py-2 border border-ortho-navy/10 rounded-xl text-sm focus:outline-none focus:border-petrol-600 transition bg-white font-medium">
                      <option [value]="null">{{ "TREATMENTS.SELECT_PATIENT_PLACEHOLDER" | translate }}</option>
                      @for (p of patients(); track p.id) {
                        <option [value]="p.id">{{ p.lastName }} {{ p.firstName }} (CIN: {{ p.cin || 'N/A' }})</option>
                      }
                    </select>
                  </div>
                  <div>
                    <label class="block text-xs font-bold text-ink-500 uppercase tracking-wide mb-1.5">{{ "TREATMENTS.SELECT_TREATMENT_PROCEDURE" | translate }} *</label>
                    <select [(ngModel)]="logTreatmentId" (ngModelChange)="refreshQuote()" class="w-full px-3 py-2 border border-ortho-navy/10 rounded-xl text-sm focus:outline-none focus:border-petrol-600 transition bg-white font-medium">
                      <option [value]="null">{{ "TREATMENTS.SELECT_TREATMENT_PLACEHOLDER" | translate }}</option>
                      @for (t of treatments(); track t.id) {
                        <option [value]="t.id">{{ t.name }} ({{ t.basePrice }} DH)</option>
                      }
                    </select>
                  </div>
                </div>

                @if (logTreatmentId) {
                  <fieldset class="rounded-xl border border-ortho-navy/10 p-3">
                    <legend class="px-1 text-xs font-bold text-ink-500 uppercase tracking-wide">{{ "TREATMENTS.SESSION_FACES" | translate }}</legend>
                    <div class="flex flex-wrap gap-2">
                      @for (face of faceChoices; track face) {
                        <label class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-semibold cursor-pointer"
                               [class.border-petrol-600]="logFaces.has(face)" [class.bg-petrol-50]="logFaces.has(face)" [class.border-ortho-navy/10]="!logFaces.has(face)">
                          <input type="checkbox" class="sr-only" [checked]="logFaces.has(face)" (change)="toggleFace(face)" />
                          {{ "SURFACE." + face.toUpperCase() | translate }}
                        </label>
                      }
                    </div>
                    @if (quote(); as q) {
                      <p class="mt-2 text-sm text-ink-700" aria-live="polite">
                        @if (q.basis === 'BASE') {
                          {{ "TREATMENTS.SESSION_QUOTE_BASE" | translate: { price: q.price } }}
                        } @else {
                          {{ "TREATMENTS.SESSION_QUOTE_FACES" | translate: { n: q.faceCount, price: q.price } }}
                        }
                      </p>
                    }
                  </fieldset>
                }

                <div class="flex justify-end pt-2">
                  <button type="button" (click)="initializeDraft()" [disabled]="!logPatientId || !logTreatmentId" class="px-5 py-2 bg-petrol-600 text-white rounded-xl text-sm font-semibold hover:bg-petrol-700 transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">
                    {{ "TREATMENTS.LOAD_SESSION_TEMPLATE" | translate }}
                  </button>
                </div>
              } @else {
                <!-- Step 2: Full session editor -->
                <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                  
                  <!-- Main Editor Section -->
                  <div class="md:col-span-2 space-y-5">
                    
                    <!-- Consumables Editor Table -->
                    <div class="space-y-3">
                      <div class="flex items-center justify-between border-b border-ortho-navy/5 pb-2">
                        <span class="text-xs font-bold text-ink-500 uppercase tracking-wide">{{ "TREATMENTS.MATERIALS_CONSUMED_LOGGER" | translate }}</span>
                        <button type="button" (click)="addExtraConsumable()" class="px-2.5 py-1 text-xs font-semibold bg-petrol-600 text-white hover:bg-petrol-700 transition rounded-lg">
                          + {{ "TREATMENTS.ADD_EXTRA_MATERIAL" | translate }}
                        </button>
                      </div>

                      <div class="space-y-3">
                        @for (c of draftConsumables; track $index; let idx = $index) {
                          <div class="grid grid-cols-12 gap-3 items-end bg-gray-50/50 p-3.5 rounded-2xl border border-gray-100 font-semibold text-xs text-ink-900">
                            <div class="col-span-5">
                              <label class="block text-[10px] font-bold text-ink-600 uppercase mb-1">{{ "STOCK.ITEM_NAME" | translate }}</label>
                              <select [(ngModel)]="c.stockItem" (change)="onConsumableItemChange(idx)" [disabled]="!!c.id" class="w-full px-2.5 py-1.5 border border-ortho-navy/10 rounded-lg text-xs bg-white focus:outline-none font-semibold text-ink-900">
                                <option [value]="null">{{ "TREATMENTS.SELECT_ITEM_PLACEHOLDER" | translate }}</option>
                                @for (item of catalogItems(); track item.id) {
                                  <option [ngValue]="item">{{ item.name }} (Available: {{ item.currentStock }} {{ item.unit || 'units' }})</option>
                                }
                              </select>
                            </div>
                            <div class="col-span-3">
                              <label class="block text-[10px] font-bold text-ink-600 uppercase mb-1">{{ "TREATMENTS.QTY_USED" | translate }}</label>
                              <div class="flex items-center gap-1.5">
                                <input type="number" [(ngModel)]="c.actualQuantity" (change)="recalculateDraftTotals()" min="0.0001" step="any" class="w-full px-2 py-1.5 border border-ortho-navy/10 rounded-lg text-xs bg-white text-center focus:outline-none font-mono font-bold" />
                                <span class="text-[10px] font-bold text-ink-600 font-mono select-none shrink-0">{{ c.stockItem?.unit || 'units' }}</span>
                              </div>
                            </div>
                            <div class="col-span-3 text-right">
                              <span class="block text-[10px] font-bold text-ink-600 uppercase mb-1">{{ "TREATMENTS.USAGE_COST" | translate }}</span>
                              <span class="font-bold text-emerald-600 block py-1.5 text-xs">{{ (c.actualQuantity * c.pricePerUnit) | number:'1.2-2' }} DH</span>
                            </div>
                            <div class="col-span-1 text-center">
                              <button type="button" (click)="removeDraftConsumable(idx)" class="p-1.5 hover:bg-red-50 text-red-600 rounded-lg transition mb-1">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                              </button>
                            </div>
                          </div>
                        }
                      </div>
                    </div>

                    <!-- Clinical Discounts -->
                    <div class="space-y-3">
                      <div class="flex items-center justify-between border-b border-ortho-navy/5 pb-2">
                        <span class="text-xs font-bold text-ink-500 uppercase tracking-wide">{{ "TREATMENTS.DISCOUNTS_ADJUSTMENTS" | translate }}</span>
                        <button type="button" (click)="addDiscountLine()" class="px-2.5 py-1 text-xs font-semibold bg-petrol-600 text-white hover:bg-petrol-700 transition rounded-lg">
                          + {{ "TREATMENTS.ADD_DISCOUNT" | translate }}
                        </button>
                      </div>

                      <div class="space-y-2">
                        @for (d of draftDiscounts; track $index; let idx = $index) {
                          <div class="grid grid-cols-12 gap-3 items-end bg-amber-50/20 p-3.5 rounded-2xl border border-amber-100/50 font-semibold text-xs text-ink-900">
                            <div class="col-span-3">
                              <label class="block text-[10px] font-bold text-ink-600 uppercase mb-1">{{ "TREATMENTS.DISCOUNT_TARGET" | translate }}</label>
                              <select [(ngModel)]="d.target" (change)="recalculateDraftTotals()" class="w-full px-2.5 py-1.5 border border-ortho-navy/10 rounded-lg text-xs bg-white focus:outline-none">
                                <option value="INVOICE">{{ "TREATMENTS.DISCOUNT_TARGET_INVOICE" | translate }}</option>
                                <option value="TREATMENT">{{ "TREATMENTS.TREATMENT_FEE" | translate }}</option>
                              </select>
                            </div>
                            <div class="col-span-3">
                              <label class="block text-[10px] font-bold text-ink-600 uppercase mb-1">{{ "COMMON.TYPE" | translate }}</label>
                              <select [(ngModel)]="d.type" (change)="recalculateDraftTotals()" class="w-full px-2.5 py-1.5 border border-ortho-navy/10 rounded-lg text-xs bg-white focus:outline-none">
                                <option value="PERCENTAGE">{{ "TREATMENTS.DISCOUNT_TYPE_PERCENTAGE" | translate }}</option>
                                <option value="FIXED">{{ "TREATMENTS.DISCOUNT_TYPE_FIXED" | translate }}</option>
                              </select>
                            </div>
                            <div class="col-span-2">
                              <label class="block text-[10px] font-bold text-ink-600 uppercase mb-1">{{ "TREATMENTS.DISCOUNT_VALUE" | translate }}</label>
                              <input type="number" [(ngModel)]="d.value" (change)="recalculateDraftTotals()" min="0" class="w-full px-2.5 py-1.5 border border-ortho-navy/10 rounded-lg text-xs bg-white text-center focus:outline-none font-mono" />
                            </div>
                            <div class="col-span-3">
                              <label class="block text-[10px] font-bold text-ink-600 uppercase mb-1">{{ "TREATMENTS.DISCOUNT_REASON" | translate }}</label>
                              <input type="text" [(ngModel)]="d.reason" [placeholder]="'TREATMENTS.DISCOUNT_REASON_PLACEHOLDER' | translate" class="w-full px-2.5 py-1.5 border border-ortho-navy/10 rounded-lg text-xs bg-white focus:outline-none" />
                            </div>
                            <div class="col-span-1 text-center">
                              <button type="button" (click)="removeDiscountLine(idx)" class="p-1.5 hover:bg-red-50 text-red-600 rounded-lg transition mb-1">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                              </button>
                            </div>
                          </div>
                        }
                      </div>
                    </div>

                  </div>

                  <!-- Sidebar Totals / Card Summary -->
                  <div class="bg-gray-50 border border-gray-100 rounded-2xl p-5 space-y-4 self-start">
                    <h4 class="text-sm font-bold text-ink-900 border-b border-ortho-navy/5 pb-2 uppercase tracking-wide">{{ "TREATMENTS.SESSION_SUMMARY" | translate }}</h4>

                    <div class="space-y-3 text-xs font-semibold text-ink-600">
                      <div class="flex justify-between">
                        <span>{{ "TREATMENTS.PATIENT" | translate }}:</span>
                        <span class="font-bold text-ink-900">{{ activeDraft()?.patient?.firstName }} {{ activeDraft()?.patient?.lastName }}</span>
                      </div>
                      <div class="flex justify-between">
                        <span>{{ "TREATMENTS.TREATMENT" | translate }}:</span>
                        <span class="font-bold text-ink-900">{{ activeDraft()?.treatment?.name }}</span>
                      </div>

                      <hr class="border-ortho-navy/5">

                      <div class="flex justify-between">
                        <span>{{ "TREATMENTS.TREATMENT_FEE" | translate }}:</span>
                        <span class="font-bold text-ink-900">{{ activeDraft()?.treatmentPrice | number:'1.2-2' }} DH</span>
                      </div>
                      <div class="flex justify-between">
                        <span>{{ "TREATMENTS.MATERIALS_COST" | translate }}:</span>
                        <span class="font-bold text-emerald-600">+{{ activeDraft()?.consumablesCost | number:'1.2-2' }} DH</span>
                      </div>
                      <div class="flex justify-between">
                        <span>{{ "TREATMENTS.SUBTOTAL" | translate }}:</span>
                        <span class="font-bold text-ink-900">{{ activeDraft()?.subtotal | number:'1.2-2' }} DH</span>
                      </div>
                      <div class="flex justify-between text-emerald-600">
                        <span>{{ "TREATMENTS.DISCOUNT_LABEL" | translate }}:</span>
                        <span>-{{ activeDraft()?.discountAmount | number:'1.2-2' }} DH</span>
                      </div>

                      <hr class="border-ortho-navy/5">

                      <div class="flex justify-between items-baseline text-sm font-bold text-ink-900 pt-2">
                        <span>{{ "TREATMENTS.GRAND_TOTAL" | translate }}:</span>
                        <span class="text-lg font-extrabold text-ink-900">{{ activeDraft()?.total | number:'1.2-2' }} DH</span>
                      </div>
                    </div>

                    <div class="pt-3 border-t border-ortho-navy/5 space-y-2">
                      <button type="button" (click)="saveDraftSession()" class="w-full py-2 bg-petrol-600 text-white text-xs font-bold rounded-xl hover:bg-petrol-700 transition shadow-sm">
                        {{ "TREATMENTS.SAVE_SESSION_DRAFT" | translate }}
                      </button>
                      <button type="button" (click)="finalizeSessionFromModal()" class="w-full py-2 bg-emerald-600 text-white text-xs font-bold rounded-xl hover:bg-emerald-700 transition shadow-sm">
                        {{ "TREATMENTS.FINALIZE_DEDUCT_STOCK" | translate }}
                      </button>
                    </div>

                  </div>

                </div>
              }

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
export class TreatmentSessionsComponent implements OnInit {
  private stockService = inject(StockService);
  private patientService = inject(PatientApiService);
  private confirmDialog = inject(ConfirmDialogService);
  private toast = inject(ToastService);

  readonly invoices = signal<TreatmentInvoice[]>([]);
  readonly patients = signal<Patient[]>([]);
  readonly treatments = signal<Treatment[]>([]);
  readonly catalogItems = signal<StockItem[]>([]);

  // Modal control
  readonly showLogModal = signal(false);
  readonly editDraftMode = signal(false);
  
  // Selection
  logPatientId: string | null = null;
  logTreatmentId: string | null = null;
  /** The faces the session worked on; the treatment is priced by how many (V63). */
  readonly faceChoices = ['mesial', 'distal', 'buccal', 'lingual', 'occlusal', 'cervical'];
  logFaces = new Set<string>();
  readonly quote = signal<TreatmentPrice | null>(null);

  // Active Draft Session
  readonly activeDraft = signal<TreatmentInvoice | null>(null);
  draftConsumables: TreatmentInvoiceConsumable[] = [];
  draftDiscounts: InvoiceDiscount[] = [];

  ngOnInit() {
    this.loadAllData();
  }

  loadAllData() {
    this.stockService.getTreatmentInvoices().subscribe(data => {
      this.invoices.set(data.sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime()));
    });
    this.patientService.getPatients().subscribe(data => this.patients.set(data));
    this.stockService.getTreatments().subscribe(data => this.treatments.set(data));
    this.stockService.getStockItems().subscribe(data => this.catalogItems.set(data));
  }

  openLogModal() {
    this.editDraftMode.set(false);
    this.logPatientId = null;
    this.logTreatmentId = null;
    this.logFaces = new Set();
    this.quote.set(null);
    this.activeDraft.set(null);
    this.draftConsumables = [];
    this.draftDiscounts = [];
    this.showLogModal.set(true);
  }

  openDraftEditModal(inv: TreatmentInvoice) {
    this.editDraftMode.set(true);
    this.activeDraft.set(inv);
    this.draftConsumables = inv.consumablesUsed ? inv.consumablesUsed.map(c => ({ ...c })) : [];
    this.draftDiscounts = inv.discounts ? inv.discounts.map(d => ({ ...d })) : [];
    this.showLogModal.set(true);
  }

  closeLogModal() {
    this.showLogModal.set(false);
  }

  toggleFace(face: string) {
    if (this.logFaces.has(face)) this.logFaces.delete(face); else this.logFaces.add(face);
    this.refreshQuote();
  }

  private surfaceValue(): string | null {
    return this.faceChoices.filter(f => this.logFaces.has(f)).join('-') || null;
  }

  refreshQuote() {
    if (!this.logTreatmentId) {
      this.quote.set(null);
      return;
    }
    this.stockService.getTreatmentPrice(this.logTreatmentId, this.surfaceValue())
      .subscribe({ next: q => this.quote.set(q), error: () => this.quote.set(null) });
  }

  initializeDraft() {
    if (!this.logPatientId || !this.logTreatmentId) {
      return;
    }

    this.stockService.createDraftTreatmentInvoice(this.logPatientId, this.logTreatmentId, this.surfaceValue()).subscribe(draft => {
      this.activeDraft.set(draft);
      this.draftConsumables = draft.consumablesUsed ? draft.consumablesUsed.map(c => ({ ...c })) : [];
      this.draftDiscounts = draft.discounts ? draft.discounts.map(d => ({ ...d })) : [];
    });
  }

  addExtraConsumable() {
    this.draftConsumables.push({
      stockItem: null as any,
      defaultQuantity: 1,
      actualQuantity: 1,
      pricePerUnit: 0,
      totalCost: 0,
      modified: true
    });
  }

  removeDraftConsumable(idx: number) {
    this.draftConsumables.splice(idx, 1);
    this.recalculateDraftTotals();
  }

  onConsumableItemChange(idx: number) {
    const line = this.draftConsumables[idx];
    if (line.stockItem) {
      line.pricePerUnit = line.stockItem.pricePerUse;
    }
    this.recalculateDraftTotals();
  }

  addDiscountLine() {
    this.draftDiscounts.push({
      type: 'PERCENTAGE',
      target: 'INVOICE',
      value: 10,
      reason: ''
    });
    this.recalculateDraftTotals();
  }

  removeDiscountLine(idx: number) {
    this.draftDiscounts.splice(idx, 1);
    this.recalculateDraftTotals();
  }

  recalculateDraftTotals() {
    const draft = this.activeDraft();
    if (!draft) return;

    // 1. Recalculate consumable cost
    let consumablesTotal = 0;
    this.draftConsumables.forEach(c => {
      c.totalCost = c.actualQuantity * c.pricePerUnit;
      consumablesTotal += c.totalCost;
    });

    draft.consumablesCost = consumablesTotal;
    draft.subtotal = draft.treatmentPrice + consumablesTotal;

    // 2. Recalculate discounts
    let discountSum = 0;
    this.draftDiscounts.forEach(d => {
      let base = 0;
      if (d.target === 'INVOICE') {
        base = draft.subtotal!;
      } else if (d.target === 'TREATMENT') {
        base = draft.treatmentPrice;
      }

      if (d.type === 'PERCENTAGE') {
        discountSum += (base * d.value) / 100;
      } else {
        discountSum += d.value;
      }
    });

    draft.discountAmount = discountSum;
    draft.total = draft.subtotal! - discountSum;

    // Update draft signal
    this.activeDraft.set({ ...draft });
  }

  saveDraftSession() {
    const draft = this.activeDraft();
    if (!draft) return;

    draft.consumablesUsed = this.draftConsumables.map(c => ({
      ...c,
      stockItem: { id: c.stockItem.id, pricePerUse: c.stockItem.pricePerUse } as StockItem
    }));
    draft.discounts = this.draftDiscounts;

    this.stockService.saveTreatmentInvoice(draft).subscribe(() => {
      this.loadAllData();
      this.closeLogModal();
    });
  }

  finalizeSessionFromModal() {
    const draft = this.activeDraft();
    if (!draft) return;

    draft.consumablesUsed = this.draftConsumables.map(c => ({
      ...c,
      stockItem: { id: c.stockItem.id, pricePerUse: c.stockItem.pricePerUse } as StockItem
    }));
    draft.discounts = this.draftDiscounts;

    this.stockService.saveTreatmentInvoice(draft).subscribe({
      next: (savedInvoice) => {
        this.stockService.finalizeTreatmentInvoice(savedInvoice.id!).subscribe({
          next: () => {
            this.loadAllData();
            this.closeLogModal();
          },
          error: (err) => {
            this.toast.error(err.error?.detail || err.error?.message || err.message || 'Error finalizing treatment session. Check stock levels.');
          }
        });
      },
      error: (err) => {
        this.toast.error(err.error?.detail || err.error?.message || err.message || 'Error saving draft. Check input values.');
      }
    });
  }

  finalizeInvoice(inv: TreatmentInvoice) {
    this.stockService.finalizeTreatmentInvoice(inv.id!).subscribe({
      next: () => {
        this.loadAllData();
      },
      error: (err) => {
        this.toast.error(err.error?.detail || err.error?.message || err.message || 'Error finalizing treatment session. Check stock levels.');
      }
    });
  }

  async cancelInvoice(inv: TreatmentInvoice) {
    const confirmed = await this.confirmDialog.confirm(
      "Are you sure you want to cancel this treatment session? Consumed materials will be refunded to stock.",
      { danger: true, confirmLabel: 'Cancel Session' }
    );
    if (!confirmed) return;

    this.stockService.cancelTreatmentInvoice(inv.id!).subscribe({
      next: () => {
        this.toast.success('Treatment session cancelled and materials refunded.');
        this.loadAllData();
      },
      error: (err) => {
        this.toast.error(err.error?.detail || err.error?.message || 'Could not cancel the treatment session.');
      }
    });
  }

  async deleteInvoice(inv: TreatmentInvoice) {
    const confirmed = await this.confirmDialog.confirm(
      "Are you sure you want to delete this draft treatment session?",
      { danger: true, confirmLabel: 'Delete' }
    );
    if (!confirmed) return;

    this.stockService.deleteTreatmentInvoice(inv.id!).subscribe({
      next: () => {
        this.toast.success('Draft treatment session deleted.');
        this.loadAllData();
      },
      error: (err) => {
        this.toast.error(err.error?.detail || err.error?.message || 'Could not delete the draft.');
      }
    });
  }

  getInvoiceStatusClasses(status: TreatmentInvoiceStatus): string {
    switch (status) {
      case 'DRAFT':
        return 'bg-gray-50 text-gray-600 border-gray-200';
      case 'FINALIZED':
        return 'bg-emerald-50 text-emerald-600 border-emerald-200';
      case 'CANCELLED':
        return 'bg-red-50 text-red-600 border-red-200';
      case 'REFUNDED':
        return 'bg-amber-50 text-amber-500 border-amber-200';
      default:
        return 'bg-gray-50 text-gray-600 border-gray-200';
    }
  }
}
