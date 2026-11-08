import { Component, signal, computed, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { Subject, debounceTime, distinctUntilChanged, takeUntil } from 'rxjs';
import { StockService, StockItemRequestPayload } from '../../../../core/services/stock.service';
import {
  StockItem, StockCategory, Supplier, StockMovement, MovementType,
  STOCK_CATEGORIES, MOVEMENT_TYPES
} from '../../../../core/models/stock.model';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { ConfirmDialogService } from '../../../../core/services/confirm-dialog.service';
import { ToastService } from '../../../../core/services/toast.service';
import { DialogDirective } from '../../../../shared/ui/dialog.directive';

@Component({
  selector: 'app-stock-dashboard',
  standalone: true,
  imports: [RouterLinkActive, DialogDirective, CommonModule, FormsModule, TranslateModule, RouterLink],
  template: `
    <div class="p-6 max-w-7xl mx-auto space-y-6">
      
      <!-- Top Title Bar -->
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 class="text-3xl font-bold tracking-tight text-ink-900">{{ "STOCK.TITLE" | translate }}</h1>
          <p class="text-sm text-ink-500">{{ "STOCK.SUBTITLE" | translate }}</p>
        </div>
        <div class="flex items-center gap-3">
          <button type="button" (click)="openAddModal()" class="flex items-center gap-2 px-4 py-2.5 bg-petrol-600 text-white font-medium rounded-xl hover:bg-petrol-700 transition shadow-sm">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            {{ "STOCK.ADD_NEW_ITEM" | translate }}
          </button>
        </div>
      </div>

      <!-- Module Navigation Pills -->
      <div class="flex flex-wrap gap-2 bg-ortho-navy/[0.03] p-1.5 rounded-xl border border-ortho-navy/5 max-w-max font-semibold text-xs">
        <a routerLink="/stock" routerLinkActive="bg-white text-ink-900 shadow-sm" ariaCurrentWhenActive="page" [routerLinkActiveOptions]="{ exact: true }" class="px-4 py-2 rounded-lg transition text-ink-600 hover:text-ink-900 hover:bg-white/50">
          {{ "STOCK.CATALOG" | translate }}
        </a>
        <a routerLink="/stock/procurement" routerLinkActive="bg-white text-ink-900 shadow-sm" ariaCurrentWhenActive="page" [routerLinkActiveOptions]="{ exact: true }" class="px-4 py-2 rounded-lg transition text-ink-600 hover:text-ink-900 hover:bg-white/50">
          {{ "STOCK.PROCUREMENT" | translate }}
        </a>
        <a routerLink="/stock/direct-sales" routerLinkActive="bg-white text-ink-900 shadow-sm" ariaCurrentWhenActive="page" [routerLinkActiveOptions]="{ exact: true }" class="px-4 py-2 rounded-lg transition text-ink-600 hover:text-ink-900 hover:bg-white/50">
          {{ "STOCK.SALES" | translate }}
        </a>
        <a routerLink="/stock/treatment-sessions" routerLinkActive="bg-white text-ink-900 shadow-sm" ariaCurrentWhenActive="page" [routerLinkActiveOptions]="{ exact: true }" class="px-4 py-2 rounded-lg transition text-ink-600 hover:text-ink-900 hover:bg-white/50">
          {{ "STOCK.TREATMENT_SESSIONS" | translate }}
        </a>
        <a routerLink="/stock/leakage" routerLinkActive="bg-white text-ink-900 shadow-sm" ariaCurrentWhenActive="page" [routerLinkActiveOptions]="{ exact: true }" class="px-4 py-2 rounded-lg transition text-ink-600 hover:text-ink-900 hover:bg-white/50">
          {{ "STOCK.LEAKAGE" | translate }}
        </a>
        <a routerLink="/stock/forecast" routerLinkActive="bg-white text-ink-900 shadow-sm" ariaCurrentWhenActive="page" [routerLinkActiveOptions]="{ exact: true }" class="px-4 py-2 rounded-lg transition text-ink-600 hover:text-ink-900 hover:bg-white/50">
          {{ "STOCK.FORECAST" | translate }}
        </a>
      </div>

      <!-- KPI Summary Dashboard -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
        
        <!-- {{ "STOCK.TOTAL_ITEMS" | translate }} -->
        <div class="bg-white p-5 rounded-2xl border border-ortho-navy/5 shadow-sm hover:shadow transition flex items-center gap-4">
          <div class="p-3 bg-ortho-navy/5 text-ink-900 rounded-xl">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line></svg>
          </div>
          <div>
            <div class="text-xs text-ink-500 font-semibold uppercase tracking-wider">{{ "STOCK.TOTAL_ITEMS" | translate }}</div>
            <div class="text-2xl font-bold text-ink-900">{{ kpiTotalItems() }}</div>
          </div>
        </div>

        <!-- {{ "STOCK.OUT_OF_STOCK" | translate }} -->
        <div class="bg-white p-5 rounded-2xl border border-ortho-navy/5 shadow-sm hover:shadow transition flex items-center gap-4">
          <div class="p-3 bg-red-50 text-red-700 rounded-xl" [class.animate-pulse]="kpiOutOfStock() > 0">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
          </div>
          <div>
            <div class="text-xs text-ink-500 font-semibold uppercase tracking-wider">{{ "STOCK.OUT_OF_STOCK" | translate }}</div>
            <div class="text-2xl font-bold" [class.text-red-700]="kpiOutOfStock() > 0" [class.text-ink-900]="kpiOutOfStock() === 0">{{ kpiOutOfStock() }}</div>
          </div>
        </div>

        <!-- {{ "STOCK.LOW_STOCK" | translate }} -->
        <div class="bg-white p-5 rounded-2xl border border-ortho-navy/5 shadow-sm hover:shadow transition flex items-center gap-4">
          <div class="p-3 bg-amber-50 text-amber-700 rounded-xl">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
          </div>
          <div>
            <div class="text-xs text-ink-500 font-semibold uppercase tracking-wider">{{ "STOCK.LOW_STOCK" | translate }}</div>
            <div class="text-2xl font-bold" [class.text-amber-700]="kpiLowStock() > 0" [class.text-ink-900]="kpiLowStock() === 0">{{ kpiLowStock() }}</div>
          </div>
        </div>

        <!-- Valuation -->
        <div class="bg-white p-5 rounded-2xl border border-ortho-navy/5 shadow-sm hover:shadow transition flex items-center gap-4">
          <div class="p-3 bg-emerald-50 text-emerald-700 rounded-xl">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
          </div>
          <div>
            <div class="text-xs text-ink-500 font-semibold uppercase tracking-wider">{{ "STOCK.VALUATION" | translate }}</div>
            <div class="text-2xl font-bold text-emerald-700">{{ kpiValuation() | number:'1.2-2' }} DH</div>
          </div>
        </div>

      </div>

      <!-- Navigation Tabs -->
      <div class="border-b border-ortho-navy/10 flex flex-wrap gap-x-6 gap-y-1">
        <button type="button" (click)="activeTab.set('catalog')" class="pb-3 text-sm font-semibold transition" [class.text-ink-900]="activeTab() === 'catalog'" [class.border-b-2]="activeTab() === 'catalog'" [class.border-petrol-600]="activeTab() === 'catalog'" [class.text-ink-500]="activeTab() !== 'catalog'">
          {{ "STOCK.CATALOG" | translate }}
        </button>
        <button type="button" (click)="activeTab.set('movements')" class="pb-3 text-sm font-semibold transition" [class.text-ink-900]="activeTab() === 'movements'" [class.border-b-2]="activeTab() === 'movements'" [class.border-petrol-600]="activeTab() === 'movements'" [class.text-ink-500]="activeTab() !== 'movements'">
          {{ "STOCK.MOVEMENTS" | translate }}
        </button>
        <button type="button" (click)="activeTab.set('suppliers')" class="pb-3 text-sm font-semibold transition" [class.text-ink-900]="activeTab() === 'suppliers'" [class.border-b-2]="activeTab() === 'suppliers'" [class.border-petrol-600]="activeTab() === 'suppliers'" [class.text-ink-500]="activeTab() !== 'suppliers'">
          {{ "STOCK.SUPPLIER" | translate }}
        </button>
        <button type="button" (click)="activeTab.set('reconciliation')" class="pb-3 text-sm font-semibold transition" [class.text-ink-900]="activeTab() === 'reconciliation'" [class.border-b-2]="activeTab() === 'reconciliation'" [class.border-petrol-600]="activeTab() === 'reconciliation'" [class.text-ink-500]="activeTab() !== 'reconciliation'">
          {{ "STOCK.RECONCILIATION" | translate }}
        </button>
      </div>

      <!-- Content Views -->
      @if (activeTab() === 'catalog') {
        
        <!-- Catalog Tab -->
        <div class="bg-white rounded-2xl border border-ortho-navy/5 shadow-sm overflow-hidden">
          
                <!-- Filters & Search Bar -->
          <div class="p-4 border-b border-ortho-navy/5 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-ortho-navy/[0.01]">
            <div class="relative max-w-md w-full">
              <span class="absolute inset-y-0 start-0 ps-3 flex items-center text-ink-500">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              </span>
              <input
                id="catalog-search" [attr.aria-label]="'STOCK.UI.SEARCH_CATALOG' | translate"
                type="text"
                [ngModel]="catalogSearchValue"
                (ngModelChange)="onCatalogSearchChange($event)"
                [placeholder]="'STOCK.UI.SEARCH_CATALOG' | translate"
                class="w-full ps-10 pe-4 py-2 border border-ortho-navy/10 rounded-xl text-sm focus:outline-none focus:border-petrol-600 transition"
              />
            </div>

            <div class="flex items-center gap-3 self-end">
              <label class="sr-only" for="catalog-category">{{ 'STOCK.CATEGORY' | translate }}</label>
              <select
                id="catalog-category"
                [ngModel]="catalogCategory()"
                (ngModelChange)="onCatalogCategoryChange($event)"
                class="px-3 py-2 border border-ortho-navy/10 rounded-xl text-sm bg-white focus:outline-none focus:border-petrol-600 transition"
              >
                @for (cat of stockCategories; track cat.value) {
                  <option [value]="cat.value">{{ cat.label }}</option>
                }
              </select>
            </div>
          </div>

                    <!-- Catalog Table -->
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse text-sm">
              <thead>
                <tr class="bg-ortho-navy/[0.02] text-ink-500 font-semibold border-b border-ortho-navy/5">
                  <th scope="col" class="p-4" [attr.aria-sort]="ariaSort('catalog','sku')">
                    <button type="button" class="sort-button group" (click)="sortCatalog('sku')">{{ 'STOCK.UI.SKU_CODE' | translate }} <span aria-hidden="true" class="opacity-50 group-hover:opacity-100">{{ getSortIcon('catalog','sku') }}</span></button>
                  </th>
                  <th scope="col" class="p-4" [attr.aria-sort]="ariaSort('catalog','name')">
                    <button type="button" class="sort-button group" (click)="sortCatalog('name')">{{ 'STOCK.UI.ITEM_NAME' | translate }} <span aria-hidden="true" class="opacity-50 group-hover:opacity-100">{{ getSortIcon('catalog','name') }}</span></button>
                  </th>
                  <th scope="col" class="p-4" [attr.aria-sort]="ariaSort('catalog','category')">
                    <button type="button" class="sort-button group" (click)="sortCatalog('category')">{{ 'STOCK.UI.CATEGORY' | translate }} <span aria-hidden="true" class="opacity-50 group-hover:opacity-100">{{ getSortIcon('catalog','category') }}</span></button>
                  </th>
                  <th scope="col" class="p-4 text-center" [attr.aria-sort]="ariaSort('catalog','currentStock')">
                    <button type="button" class="sort-button group justify-center" (click)="sortCatalog('currentStock')">{{ 'STOCK.UI.AVAILABLE' | translate }} <span aria-hidden="true" class="opacity-50 group-hover:opacity-100">{{ getSortIcon('catalog','currentStock') }}</span></button>
                  </th>
                  <th scope="col" class="p-4 text-right" [attr.aria-sort]="ariaSort('catalog','purchasePrice')">
                    <button type="button" class="sort-button group justify-end" (click)="sortCatalog('purchasePrice')">{{ 'STOCK.UI.UNIT_COST' | translate }} <span aria-hidden="true" class="opacity-50 group-hover:opacity-100">{{ getSortIcon('catalog','purchasePrice') }}</span></button>
                  </th>
                  <th scope="col" class="p-4 text-right" [attr.aria-sort]="ariaSort('catalog','pricePerUse')">
                    <button type="button" class="sort-button group justify-end" (click)="sortCatalog('pricePerUse')">{{ 'STOCK.UI.USAGE_COST' | translate }} <span aria-hidden="true" class="opacity-50 group-hover:opacity-100">{{ getSortIcon('catalog','pricePerUse') }}</span></button>
                  </th>
                  <th scope="col" class="p-4">{{ 'STOCK.UI.SUPPLIER' | translate }}</th>
                  <th scope="col" class="p-4 text-right">{{ 'COMMON.ACTIONS' | translate }}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-ortho-navy/5">
                @for (item of items(); track item.id) {
                  <tr class="hover:bg-ortho-navy/[0.01] transition">
                    <td class="p-4 font-mono text-xs font-semibold text-ink-600">{{ item.sku }}</td>
                    <td class="p-4">
                      <div class="font-bold text-ink-900">{{ item.name }}</div>
                    </td>
                    <td class="p-4">
                      <span class="px-2.5 py-1 text-xs font-medium rounded-full bg-ortho-navy/5 text-ink-900">
                        {{ item.category }}
                      </span>
                    </td>
                    <td class="p-4 text-center">
                      <div class="flex items-center justify-center gap-2">
                        <span class="font-bold" [class.text-red-700]="item.currentStock === 0" [class.text-amber-700]="item.currentStock > 0 && item.currentStock <= item.minimumStock" [class.text-emerald-700]="item.currentStock > item.minimumStock">
                          @if (item.packCount > 0) {
                            <!-- Nobody counts a shelf in millilitres: lead with the bottles. -->
                            <span class="block">{{ item.packCount }} × {{ item.unitLabel }}</span>
                            <span class="block text-[10px] font-normal text-ink-500">
                              {{ item.currentStock }} {{ item.unitSymbol || item.unit || 'units' }}@if (item.packRemainder > 0) { · {{ 'STOCK.PACK_OPEN' | translate: { qty: item.packRemainder, unit: item.unitSymbol } }} }
                            </span>
                          } @else {
                            {{ item.currentStock }} {{ item.unitSymbol || item.unit || 'units' }}
                          }
                          @if (item.usesPerUnit > 1) {
                            <span class="ms-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-bold bg-petrol-50 text-petrol-700"
                                  [title]="'STOCK.UI.USES_IN_SERVICE' | translate">{{ item.usesOnCurrentUnit }}/{{ item.usesPerUnit }}</span>
                          }
                        </span>
                        @if (item.currentStock === 0) {
                          <span class="px-1.5 py-0.5 text-[9px] font-bold bg-red-50 text-red-700 rounded border border-red-200 uppercase">{{ 'STOCK.UI.EMPTY' | translate }}</span>
                        } @else if (item.currentStock <= item.minimumStock) {
                          <span class="px-1.5 py-0.5 text-[9px] font-bold bg-amber-50 text-amber-700 rounded border border-amber-200 uppercase">{{ 'STOCK.UI.LOW' | translate }}</span>
                        }
                      </div>
                    </td>
                    <td class="p-4 text-right font-medium text-ink-700">{{ item.purchasePrice | number:'1.2-2' }} DH <span class="text-[10px] text-ink-500">/{{ item.unitSize }}</span></td>
                    <td class="p-4 text-right font-medium text-emerald-700">{{ item.pricePerUse | number:'1.4-4' }} DH</td>
                    <td class="p-4 text-ink-500 font-medium">{{ item.supplier?.name || 'N/A' }}</td>
                    <td class="p-4 text-right">
                      <div class="flex items-center justify-end gap-2">
                        <button type="button" (click)="openAdjustmentModal(item)" class="px-2.5 py-1 text-xs font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-lg transition border border-emerald-100">
                          {{ 'STOCK.UI.ADJUST' | translate }}
                        </button>
                        <button type="button" (click)="openEditModal(item)" [attr.aria-label]="('COMMON.EDIT' | translate) + ' — ' + item.name" [title]="'COMMON.EDIT' | translate" class="p-1 hover:bg-ortho-navy/5 text-ink-500 hover:text-ink-900 rounded-lg transition">
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>
                        </button>
                        <button type="button" (click)="deleteItem(item)" [attr.aria-label]="('COMMON.DELETE' | translate) + ' — ' + item.name" [title]="'COMMON.DELETE' | translate" class="p-1 hover:bg-red-50 text-red-700/60 hover:text-red-700 rounded-lg transition">
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="9" class="p-8 text-center text-ink-500">{{ 'STOCK.UI.NO_ITEMS' | translate }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>

      } @else if (activeTab() === 'movements') {

        <!-- Movements {{ "STOCK.MOVEMENTS" | translate }} -->
        <div class="bg-white rounded-2xl border border-ortho-navy/5 shadow-sm overflow-hidden">

          <!-- Movements filter bar -->
          <div class="p-4 border-b border-ortho-navy/5 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-ortho-navy/[0.01]">
            <div class="flex items-center gap-2">
              <h2 class="text-base font-bold text-ink-900">{{ "STOCK.MOVEMENTS" | translate }}</h2>
              <span class="text-xs text-ink-500 font-medium hidden md:inline">{{ 'STOCK.UI.MOVES_SUBTITLE' | translate }}</span>
            </div>
            <div class="flex flex-col sm:flex-row items-center gap-3">
              <div class="relative w-full sm:w-64">
                <span class="absolute inset-y-0 start-0 ps-3 flex items-center text-ink-500">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                </span>
                <input
                  id="movements-search" [attr.aria-label]="'STOCK.UI.SEARCH_MOVES' | translate"
                  type="text"
                  [ngModel]="movSearchValue"
                  (ngModelChange)="onMovSearchChange($event)"
                  [placeholder]="'STOCK.UI.SEARCH_MOVES' | translate"
                  class="w-full ps-9 pe-3 py-2 border border-ortho-navy/10 rounded-xl text-sm focus:outline-none focus:border-petrol-600 transition"
                />
              </div>
              <select
                id="movements-type" [attr.aria-label]="'COMMON.TYPE' | translate"
                [ngModel]="movType()"
                (ngModelChange)="onMovTypeChange($event)"
                class="px-3 py-2 border border-ortho-navy/10 rounded-xl text-sm bg-white focus:outline-none focus:border-petrol-600 transition w-full sm:w-auto"
              >
                @for (t of movementTypes; track t.value) {
                  <option [value]="t.value">{{ t.label }}</option>
                }
              </select>
            </div>
          </div>

          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse text-sm">
              <thead>
                <tr class="bg-ortho-navy/[0.02] text-ink-500 font-semibold border-b border-ortho-navy/5">
                  <th scope="col" class="p-4" [attr.aria-sort]="ariaSort('mov','createdAt')">
                    <button type="button" class="sort-button group" (click)="sortMovements('createdAt')">{{ 'STOCK.UI.TIMESTAMP' | translate }} <span aria-hidden="true" class="opacity-50 group-hover:opacity-100">{{ getSortIcon('mov','createdAt') }}</span></button>
                  </th>
                  <th scope="col" class="p-4" [attr.aria-sort]="ariaSort('mov','stockItem')">
                    <button type="button" class="sort-button group" (click)="sortMovements('stockItem')">{{ 'STOCK.UI.ITEM_AND_CODE' | translate }} <span aria-hidden="true" class="opacity-50 group-hover:opacity-100">{{ getSortIcon('mov','stockItem') }}</span></button>
                  </th>
                  <th scope="col" class="p-4" [attr.aria-sort]="ariaSort('mov','movementType')">
                    <button type="button" class="sort-button group" (click)="sortMovements('movementType')">{{ 'COMMON.TYPE' | translate }} <span aria-hidden="true" class="opacity-50 group-hover:opacity-100">{{ getSortIcon('mov','movementType') }}</span></button>
                  </th>
                  <th scope="col" class="p-4 text-center" [attr.aria-sort]="ariaSort('mov','quantity')">
                    <button type="button" class="sort-button group justify-center" (click)="sortMovements('quantity')">{{ 'STOCK.UI.QTY_DELTA' | translate }} <span aria-hidden="true" class="opacity-50 group-hover:opacity-100">{{ getSortIcon('mov','quantity') }}</span></button>
                  </th>
                  <th scope="col" class="p-4 text-center" [attr.aria-sort]="ariaSort('mov','quantityBefore')">
                    <button type="button" class="sort-button group justify-center" (click)="sortMovements('quantityBefore')">{{ 'STOCK.UI.BEFORE' | translate }} <span aria-hidden="true" class="opacity-50 group-hover:opacity-100">{{ getSortIcon('mov','quantityBefore') }}</span></button>
                  </th>
                  <th scope="col" class="p-4 text-center" [attr.aria-sort]="ariaSort('mov','quantityAfter')">
                    <button type="button" class="sort-button group justify-center" (click)="sortMovements('quantityAfter')">{{ 'STOCK.UI.AFTER' | translate }} <span aria-hidden="true" class="opacity-50 group-hover:opacity-100">{{ getSortIcon('mov','quantityAfter') }}</span></button>
                  </th>
                  <th scope="col" class="p-4" [attr.aria-sort]="ariaSort('mov','sourceReference')">
                    <button type="button" class="sort-button group" (click)="sortMovements('sourceReference')">{{ 'STOCK.UI.SOURCE_REF' | translate }} <span aria-hidden="true" class="opacity-50 group-hover:opacity-100">{{ getSortIcon('mov','sourceReference') }}</span></button>
                  </th>
                  <th scope="col" class="p-4">{{ 'COMMON.NOTES' | translate }}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-ortho-navy/5">
                @for (mov of movements(); track mov.id) {
                  <tr class="hover:bg-ortho-navy/[0.01] transition">
                    <td class="p-4 text-xs font-mono text-ink-600">{{ mov.createdAt | date:'yyyy-MM-dd HH:mm:ss' }}</td>
                    <td class="p-4">
                      <div class="font-bold text-ink-900">{{ mov.stockItem?.name }}</div>
                      <div class="text-[10px] text-ink-500">{{ 'STOCK.UI.SKU' | translate }} {{ mov.stockItem?.sku }}</div>
                    </td>
                    <td class="p-4">
                      <span class="px-2.5 py-1 text-[11px] font-semibold rounded-full border" [ngClass]="getMovementTypeClasses(mov.movementType)">
                        {{ mov.movementType }}
                      </span>
                    </td>
                    <td class="p-4 text-center font-bold" [class.text-emerald-700]="isAddition(mov.movementType)" [class.text-red-700]="!isAddition(mov.movementType)">
                      {{ isAddition(mov.movementType) ? '+' : '-' }}{{ mov.quantity }}
                    </td>
                    <td class="p-4 text-center text-ink-600 font-medium">{{ mov.quantityBefore }}</td>
                    <td class="p-4 text-center text-ink-700 font-bold">{{ mov.quantityAfter }}</td>
                    <td class="p-4">
                      <div class="flex items-center gap-1.5">
                        <span class="px-2 py-0.5 bg-gray-50 border border-gray-100 rounded text-[11px] font-bold text-ink-500 font-mono">{{ mov.sourceType }}</span>
                        <span class="font-semibold text-xs text-ink-700">{{ mov.sourceReference }}</span>
                      </div>
                    </td>
                    <td class="p-4 text-ink-500 max-w-xs truncate" [title]="mov.notes">{{ mov.notes || '-' }}</td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="8" class="p-8 text-center text-ink-500">{{ 'STOCK.UI.NO_MOVES' | translate }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>

      } @else if (activeTab() === 'suppliers') {
        
        <!-- {{ "STOCK.SUPPLIER" | translate }} Tab -->
        <div class="bg-white rounded-2xl border border-ortho-navy/5 shadow-sm overflow-hidden">
          
          <div class="p-4 border-b border-ortho-navy/5 flex items-center justify-between bg-ortho-navy/[0.01]">
            <div>
              <h2 class="text-base font-bold text-ink-900">{{ "STOCK.SUPPLIER" | translate }}</h2>
              <p class="text-xs text-ink-500">{{ 'STOCK.UI.SUPPLIERS_SUBTITLE' | translate }}</p>
            </div>
            <button type="button" (click)="openAddSupplierModal()" class="px-3.5 py-1.5 text-xs font-semibold bg-petrol-600 text-white hover:bg-petrol-700 transition rounded-xl shadow-sm">
              {{ 'STOCK.UI.ADD_SUPPLIER' | translate }}
            </button>
          </div>

          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse text-sm">
              <thead>
                <tr class="bg-ortho-navy/[0.02] text-ink-500 font-semibold border-b border-ortho-navy/5">
                  <th scope="col" class="p-4">{{ 'STOCK.UI.COMPANY' | translate }}</th>
                  <th scope="col" class="p-4">{{ 'STOCK.UI.CONTACT_PERSON' | translate }}</th>
                  <th scope="col" class="p-4">{{ 'STOCK.UI.EMAIL' | translate }}</th>
                  <th scope="col" class="p-4">{{ 'STOCK.UI.PHONE' | translate }}</th>
                  <th scope="col" class="p-4">{{ 'STOCK.UI.ADDRESS' | translate }}</th>
                  <th scope="col" class="p-4 text-right">{{ 'COMMON.ACTIONS' | translate }}</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-ortho-navy/5">
                @for (sup of suppliers(); track sup.id) {
                  <tr class="hover:bg-ortho-navy/[0.01] transition">
                    <td class="p-4 font-bold text-ink-900">{{ sup.name }}</td>
                    <td class="p-4 text-ink-700 font-medium">{{ sup.contactName || '-' }}</td>
                    <td class="p-4 text-ink-500 font-medium">{{ sup.email || '-' }}</td>
                    <td class="p-4 text-ink-500 font-medium">{{ sup.phone || '-' }}</td>
                    <td class="p-4 text-ink-500 max-w-xs truncate" [title]="sup.address">{{ sup.address || '-' }}</td>
                    <td class="p-4 text-right">
                      <div class="flex items-center justify-end gap-2">
                        <button type="button" (click)="openEditSupplierModal(sup)" [attr.aria-label]="('COMMON.EDIT' | translate) + ' — ' + sup.name" [title]="'COMMON.EDIT' | translate" class="p-1 hover:bg-ortho-navy/5 text-ink-500 hover:text-ink-900 rounded-lg transition">
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>
                        </button>
                        <button type="button" (click)="deleteSupplier(sup)" [attr.aria-label]="('COMMON.DELETE' | translate) + ' — ' + sup.name" [title]="'COMMON.DELETE' | translate" class="p-1 hover:bg-red-50 text-red-700/60 hover:text-red-700 rounded-lg transition">
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="6" class="p-8 text-center text-ink-500">{{ 'STOCK.UI.NO_SUPPLIERS' | translate }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>

      } @else if (activeTab() === 'reconciliation') {

        <!-- Physical Count & Reconciliation Tab (BR08) -->
        <div class="space-y-6">
          
          @if (activeCountSession()) {
            
            <!-- Active Count Session Form -->
            <div class="bg-white rounded-2xl border border-ortho-navy/5 shadow-sm overflow-hidden animate-fade-in">
              <div class="p-6 border-b border-ortho-navy/5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-ortho-navy/[0.01]">
                <div>
                  <div class="flex items-center gap-2 mb-1">
                    <span class="px-2.5 py-0.5 bg-blue-50 text-blue-700 border border-blue-100 font-mono text-xs font-bold rounded-lg uppercase">
                      {{ activeCountSession().status }}
                    </span>
                    <h2 class="text-lg font-bold text-ink-900 leading-none">{{ 'STOCK.UI.COUNT_ACTIVE' | translate }}</h2>
                  </div>
                  <p class="text-xs text-ink-500 font-semibold">{{ 'STOCK.UI.FROZEN_ON' | translate }} <span class="font-bold text-ink-500">{{ activeCountSession().createdAt | date:'yyyy-MM-dd HH:mm' }}</span></p>
                </div>
                
                <div class="flex items-center gap-2">
                  <button type="button" (click)="cancelReconciliation()" class="px-4 py-2 border border-red-200 text-red-700 hover:bg-red-50 font-semibold rounded-xl text-xs transition">
                    {{ 'STOCK.UI.CANCEL_COUNT' | translate }}
                  </button>
                  <button type="button" (click)="saveDraftCounts()" class="px-4 py-2 border border-ortho-navy/10 hover:bg-gray-50 text-ink-600 font-semibold rounded-xl text-xs transition">
                    {{ 'STOCK.UI.SAVE_DRAFT' | translate }}
                  </button>
                  <button type="button" (click)="postReconciliation()" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl text-xs transition shadow-sm">
                    {{ 'STOCK.UI.POST_COUNT' | translate }}
                  </button>
                </div>
              </div>

              <!-- Lines Table -->
              <div class="overflow-x-auto">
                <table class="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr class="bg-ortho-navy/[0.02] text-ink-500 font-semibold border-b border-ortho-navy/5">
                      <th scope="col" class="p-4">{{ 'STOCK.UI.SKU' | translate }}</th>
                      <th scope="col" class="p-4">{{ 'STOCK.UI.ITEM_NAME' | translate }}</th>
                      <th scope="col" class="p-4 text-center">{{ 'STOCK.UI.THEORETICAL' | translate }}</th>
                      <th scope="col" class="p-4 text-center" style="width: 150px;">{{ 'STOCK.UI.PHYSICAL' | translate }}</th>
                      <th scope="col" class="p-4 text-center">{{ 'STOCK.UI.QTY_VARIANCE' | translate }}</th>
                      <th scope="col" class="p-4 text-right">{{ 'STOCK.UI.UNIT_PRICE' | translate }}</th>
                      <th scope="col" class="p-4 text-right">{{ 'STOCK.UI.COST_VARIANCE' | translate }}</th>
                      <th scope="col" class="p-4">{{ 'STOCK.UI.REMARKS' | translate }}</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-ortho-navy/5 font-medium">
                    @for (line of activeCountSession().lines; track line.id) {
                      <tr class="hover:bg-ortho-navy/[0.01] transition">
                        <td class="p-4 font-mono text-xs text-ink-600">{{ line.stockItem.sku }}</td>
                        <td class="p-4 text-ink-900 font-bold">{{ line.stockItem.name }}</td>
                        <td class="p-4 text-center font-mono text-ink-500">{{ line.theoreticalQuantity }}</td>
                        <td class="p-4 text-center">
                          <input [attr.aria-label]="'STOCK.UI.PHYSICAL' | translate" type="number" [(ngModel)]="physicalCountsMap[line.stockItem.id].physicalQuantity" min="0" step="any" class="w-full px-2.5 py-1.5 border border-ortho-navy/10 rounded-lg text-center font-mono text-xs focus:outline-none focus:border-petrol-600 bg-white" />
                        </td>
                        <td class="p-4 text-center font-mono">
                          @let qVar = calculateLineVariance(line.theoreticalQuantity, line.stockItem.id);
                          <span class="px-2 py-0.5 rounded text-xs font-bold" [ngClass]="qVar > 0 ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : qVar < 0 ? 'bg-red-50 text-red-700 border border-red-100' : 'bg-gray-50 text-gray-400 border border-gray-100'">
                            {{ qVar > 0 ? '+' : '' }}{{ qVar }}
                          </span>
                        </td>
                        <td class="p-4 text-right text-ink-500">{{ line.stockItem.purchasePrice | number:'1.2-2' }} DH</td>
                        <td class="p-4 text-right font-bold font-mono">
                          @let cVar = calculateLineCostVariance(line.theoreticalQuantity, line.stockItem.purchasePrice, line.stockItem.id);
                          <span [ngClass]="cVar > 0 ? 'text-emerald-700' : cVar < 0 ? 'text-red-700' : 'text-ink-500'">
                            {{ cVar > 0 ? '+' : '' }}{{ cVar | number:'1.2-2' }} DH
                          </span>
                        </td>
                        <td class="p-4">
                          <input [attr.aria-label]="'STOCK.UI.REMARKS' | translate" type="text" [(ngModel)]="physicalCountsMap[line.stockItem.id].notes" [placeholder]="'STOCK.UI.VARIANCE_REASON' | translate" class="w-full px-2 py-1 border border-ortho-navy/10 rounded text-xs bg-white" />
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>

              <!-- Cumulative Impact Bar -->
              <div class="p-4 bg-gray-50 border-t border-ortho-navy/5 flex items-center justify-between font-bold text-xs text-ink-900 uppercase tracking-wider">
                <span>{{ 'STOCK.UI.VARIANCE_SUMMARY' | translate }}</span>
                <div class="flex items-center gap-6 font-mono normal-case">
                  <div>
                    <span class="text-ink-500 uppercase text-[10px] tracking-wide block">{{ 'STOCK.UI.TOTAL_QTY_VARIANCE' | translate }}</span>
                    <span class="text-sm font-extrabold" [ngClass]="getRunningVarianceSum().qty > 0 ? 'text-emerald-700' : getRunningVarianceSum().qty < 0 ? 'text-red-700' : 'text-ink-900'">
                      {{ getRunningVarianceSum().qty > 0 ? '+' : '' }}{{ getRunningVarianceSum().qty }}
                    </span>
                  </div>
                  <div>
                    <span class="text-ink-500 uppercase text-[10px] tracking-wide block">{{ 'STOCK.UI.COST_IMPACT' | translate }}</span>
                    <span class="text-sm font-extrabold" [ngClass]="getRunningVarianceSum().cost > 0 ? 'text-emerald-700' : getRunningVarianceSum().cost < 0 ? 'text-red-700' : 'text-ink-900'">
                      {{ getRunningVarianceSum().cost > 0 ? '+' : '' }}{{ getRunningVarianceSum().cost | number:'1.2-2' }} DH
                    </span>
                  </div>
                </div>
              </div>
            </div>

          @} @else {
            
            <!-- Create Count Session (BR08 counting session setup) -->
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
              
              <!-- Setup session card -->
              <div class="bg-white p-6 rounded-2xl border border-ortho-navy/5 shadow-sm space-y-4">
                <div>
                  <h2 class="text-lg font-bold text-ink-900">{{ 'STOCK.UI.NEW_COUNT' | translate }}</h2>
                  <p class="text-xs text-ink-500">{{ 'STOCK.UI.NEW_COUNT_HINT' | translate }}</p>
                </div>

                <div class="space-y-2">
                  <label for="stock-dashboard-reconciliationNotes" class="block text-[10px] font-bold text-ink-500 uppercase">{{ 'STOCK.UI.COUNT_NOTES' | translate }}</label>
                  <textarea id="stock-dashboard-reconciliationNotes" [(ngModel)]="reconciliationNotes" [placeholder]="'STOCK.UI.COUNT_NOTES_HINT' | translate" rows="3" class="w-full px-3 py-2 border border-ortho-navy/10 rounded-xl text-xs bg-white focus:outline-none focus:border-petrol-600 transition"></textarea>
                </div>

                <button type="button" (click)="startCountSession()" class="w-full py-2.5 bg-petrol-600 text-white hover:bg-petrol-700 font-semibold rounded-xl text-xs transition shadow-sm flex items-center justify-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"></path><path d="m9 12 2 2 4-4"></path></svg>
                  {{ 'STOCK.UI.START_COUNT' | translate }}
                </button>
              </div>

              <!-- Past Sessions List -->
              <div class="lg:col-span-2 bg-white rounded-2xl border border-ortho-navy/5 shadow-sm overflow-hidden flex flex-col">
                <div class="p-4 border-b border-ortho-navy/5 bg-ortho-navy/[0.01]">
                  <h2 class="text-base font-bold text-ink-900">{{ 'STOCK.UI.COUNT_HISTORY' | translate }}</h2>
                  <p class="text-xs text-ink-500">{{ 'STOCK.UI.COUNT_HISTORY_HINT' | translate }}</p>
                </div>

                <div class="overflow-x-auto flex-1">
                  <table class="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr class="bg-ortho-navy/[0.02] text-ink-500 font-semibold border-b border-ortho-navy/5">
                        <th scope="col" class="p-4">{{ 'STOCK.UI.COUNT_ID' | translate }}</th>
                        <th scope="col" class="p-4">{{ 'COMMON.STATUS' | translate }}</th>
                        <th scope="col" class="p-4">{{ 'STOCK.UI.FROZEN_DATE' | translate }}</th>
                        <th scope="col" class="p-4 text-center">{{ 'STOCK.UI.QTY_VARIANCE' | translate }}</th>
                        <th scope="col" class="p-4 text-right">{{ 'STOCK.UI.COST_VARIANCE' | translate }}</th>
                        <th scope="col" class="p-4">{{ 'STOCK.UI.VALIDATED_BY' | translate }}</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-ortho-navy/5 font-semibold">
                      @for (sess of countSessions(); track sess.id) {
                        <tr class="hover:bg-ortho-navy/[0.01] transition text-xs font-semibold">
                          <td class="p-4 font-mono text-ink-900">{{ sess.sessionNumber || sess.id.substring(0,8) }}</td>
                          <td class="p-4">
                            <span class="px-2 py-0.5 rounded text-[10px] font-bold border" [ngClass]="sess.status === 'VALIDATED' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-red-50 text-red-700 border-red-100'">
                              {{ sess.status }}
                            </span>
                          </td>
                          <td class="p-4 text-ink-500">{{ sess.createdAt | date:'yyyy-MM-dd HH:mm' }}</td>
                          <td class="p-4 text-center font-mono" [ngClass]="sess.totalQuantityVariance > 0 ? 'text-emerald-700' : sess.totalQuantityVariance < 0 ? 'text-red-700' : 'text-ink-500'">
                            {{ sess.totalQuantityVariance > 0 ? '+' : '' }}{{ sess.totalQuantityVariance || 0 }}
                          </td>
                          <td class="p-4 text-right font-bold font-mono" [ngClass]="sess.totalCostVariance > 0 ? 'text-emerald-700' : sess.totalCostVariance < 0 ? 'text-red-700' : 'text-ink-500'">
                            {{ sess.totalCostVariance > 0 ? '+' : '' }}{{ (sess.totalCostVariance || 0) | number:'1.2-2' }} DH
                          </td>
                          <td class="p-4 text-ink-500">{{ sess.validatedBy || '-' }}</td>
                        </tr>
                      } @empty {
                        <tr>
                          <td colspan="6" class="p-8 text-center text-ink-500">{{ 'STOCK.UI.NO_COUNTS' | translate }}</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              </div>

            </div>

          }

        </div>

      }

      <!-- Add/Edit Stock Item Modal -->
      @if (showItemModal()) {
        <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ortho-navy/60 backdrop-blur-sm">
          <div appDialog="stock-item-title" (dialogClosed)="closeItemModal()" class="bg-white rounded-2xl max-w-lg w-full overflow-hidden border border-ortho-navy/5 shadow-2xl animate-fade-in">
            <div class="px-6 py-4 border-b border-ortho-navy/5 flex items-center justify-between bg-ortho-navy/[0.01]">
              <h2 id="stock-item-title" class="text-lg font-bold text-ink-900">{{ (editMode() ? 'STOCK.UI.EDIT_ITEM' : 'STOCK.UI.ADD_ITEM') | translate }}</h2>
              <button [attr.aria-label]="'COMMON.CLOSE' | translate" type="button" (click)="closeItemModal()" class="p-1 text-ink-500 hover:text-ink-900 hover:bg-ortho-navy/5 rounded-lg transition">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>
            
            <form (submit)="saveItem()" class="p-6 space-y-4">
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label for="stock-dashboard-itemForm-name" class="block text-xs font-bold text-ink-500 uppercase tracking-wide mb-1">{{ 'STOCK.UI.ITEM_NAME' | translate }} <span aria-hidden="true">*</span></label>
                  <input id="stock-dashboard-itemForm-name" type="text" [(ngModel)]="itemForm.name" name="name" required class="w-full px-3 py-2 border border-ortho-navy/10 rounded-xl text-sm focus:outline-none focus:border-petrol-600 transition bg-white" />
                </div>
                <div>
                  <label for="stock-dashboard-itemForm-sku" class="block text-xs font-bold text-ink-500 uppercase tracking-wide mb-1">{{ 'STOCK.UI.SKU_FIELD' | translate }} <span aria-hidden="true">*</span></label>
                  <input id="stock-dashboard-itemForm-sku" type="text" [(ngModel)]="itemForm.sku" name="sku" required class="w-full px-3 py-2 border border-ortho-navy/10 rounded-xl text-sm focus:outline-none focus:border-petrol-600 transition font-mono uppercase bg-white" />
                </div>
              </div>

              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label for="stock-dashboard-itemForm-category" class="block text-xs font-bold text-ink-500 uppercase tracking-wide mb-1">{{ 'STOCK.UI.CATEGORY' | translate }} <span aria-hidden="true">*</span></label>
                  <select id="stock-dashboard-itemForm-category" [(ngModel)]="itemForm.category" name="category" required class="w-full px-3 py-2 border border-ortho-navy/10 rounded-xl text-sm focus:outline-none focus:border-petrol-600 transition bg-white">
                    @for (cat of stockCategoriesNoAll; track cat.value) {
                      <option [value]="cat.value">{{ cat.label }}</option>
                    }
                  </select>
                </div>
                <div>
                  <label for="stock-dashboard-selectedSupplierId" class="block text-xs font-bold text-ink-500 uppercase tracking-wide mb-1">{{ 'STOCK.UI.SUPPLIER' | translate }} <span aria-hidden="true">*</span></label>
                  <select id="stock-dashboard-selectedSupplierId" [(ngModel)]="selectedSupplierId" name="supplierId" class="w-full px-3 py-2 border border-ortho-navy/10 rounded-xl text-sm focus:outline-none focus:border-petrol-600 transition bg-white">
                    <option [value]="null">{{ 'STOCK.UI.NO_SUPPLIER' | translate }}</option>
                    @for (sup of suppliers(); track sup.id) {
                      <option [value]="sup.id">{{ sup.name }}</option>
                    }
                  </select>
                </div>
              </div>

              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label for="stock-dashboard-itemForm-currentStock" class="block text-xs font-bold text-ink-500 uppercase tracking-wide mb-1">
                    {{ (editMode() ? 'STOCK.UI.CURRENT_STOCK' : 'STOCK.UI.OPENING_STOCK') | translate }}
                  </label>
                  <input id="stock-dashboard-itemForm-currentStock" type="number" [(ngModel)]="itemForm.currentStock" name="currentStock" [required]="!editMode()" [disabled]="editMode()" min="0" class="w-full px-3 py-2 border border-ortho-navy/10 rounded-xl text-sm focus:outline-none focus:border-petrol-600 transition bg-white disabled:bg-slate-100 disabled:text-slate-500" />
                  @if (editMode()) {
                    <p class="mt-1 text-xs text-ink-500">{{ 'STOCK.UI.USE_ADJUST' | translate }}</p>
                  }
                </div>
                <div>
                  <label for="stock-dashboard-itemForm-minimumStock" class="block text-xs font-bold text-ink-500 uppercase tracking-wide mb-1">{{ 'STOCK.UI.MIN_ALERT' | translate }} <span aria-hidden="true">*</span></label>
                  <input id="stock-dashboard-itemForm-minimumStock" type="number" [(ngModel)]="itemForm.minimumStock" name="minimumStock" required min="0" class="w-full px-3 py-2 border border-ortho-navy/10 rounded-xl text-sm focus:outline-none focus:border-petrol-600 transition bg-white" />
                </div>
              </div>

              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label for="stock-dashboard-itemForm-purchasePrice" class="block text-xs font-bold text-ink-500 uppercase tracking-wide mb-1">{{ 'STOCK.UI.BULK_PRICE' | translate }} <span aria-hidden="true">*</span></label>
                  <input id="stock-dashboard-itemForm-purchasePrice" type="number" step="0.01" [(ngModel)]="itemForm.purchasePrice" name="purchasePrice" required min="0" class="w-full px-3 py-2 border border-ortho-navy/10 rounded-xl text-sm focus:outline-none focus:border-petrol-600 transition bg-white" />
                </div>
                <div>
                  <label for="stock-dashboard-itemForm-unitSize" class="block text-xs font-bold text-ink-500 uppercase tracking-wide mb-1">{{ 'STOCK.UI.PACK_SIZE' | translate }} <span aria-hidden="true">*</span></label>
                  <input id="stock-dashboard-itemForm-unitSize" type="number" [(ngModel)]="itemForm.unitSize" name="unitSize" required min="1" class="w-full px-3 py-2 border border-ortho-navy/10 rounded-xl text-sm focus:outline-none focus:border-petrol-600 transition bg-white" />
                </div>
              </div>

              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label for="stock-dashboard-itemForm-unitOfMeasure" class="block text-xs font-bold text-ink-500 uppercase tracking-wide mb-1">{{ 'STOCK.UI.UOM' | translate }} <span aria-hidden="true">*</span></label>
                  <select id="stock-dashboard-itemForm-unitOfMeasure" [ngModel]="itemForm.unitOfMeasure" (ngModelChange)="chooseUnit($event)" name="unitOfMeasure" required class="w-full px-3 py-2 border border-ortho-navy/10 rounded-xl text-sm focus:outline-none focus:border-petrol-600 transition bg-white">
                    @for (u of unitOptions; track u.value) {
                      <option [value]="u.value">{{ u.label }}</option>
                    }
                  </select>
                </div>
                <div>
                  <label for="stock-dashboard-itemForm-usesPerUnit" class="block text-xs font-bold text-ink-500 uppercase tracking-wide mb-1">{{ 'STOCK.UI.USES_PER_UNIT' | translate }}</label>
                  <input id="stock-dashboard-itemForm-usesPerUnit" type="number" [(ngModel)]="itemForm.usesPerUnit" name="usesPerUnit" min="1" max="1000" class="w-full px-3 py-2 border border-ortho-navy/10 rounded-xl text-sm focus:outline-none focus:border-petrol-600 transition bg-white" />
                  <p class="mt-1 text-[10px] text-ink-500">
                    {{ 'STOCK.UI.USES_PER_UNIT_HINT' | translate }}
                  </p>
                </div>
                <div class="flex items-center pt-5">
                  <label class="flex items-center gap-2 text-xs font-bold text-ink-500 uppercase tracking-wide cursor-pointer select-none">
                    <input type="checkbox" [(ngModel)]="itemForm.decimalSupported" name="decimalSupported" class="w-4 h-4 rounded border-gray-300 text-ink-900 focus:ring-petrol-500" />
                    {{ 'STOCK.UI.DECIMALS' | translate }}
                  </label>
                </div>
              </div>

              <!-- Storage location and batch number were collected here and
                   then dropped: StockItem has no such columns in the entity,
                   the DTO or the database, and saveItem() never put them in
                   the payload. Restore these inputs when the backend grows
                   the fields (a migration, two entity columns and two
                   StockItemResponse/Request fields), not before. -->

              <div class="flex items-center justify-end gap-3 pt-4 border-t border-ortho-navy/5">
                <button type="button" (click)="closeItemModal()" class="px-4 py-2 border border-ortho-navy/10 rounded-xl text-sm font-semibold hover:bg-gray-50 transition text-ink-600">{{ 'COMMON.CANCEL' | translate }}</button>
                <button type="submit" class="px-5 py-2 bg-petrol-600 text-white rounded-xl text-sm font-semibold hover:bg-petrol-700 transition shadow-sm">{{ 'STOCK.UI.SAVE_ITEM' | translate }}</button>
              </div>
            </form>
          </div>
        </div>
      }

      <!-- Manual Stock Adjustment Modal -->
      @if (showAdjustmentModal()) {
        <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ortho-navy/60 backdrop-blur-sm">
          <div appDialog="stock-adjust-title" (dialogClosed)="closeAdjustmentModal()" class="bg-white rounded-2xl max-w-md w-full overflow-hidden border border-ortho-navy/5 shadow-2xl animate-fade-in">
            <div class="px-6 py-4 border-b border-ortho-navy/5 flex items-center justify-between bg-ortho-navy/[0.01]">
              <h2 id="stock-adjust-title" class="text-lg font-bold text-ink-900">{{ 'STOCK.UI.ADJUSTMENT' | translate }}</h2>
              <button [attr.aria-label]="'COMMON.CLOSE' | translate" type="button" (click)="closeAdjustmentModal()" class="p-1 text-ink-500 hover:text-ink-900 hover:bg-ortho-navy/5 rounded-lg transition">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>
            
            <form (submit)="saveAdjustment()" class="p-6 space-y-4">
              <div>
                <span class="text-xs text-ink-500 font-bold block mb-1 uppercase tracking-wider">{{ 'STOCK.UI.STOCK_ITEM' | translate }}</span>
                <span class="font-bold text-ink-900 block text-base">{{ selectedItem()?.name }}</span>
                <span class="text-xs text-ink-500 block font-medium">
                  {{ 'STOCK.UI.CURRENT_STOCK' | translate }} : {{ selectedItem()?.currentStock }} {{ selectedItem()?.unitSymbol || selectedItem()?.unit || ('STOCK.UI.UNITS' | translate) }}
                  @if ((selectedItem()?.packCount ?? 0) > 0) {
                    <span class="text-ink-900 font-bold">({{ selectedItem()?.packCount }} × {{ selectedItem()?.unitLabel }})</span>
                  }
                </span>
              </div>
              
              <div>
                <label for="stock-dashboard-adjustmentQty" class="block text-xs font-bold text-ink-500 uppercase tracking-wide mb-1">{{ 'STOCK.UI.ADJUST_DELTA' | translate }} <span aria-hidden="true">*</span></label>
                <input id="stock-dashboard-adjustmentQty" type="number" [(ngModel)]="adjustmentQty" name="adjustmentQty" required class="w-full px-3 py-2 border border-ortho-navy/10 rounded-xl text-sm focus:outline-none focus:border-petrol-600 transition bg-white" [placeholder]="'STOCK.UI.ADJUST_DELTA_HINT' | translate" />
              </div>

              <div>
                <label for="stock-dashboard-adjustmentReason" class="block text-xs font-bold text-ink-500 uppercase tracking-wide mb-1">{{ 'STOCK.UI.ADJUST_REASON' | translate }} <span aria-hidden="true">*</span></label>
                <textarea id="stock-dashboard-adjustmentReason" [(ngModel)]="adjustmentReason" required rows="3" name="reason" class="w-full px-3 py-2 border border-ortho-navy/10 rounded-xl text-sm focus:outline-none focus:border-petrol-600 transition bg-white placeholder-ortho-navy/30" [placeholder]="'STOCK.UI.ADJUST_REASON_HINT' | translate"></textarea>
              </div>

              <div class="flex items-center justify-end gap-3 pt-4 border-t border-ortho-navy/5">
                <button type="button" (click)="closeAdjustmentModal()" class="px-4 py-2 border border-ortho-navy/10 rounded-xl text-sm font-semibold hover:bg-gray-50 transition text-ink-600">{{ 'COMMON.CANCEL' | translate }}</button>
                <button type="submit" class="px-5 py-2 bg-emerald-600 text-white rounded-xl text-sm font-semibold hover:bg-emerald-700 transition shadow-sm">{{ 'STOCK.UI.CONFIRM_ADJUST' | translate }}</button>
              </div>
            </form>
          </div>
        </div>
      }

      <!-- Add/Edit Supplier Modal -->
      @if (showSupplierModal()) {
        <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ortho-navy/60 backdrop-blur-sm">
          <div appDialog="stock-supplier-title" (dialogClosed)="closeSupplierModal()" class="bg-white rounded-2xl max-w-md w-full overflow-hidden border border-ortho-navy/5 shadow-2xl animate-fade-in">
            <div class="px-6 py-4 border-b border-ortho-navy/5 flex items-center justify-between bg-ortho-navy/[0.01]">
              <h2 id="stock-supplier-title" class="text-lg font-bold text-ink-900">{{ (editSupplierMode() ? 'STOCK.UI.EDIT_SUPPLIER' : 'STOCK.UI.REGISTER_SUPPLIER') | translate }}</h2>
              <button [attr.aria-label]="'COMMON.CLOSE' | translate" type="button" (click)="closeSupplierModal()" class="p-1 text-ink-500 hover:text-ink-900 hover:bg-ortho-navy/5 rounded-lg transition">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>
            
            <form (submit)="saveSupplier()" class="p-6 space-y-4">
              <div>
                <label for="stock-dashboard-supplierForm-name" class="block text-xs font-bold text-ink-500 uppercase tracking-wide mb-1">{{ 'STOCK.UI.COMPANY' | translate }} <span aria-hidden="true">*</span></label>
                <input id="stock-dashboard-supplierForm-name" type="text" [(ngModel)]="supplierForm.name" name="name" required class="w-full px-3 py-2 border border-ortho-navy/10 rounded-xl text-sm focus:outline-none focus:border-petrol-600 transition bg-white" />
              </div>

              <div>
                <label for="stock-dashboard-supplierForm-contactName" class="block text-xs font-bold text-ink-500 uppercase tracking-wide mb-1">{{ 'STOCK.UI.CONTACT_NAME' | translate }}</label>
                <input id="stock-dashboard-supplierForm-contactName" type="text" [(ngModel)]="supplierForm.contactName" name="contactName" class="w-full px-3 py-2 border border-ortho-navy/10 rounded-xl text-sm focus:outline-none focus:border-petrol-600 transition bg-white" />
              </div>

              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label for="stock-dashboard-supplierForm-email" class="block text-xs font-bold text-ink-500 uppercase tracking-wide mb-1">{{ 'STOCK.UI.EMAIL' | translate }}</label>
                  <input id="stock-dashboard-supplierForm-email" type="email" [(ngModel)]="supplierForm.email" name="email" class="w-full px-3 py-2 border border-ortho-navy/10 rounded-xl text-sm focus:outline-none focus:border-petrol-600 transition bg-white" />
                </div>
                <div>
                  <label for="stock-dashboard-supplierForm-phone" class="block text-xs font-bold text-ink-500 uppercase tracking-wide mb-1">{{ 'STOCK.UI.PHONE' | translate }}</label>
                  <input id="stock-dashboard-supplierForm-phone" type="text" [(ngModel)]="supplierForm.phone" name="phone" class="w-full px-3 py-2 border border-ortho-navy/10 rounded-xl text-sm focus:outline-none focus:border-petrol-600 transition bg-white" />
                </div>
              </div>

              <div>
                <label for="stock-dashboard-supplierForm-address" class="block text-xs font-bold text-ink-500 uppercase tracking-wide mb-1">{{ 'STOCK.UI.ADDRESS' | translate }}</label>
                <textarea id="stock-dashboard-supplierForm-address" [(ngModel)]="supplierForm.address" name="address" rows="2" class="w-full px-3 py-2 border border-ortho-navy/10 rounded-xl text-sm focus:outline-none focus:border-petrol-600 transition bg-white"></textarea>
              </div>

              <div class="flex items-center justify-end gap-3 pt-4 border-t border-ortho-navy/5">
                <button type="button" (click)="closeSupplierModal()" class="px-4 py-2 border border-ortho-navy/10 rounded-xl text-sm font-semibold hover:bg-gray-50 transition text-ink-600">{{ 'COMMON.CANCEL' | translate }}</button>
                <button type="submit" class="px-5 py-2 bg-petrol-600 text-white rounded-xl text-sm font-semibold hover:bg-petrol-700 transition shadow-sm">{{ 'STOCK.UI.SAVE_SUPPLIER' | translate }}</button>
              </div>
            </form>
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
export class StockDashboardComponent implements OnInit, OnDestroy {
  private readonly translate = inject(TranslateService);
  private stockService = inject(StockService);
  private confirmDialog = inject(ConfirmDialogService);
  private toast = inject(ToastService);

  readonly activeTab = signal<'catalog' | 'movements' | 'suppliers' | 'reconciliation'>('catalog');

  // Data Signals
  readonly items = signal<StockItem[]>([]);
  readonly movements = signal<StockMovement[]>([]);
  readonly suppliers = signal<Supplier[]>([]);
  readonly countSessions = signal<any[]>([]);
  readonly activeCountSession = signal<any | null>(null);
  physicalCountsMap: { [itemId: string]: { physicalQuantity: number; notes: string } } = {};
  reconciliationNotes = '';

  // ── Catalog tab sort/filter state ─────────────────────────────────────────
  readonly catalogSortBy = signal<string>('name');
  readonly catalogSortDir = signal<'ASC' | 'DESC'>('ASC');
  readonly catalogCategory = signal<StockCategory | 'ALL'>('ALL');
  /** Raw input value, not debounced — bound via (ngModelChange) */
  catalogSearchValue = '';
  private readonly catalogSearch$ = new Subject<string>();

  // ── Movements tab sort/filter state ───────────────────────────────────────
  readonly movSortBy = signal<string>('createdAt');
  readonly movSortDir = signal<'ASC' | 'DESC'>('DESC');
  readonly movType = signal<MovementType | 'ALL'>('ALL');
  movSearchValue = '';
  private readonly movSearch$ = new Subject<string>();

  // ── Constant option lists (driven by backend enum values) ─────────────────
  readonly stockCategories = STOCK_CATEGORIES;
  /** Same as stockCategories but without the 'ALL' entry — for the item form modal. */
  readonly stockCategoriesNoAll = STOCK_CATEGORIES.filter(c => c.value !== 'ALL');
  readonly movementTypes = MOVEMENT_TYPES;

  // ── Destroy notifier ──────────────────────────────────────────────────────
  private readonly destroy$ = new Subject<void>();

  // Modal controls
  readonly showItemModal = signal(false);
  readonly editMode = signal(false);
  /* A draft of StockItemRequest plus the id and initial stock the form
     needs, not a Partial<StockItem>: the response type has no `initialStock`
     and typing it as the response is how `location` and `batchNumber` came to
     sit in this form for so long without anyone noticing the server has no
     such fields. */
  itemForm: Partial<StockItemRequestPayload> & { id?: string; currentStock?: number } = {};

  /**
   * The units the server actually understands. The label is what a person reads; the
   * value is the enum the backend stores and reasons about, which is what makes "1" on
   * a treatment line mean one gram rather than one of something unspecified.
   */
  protected readonly unitOptions = [
    { value: 'PIECE', label: 'Unit(s)' },
    { value: 'PAIR', label: 'Pair' },
    { value: 'BOX', label: 'Box' },
    { value: 'PACK', label: 'Pack' },
    { value: 'CARTRIDGE', label: 'Cartridge' },
    { value: 'GRAM', label: 'Gram (g)' },
    { value: 'MILLIGRAM', label: 'Milligram (mg)' },
    { value: 'MILLILITRE', label: 'Millilitre (ml)' },
    { value: 'LITRE', label: 'Litre (L)' },
    { value: 'MILLIMETRE', label: 'Millimetre (mm)' },
    { value: 'CENTIMETRE', label: 'Centimetre (cm)' },
    { value: 'METRE', label: 'Metre (m)' },
    { value: 'USE', label: 'Use' },
  ] as const;

  /** Picking a unit also fills the display wording, which a clinic can still overwrite. */
  protected chooseUnit(value: string): void {
    this.itemForm.unitOfMeasure = value as StockItemRequestPayload['unitOfMeasure'];
    const picked = this.unitOptions.find(u => u.value === value);
    if (picked) {
      this.itemForm.unit = picked.label;
    }
  }
  selectedSupplierId: string | null = null;

  // Manual Adjustment Modal
  readonly showAdjustmentModal = signal(false);
  readonly selectedItem = signal<StockItem | null>(null);
  adjustmentQty = 0;
  adjustmentReason = '';

  // Supplier Modal controls
  readonly showSupplierModal = signal(false);
  readonly editSupplierMode = signal(false);
  supplierForm: Partial<Supplier> = {};

  // Computed KPIs
  readonly kpiTotalItems = computed(() => this.items().length);
  readonly kpiOutOfStock = computed(() => this.items().filter(i => i.currentStock === 0).length);
  readonly kpiLowStock = computed(() => this.items().filter(i => i.currentStock > 0 && i.currentStock <= i.minimumStock).length);
  // currentStock is tracked in individual units; purchasePrice is the cost
  // of a whole pack. Multiplying them directly overstated valuation by
  // roughly the pack size (e.g. 500 gloves × pack price of 0.80 read as
  // 40 000 DH instead of the correct 400 DH). pricePerUse is already the
  // per-unit cost, so it's the right multiplier (audit VIII.11).
  readonly kpiValuation = computed(() =>
    this.items().reduce((acc, curr) => acc + (curr.currentStock * curr.pricePerUse), 0)
  );



  ngOnInit() {
    // Wire debounced search for catalog
    this.catalogSearch$
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe(q => {
        this.catalogSearchValue = q;
        this.reloadCatalog();
      });

    // Wire debounced search for movements
    this.movSearch$
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe(q => {
        this.movSearchValue = q;
        this.reloadMovements();
      });

    this.loadAllData();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadAllData() {
    this.reloadCatalog();
    this.reloadMovements();
    this.stockService.getSuppliers().subscribe(data => this.suppliers.set(data));
    this.loadReconciliationData();
  }

  /** Fetches stock items using current catalog sort/filter signals. */
  private reloadCatalog() {
    this.stockService.getStockItems({
      search: this.catalogSearchValue.trim() || undefined,
      category: this.catalogCategory() !== 'ALL' ? this.catalogCategory() : undefined,
      sortBy: this.catalogSortBy(),
      sortDir: this.catalogSortDir(),
    }).subscribe(data => this.items.set(data));
  }

  /** Fetches movements using current movements sort/filter signals. */
  private reloadMovements() {
    this.stockService.getAllMovements({
      search: this.movSearchValue.trim() || undefined,
      movementType: this.movType() !== 'ALL' ? this.movType() : undefined,
      sortBy: this.movSortBy(),
      sortDir: this.movSortDir(),
    }).subscribe(data => this.movements.set(data));
  }

  // ── Sort helpers ───────────────────────────────────────────────────────────

  /**
   * Toggle sort on the Catalog table.
   * Clicking the same column flips direction; clicking a new column resets to ASC.
   */
  sortCatalog(column: string) {
    if (this.catalogSortBy() === column) {
      this.catalogSortDir.set(this.catalogSortDir() === 'ASC' ? 'DESC' : 'ASC');
    } else {
      this.catalogSortBy.set(column);
      this.catalogSortDir.set('ASC');
    }
    this.reloadCatalog();
  }

  /** Toggle sort on the Movements audit ledger. */
  sortMovements(column: string) {
    if (this.movSortBy() === column) {
      this.movSortDir.set(this.movSortDir() === 'ASC' ? 'DESC' : 'ASC');
    } else {
      this.movSortBy.set(column);
      this.movSortDir.set('ASC');
    }
    this.reloadMovements();
  }

  /**
   * Returns the sort icon character for a given table + column.
   * Active column shows solid arrow; inactive shows neutral double-arrow.
   */
  /** The sorted column says so itself: the arrow in it is only for the eye. */
  ariaSort(table: 'catalog' | 'mov', column: string): 'ascending' | 'descending' | 'none' {
    const activeCol = table === 'catalog' ? this.catalogSortBy() : this.movSortBy();
    const activeDir = table === 'catalog' ? this.catalogSortDir() : this.movSortDir();
    if (activeCol !== column) return 'none';
    return activeDir === 'ASC' ? 'ascending' : 'descending';
  }

  getSortIcon(table: 'catalog' | 'mov', column: string): string {
    const activeCol = table === 'catalog' ? this.catalogSortBy() : this.movSortBy();
    const activeDir = table === 'catalog' ? this.catalogSortDir() : this.movSortDir();
    if (activeCol !== column) return '↕';
    return activeDir === 'ASC' ? '↑' : '↓';
  }

  // ── Search & filter change handlers ───────────────────────────────────────

  onCatalogSearchChange(value: string) {
    this.catalogSearchValue = value;
    this.catalogSearch$.next(value);
  }

  onCatalogCategoryChange(value: StockCategory | 'ALL') {
    this.catalogCategory.set(value);
    this.reloadCatalog();
  }

  onMovSearchChange(value: string) {
    this.movSearchValue = value;
    this.movSearch$.next(value);
  }

  onMovTypeChange(value: MovementType | 'ALL') {
    this.movType.set(value);
    this.reloadMovements();
  }

  loadReconciliationData() {
    this.stockService.getCountSessions().subscribe(data => {
      const sorted = (data || []).sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime());
      this.countSessions.set(sorted);

      const active = sorted.find(s => s.status === 'OPEN' || s.status === 'IN_PROGRESS');
      if (active) {
        this.activeCountSession.set(active);
        this.physicalCountsMap = {};
        if (active.lines) {
          active.lines.forEach((l: any) => {
            this.physicalCountsMap[l.stockItem.id] = {
              physicalQuantity: l.physicalQuantity !== undefined && l.physicalQuantity !== null ? l.physicalQuantity : l.theoreticalQuantity,
              notes: l.notes || ''
            };
          });
        }
      } else {
        this.activeCountSession.set(null);
        this.physicalCountsMap = {};
      }
    });
  }

  startCountSession() {
    this.stockService.createCountSession(this.reconciliationNotes).subscribe(() => {
      this.reconciliationNotes = '';
      this.loadReconciliationData();
    });
  }

  saveDraftCounts() {
    const session = this.activeCountSession();
    if (!session) return;

    const payload = Object.keys(this.physicalCountsMap).map(itemId => ({
      stockItemId: itemId,
      physicalQuantity: this.physicalCountsMap[itemId].physicalQuantity,
      notes: this.physicalCountsMap[itemId].notes
    }));

    this.stockService.updateCountSessionLines(session.id, payload).subscribe({
      next: () => {
        this.toast.success(this.translate.instant('STOCK.UI.DRAFT_SAVED'));
        this.loadReconciliationData();
      },
      error: (err) => {
        this.toast.error(err.error?.detail || err.error?.message || 'Could not save the draft counts.');
      }
    });
  }

  async postReconciliation() {
    const session = this.activeCountSession();
    if (!session) return;

    const confirmed = await this.confirmDialog.confirm(
      this.translate.instant('STOCK.UI.POST_CONFIRM'),
      { danger: true, confirmLabel: this.translate.instant('STOCK.UI.POST_ADJUST') }
    );
    if (!confirmed) return;

    const payload = Object.keys(this.physicalCountsMap).map(itemId => ({
      stockItemId: itemId,
      physicalQuantity: this.physicalCountsMap[itemId].physicalQuantity,
      notes: this.physicalCountsMap[itemId].notes
    }));

    this.stockService.updateCountSessionLines(session.id, payload).subscribe({
      next: () => {
        this.stockService.validateCountSession(session.id, 'Admin User').subscribe({
          next: () => {
            this.toast.success(this.translate.instant('STOCK.UI.POSTED'));
            this.loadAllData();
          },
          error: (err) => {
            this.toast.error(err.error?.detail || err.error?.message || 'Could not validate the reconciliation.');
          }
        });
      },
      error: (err) => {
        this.toast.error(err.error?.detail || err.error?.message || 'Could not save the counts before validating.');
      }
    });
  }

  async cancelReconciliation() {
    const session = this.activeCountSession();
    if (!session) return;

    const confirmed = await this.confirmDialog.confirm(
      this.translate.instant('STOCK.UI.COUNT_CANCEL_CONFIRM'),
      { danger: true, confirmLabel: this.translate.instant('STOCK.UI.CANCEL_COUNT') }
    );
    if (!confirmed) return;

    this.stockService.cancelCountSession(session.id).subscribe({
      next: () => {
        this.toast.info(this.translate.instant('STOCK.UI.COUNT_CANCELLED'));
        this.loadReconciliationData();
      },
      error: (err) => {
        this.toast.error(err.error?.detail || err.error?.message || 'Could not cancel the session.');
      }
    });
  }

  calculateLineVariance(theoretical: number, itemId: string): number {
    const entry = this.physicalCountsMap[itemId];
    if (!entry) return 0;
    return entry.physicalQuantity - theoretical;
  }

  calculateLineCostVariance(theoretical: number, purchasePrice: number, itemId: string): number {
    const qtyVar = this.calculateLineVariance(theoretical, itemId);
    return qtyVar * purchasePrice;
  }

  getRunningVarianceSum(): { qty: number; cost: number } {
    let qty = 0;
    let cost = 0;
    const session = this.activeCountSession();
    if (session && session.lines) {
      session.lines.forEach((l: any) => {
        const lineQtyVar = this.calculateLineVariance(l.theoreticalQuantity, l.stockItem.id);
        const lineCostVar = lineQtyVar * l.stockItem.purchasePrice;
        qty += lineQtyVar;
        cost += lineCostVar;
      });
    }
    return { qty, cost };
  }

  // --- Stock Item Operations ---

  openAddModal() {
    this.editMode.set(false);
    this.selectedSupplierId = null;
    this.itemForm = {
      name: '',
      sku: '',
      category: 'CONSUMABLES',
      unit: 'Unit(s)',
      unitOfMeasure: 'PIECE',
      usesPerUnit: 1,
      unitLabel: 'Unit(s)',
      decimalSupported: false,
      currentStock: 0,
      minimumStock: 5,
      purchasePrice: 0,
      unitSize: 1,
    };
    this.showItemModal.set(true);
  }

  openEditModal(item: StockItem) {
    this.editMode.set(true);
    this.selectedSupplierId = item.supplier?.id || null;
    this.itemForm = { ...item };
    this.showItemModal.set(true);
  }

  closeItemModal() {
    this.showItemModal.set(false);
  }

  saveItem() {
    if (!this.itemForm.name || !this.itemForm.sku || !this.itemForm.purchasePrice || !this.itemForm.unitSize) {
      return;
    }

    const payload: StockItemRequestPayload = {
      name: this.itemForm.name!,
      sku: this.itemForm.sku!,
      category: this.itemForm.category!,
      unit: this.itemForm.unit || '',
      unitLabel: this.itemForm.unit || this.itemForm.unitLabel || '',
      unitSize: this.itemForm.unitSize!,
      purchasePrice: this.itemForm.purchasePrice!,
      minimumStock: this.itemForm.minimumStock ?? 0,
      active: true,
      decimalSupported: this.itemForm.decimalSupported ?? false,
      supplierId: this.selectedSupplierId && this.selectedSupplierId !== 'null' ? this.selectedSupplierId : null,
    };

    if (this.editMode()) {
      // currentStock is deliberately not sent — it can only move through a
      // recorded stock movement (see StockService.recordMovement / the
      // Adjustment action), never by editing the catalog form directly.
      this.stockService.updateStockItem(this.itemForm.id!, payload).subscribe(() => {
        this.reloadCatalog();
        this.closeItemModal();
      });
    } else {
      payload.initialStock = this.itemForm.currentStock ?? 0;
      this.stockService.createStockItem(payload).subscribe(() => {
        this.reloadCatalog();
        this.closeItemModal();
      });
    }
  }

  async deleteItem(item: StockItem) {
    const confirmed = await this.confirmDialog.confirm(
      this.translate.instant('STOCK.UI.ITEM_DELETE_CONFIRM', { name: item.name }),
      { danger: true, confirmLabel: this.translate.instant('COMMON.DELETE') }
    );
    if (!confirmed) return;

    this.stockService.deleteStockItem(item.id).subscribe({
      next: () => {
        this.toast.success(this.translate.instant('STOCK.UI.ITEM_DELETED'));
        this.reloadCatalog();
      },
      error: (err) => {
        this.toast.error(err.error?.detail || err.error?.message || 'Could not delete the item.');
      }
    });
  }

  // --- Manual Adjustment Operations ---

  openAdjustmentModal(item: StockItem) {
    this.selectedItem.set(item);
    this.adjustmentQty = 0;
    this.adjustmentReason = '';
    this.showAdjustmentModal.set(true);
  }

  closeAdjustmentModal() {
    this.showAdjustmentModal.set(false);
  }

  saveAdjustment() {
    const item = this.selectedItem();
    if (!item || this.adjustmentQty === 0 || !this.adjustmentReason.trim()) {
      return;
    }

    this.stockService.adjustStock(item.id, this.adjustmentQty, this.adjustmentReason).subscribe(() => {
      // Reload both catalog (updated stock level) and movements (new ledger entry)
      // while preserving the active sort/filter state on each table.
      this.reloadCatalog();
      this.reloadMovements();
      this.closeAdjustmentModal();
    });
  }

  // --- Supplier Operations ---

  openAddSupplierModal() {
    this.editSupplierMode.set(false);
    this.supplierForm = {
      name: '',
      contactName: '',
      email: '',
      phone: '',
      address: ''
    };
    this.showSupplierModal.set(true);
  }

  openEditSupplierModal(supplier: Supplier) {
    this.editSupplierMode.set(true);
    this.supplierForm = { ...supplier };
    this.showSupplierModal.set(true);
  }

  closeSupplierModal() {
    this.showSupplierModal.set(false);
  }

  saveSupplier() {
    if (!this.supplierForm.name) {
      return;
    }

    if (this.editSupplierMode()) {
      this.stockService.updateSupplier(this.supplierForm.id!, this.supplierForm).subscribe(() => {
        this.loadAllData();
        this.closeSupplierModal();
      });
    } else {
      this.stockService.createSupplier(this.supplierForm).subscribe(() => {
        this.loadAllData();
        this.closeSupplierModal();
      });
    }
  }

  async deleteSupplier(supplier: Supplier) {
    const confirmed = await this.confirmDialog.confirm(
      this.translate.instant('STOCK.UI.SUPPLIER_DELETE_CONFIRM', { name: supplier.name }),
      { danger: true, confirmLabel: this.translate.instant('COMMON.DELETE') }
    );
    if (!confirmed) return;

    this.stockService.deleteSupplier(supplier.id).subscribe({
      next: () => {
        this.toast.success(this.translate.instant('STOCK.UI.SUPPLIER_DELETED'));
        this.loadAllData();
      },
      error: (err) => {
        this.toast.error(err.error?.detail || err.error?.message || 'Could not delete the supplier.');
      }
    });
  }

  // --- Movement Log helpers ---

  isAddition(type: MovementType): boolean {
    return type === 'IN' || type === 'RETURN';
  }

  getMovementTypeClasses(type: MovementType): string {
    switch (type) {
      case 'IN':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'OUT':
        return 'bg-red-50 text-red-700 border-red-200';
      case 'ADJUSTMENT':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'RETURN':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'WRITE_OFF':
        return 'bg-gray-50 text-gray-500 border-gray-200';
      default:
        return 'bg-gray-50 text-gray-500 border-gray-200';
    }
  }
}
