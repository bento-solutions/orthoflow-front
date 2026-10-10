import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';

/** Shape of a Spring Data Page<T> response. */
interface SpringPage<T> {
  content: T[];
  totalElements: number;
  totalPages: number;
  number: number;
  size: number;
}
import {
  StockItem,
  StockItemQuery,
  Supplier,
  Treatment,
  TreatmentPrice,
  PurchaseOrder,
  DeliveryNote,
  VendorInvoice,
  SalesOrder,
  TreatmentInvoice,
  StockMovement,
  StockMovementQuery,
  CountSession,
  InventoryKPI,
  TreatmentProfitability,
  POStatus,
} from '../models/stock.model';

/**
 * Payload for POST/PUT /stock/items. `supplierId` (not a nested `supplier`
 * object) and `initialStock` (opening quantity, create-only — applied as a
 * recorded stock movement, never written to `currentStock` directly) match
 * StockItemRequest on the backend, which intentionally excludes
 * `currentStock` from the write path (see audit V.6).
 */
export interface StockItemRequestPayload {
  name: string;
  sku: string;
  category: string;
  unit: string;
  unitSize: number;
  unitLabel: string;
  purchasePrice: number;
  minimumStock: number;
  svgIcon?: string;
  active?: boolean;
  decimalSupported?: boolean;
  supplierId?: string | null;
  notes?: string;
  initialStock?: number;
}

@Injectable({ providedIn: 'root' })
export class StockService {
  private http = inject(HttpClient);
  private baseUrl = `${environment.apiUrl}/api/v1/stock`;

  // ─── Stock Items (BR04) ────────────────────────────────────────────────────

  /**
   * Returns stock items from the server, optionally filtered and sorted.
   * All filter params are optional; the server applies sensible defaults.
   */
  getStockItems(filter?: StockItemQuery): Observable<StockItem[]> {
    let params = new HttpParams();
    if (filter?.search)    params = params.set('search',   filter.search);
    if (filter?.category && filter.category !== 'ALL')
                           params = params.set('category', filter.category);
    if (filter?.sortBy)    params = params.set('sortBy',   filter.sortBy);
    if (filter?.sortDir)   params = params.set('sortDir',  filter.sortDir);
    return this.http.get<StockItem[]>(`${this.baseUrl}/items`, { params });
  }

  getStockItem(id: string): Observable<StockItem> {
    return this.http.get<StockItem>(`${this.baseUrl}/items/${id}`);
  }

  createStockItem(item: StockItemRequestPayload): Observable<StockItem> {
    return this.http.post<StockItem>(`${this.baseUrl}/items`, item);
  }

  updateStockItem(id: string, item: StockItemRequestPayload): Observable<StockItem> {
    return this.http.put<StockItem>(`${this.baseUrl}/items/${id}`, item);
  }

  deleteStockItem(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/items/${id}`);
  }

  getLowStockItems(): Observable<StockItem[]> {
    return this.http.get<StockItem[]>(`${this.baseUrl}/items/low-stock`);
  }

  getExpiringItems(daysAhead: number = 30): Observable<StockItem[]> {
    const params = new HttpParams().set('daysAhead', daysAhead.toString());
    return this.http.get<StockItem[]>(`${this.baseUrl}/items/expiring`, { params });
  }

  // ─── Suppliers ────────────────────────────────────────────────────────────

  getSuppliers(): Observable<Supplier[]> {
    return this.http.get<Supplier[]>(`${this.baseUrl}/suppliers`);
  }

  getSupplier(id: string): Observable<Supplier> {
    return this.http.get<Supplier>(`${this.baseUrl}/suppliers/${id}`);
  }

  createSupplier(supplier: Partial<Supplier>): Observable<Supplier> {
    return this.http.post<Supplier>(`${this.baseUrl}/suppliers`, supplier);
  }

  updateSupplier(id: string, supplier: Partial<Supplier>): Observable<Supplier> {
    return this.http.put<Supplier>(`${this.baseUrl}/suppliers/${id}`, supplier);
  }

  deleteSupplier(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/suppliers/${id}`);
  }

  // ─── Stock Movements Ledger (BR06) ────────────────────────────────────────

  /**
   * Returns stock movements, optionally filtered and sorted.
   * Defaults: sortBy=createdAt DESC (newest first).
   */
  getAllMovements(filter?: StockMovementQuery): Observable<StockMovement[]> {
    let params = new HttpParams();
    if (filter?.search)        params = params.set('search',       filter.search);
    if (filter?.movementType && filter.movementType !== 'ALL')
                               params = params.set('movementType', filter.movementType);
    if (filter?.sortBy)        params = params.set('sortBy',       filter.sortBy);
    if (filter?.sortDir)       params = params.set('sortDir',      filter.sortDir);
    params = params.set('size', '200');
    return this.http.get<SpringPage<StockMovement>>(`${this.baseUrl}/movements`, { params }).pipe(
      map(page => page.content)
    );
  }

  getItemMovements(itemId: string): Observable<StockMovement[]> {
    return this.http.get<StockMovement[]>(`${this.baseUrl}/items/${itemId}/movements`);
  }

  adjustStock(itemId: string, quantity: number, notes: string): Observable<StockMovement> {
    const params = new HttpParams().set('quantity', quantity.toString()).set('notes', notes);
    return this.http.post<StockMovement>(`${this.baseUrl}/items/${itemId}/adjustment`, {}, { params });
  }

  // ─── Treatments & Action Setup (BR05) ─────────────────────────────────────

  getTreatments(): Observable<Treatment[]> {
    return this.http.get<Treatment[]>(`${this.baseUrl}/treatments`);
  }

  getTreatment(id: string): Observable<Treatment> {
    return this.http.get<Treatment>(`${this.baseUrl}/treatments/${id}`);
  }

  createTreatment(treatment: Partial<Treatment>): Observable<Treatment> {
    return this.http.post<Treatment>(`${this.baseUrl}/treatments`, treatment);
  }

  updateTreatment(id: string, treatment: Partial<Treatment>): Observable<Treatment> {
    return this.http.put<Treatment>(`${this.baseUrl}/treatments/${id}`, treatment);
  }

  deleteTreatment(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/treatments/${id}`);
  }

  // ─── Purchase Orders (BR01) ───────────────────────────────────────────────

  getPurchaseOrders(): Observable<PurchaseOrder[]> {
    return this.http.get<PurchaseOrder[]>(`${this.baseUrl}/purchase-orders`);
  }

  getPurchaseOrder(id: string): Observable<PurchaseOrder> {
    return this.http.get<PurchaseOrder>(`${this.baseUrl}/purchase-orders/${id}`);
  }

  createPurchaseOrder(order: Partial<PurchaseOrder>): Observable<PurchaseOrder> {
    return this.http.post<PurchaseOrder>(`${this.baseUrl}/purchase-orders`, order);
  }

  updatePurchaseOrder(id: string, order: Partial<PurchaseOrder>): Observable<PurchaseOrder> {
    return this.http.put<PurchaseOrder>(`${this.baseUrl}/purchase-orders/${id}`, order);
  }

  updatePOStatus(id: string, status: POStatus): Observable<PurchaseOrder> {
    const params = new HttpParams().set('status', status);
    return this.http.put<PurchaseOrder>(`${this.baseUrl}/purchase-orders/${id}/status`, {}, { params });
  }

  confirmPurchaseOrder(id: string): Observable<PurchaseOrder> {
    return this.http.post<PurchaseOrder>(`${this.baseUrl}/purchase-orders/${id}/confirm`, {});
  }

  deletePurchaseOrder(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/purchase-orders/${id}`);
  }

  // ─── Delivery Notes / GRNI (BR02) ─────────────────────────────────────────

  getDeliveryNotes(): Observable<DeliveryNote[]> {
    return this.http.get<DeliveryNote[]>(`${this.baseUrl}/delivery-notes`);
  }

  /** Open GRNIs: received but not yet vendor-invoiced (BR03 GRNI selection) */
  getOpenGrni(): Observable<DeliveryNote[]> {
    return this.http.get<DeliveryNote[]>(`${this.baseUrl}/delivery-notes/open-grni`);
  }

  getDeliveryNote(id: string): Observable<DeliveryNote> {
    return this.http.get<DeliveryNote>(`${this.baseUrl}/delivery-notes/${id}`);
  }

  createDeliveryNote(note: Partial<DeliveryNote>): Observable<DeliveryNote> {
    return this.http.post<DeliveryNote>(`${this.baseUrl}/delivery-notes`, note);
  }

  receiveDeliveryNote(id: string, notes?: string): Observable<DeliveryNote> {
    let params = new HttpParams();
    if (notes) params = params.set('notes', notes);
    return this.http.post<DeliveryNote>(`${this.baseUrl}/delivery-notes/${id}/receive`, {}, { params });
  }

  deleteDeliveryNote(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/delivery-notes/${id}`);
  }

  // ─── Vendor Invoices (BR03) ───────────────────────────────────────────────

  getVendorInvoices(): Observable<VendorInvoice[]> {
    return this.http.get<VendorInvoice[]>(`${this.baseUrl}/vendor-invoices`);
  }

  getVendorInvoice(id: string): Observable<VendorInvoice> {
    return this.http.get<VendorInvoice>(`${this.baseUrl}/vendor-invoices/${id}`);
  }

  createVendorInvoice(invoice: Partial<VendorInvoice>): Observable<VendorInvoice> {
    return this.http.post<VendorInvoice>(`${this.baseUrl}/vendor-invoices`, invoice);
  }

  validateVendorInvoice(id: string, validatedBy: string): Observable<VendorInvoice> {
    const params = new HttpParams().set('validatedBy', validatedBy);
    return this.http.post<VendorInvoice>(`${this.baseUrl}/vendor-invoices/${id}/validate`, {}, { params });
  }

  cancelVendorInvoice(id: string): Observable<VendorInvoice> {
    return this.http.post<VendorInvoice>(`${this.baseUrl}/vendor-invoices/${id}/cancel`, {});
  }

  deleteVendorInvoice(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/vendor-invoices/${id}`);
  }

  // ─── Sales Orders ─────────────────────────────────────────────────────────

  getSalesOrders(): Observable<SalesOrder[]> {
    return this.http.get<SalesOrder[]>(`${this.baseUrl}/sales-orders`);
  }

  getSalesOrder(id: string): Observable<SalesOrder> {
    return this.http.get<SalesOrder>(`${this.baseUrl}/sales-orders/${id}`);
  }

  createSalesOrder(order: Partial<SalesOrder>): Observable<SalesOrder> {
    return this.http.post<SalesOrder>(`${this.baseUrl}/sales-orders`, order);
  }

  confirmSalesOrder(id: string): Observable<SalesOrder> {
    return this.http.post<SalesOrder>(`${this.baseUrl}/sales-orders/${id}/confirm`, {});
  }

  cancelSalesOrder(id: string): Observable<SalesOrder> {
    return this.http.post<SalesOrder>(`${this.baseUrl}/sales-orders/${id}/cancel`, {});
  }

  deleteSalesOrder(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/sales-orders/${id}`);
  }

  // ─── Treatment Invoices / Sessions (BR07) ─────────────────────────────────

  getTreatmentInvoices(): Observable<TreatmentInvoice[]> {
    return this.http.get<TreatmentInvoice[]>(`${this.baseUrl}/treatment-invoices`);
  }

  getTreatmentInvoice(id: string): Observable<TreatmentInvoice> {
    return this.http.get<TreatmentInvoice>(`${this.baseUrl}/treatment-invoices/${id}`);
  }

  getPatientTreatmentInvoices(patientId: string): Observable<TreatmentInvoice[]> {
    return this.http.get<TreatmentInvoice[]>(`${this.baseUrl}/treatment-invoices/patient/${patientId}`);
  }

  /** What the treatment costs on this part of the tooth (no surface: the base price). */
  getTreatmentPrice(treatmentId: string, surface?: string | null): Observable<TreatmentPrice> {
    let params = new HttpParams();
    if (surface) params = params.set('surface', surface);
    return this.http.get<TreatmentPrice>(`${this.baseUrl}/treatments/${treatmentId}/price`, { params });
  }

  createDraftTreatmentInvoice(patientId: string, treatmentId: string, surface?: string | null): Observable<TreatmentInvoice> {
    let params = new HttpParams().set('patientId', patientId).set('treatmentId', treatmentId);
    if (surface) params = params.set('surface', surface);
    return this.http.post<TreatmentInvoice>(`${this.baseUrl}/treatment-invoices/draft`, {}, { params });
  }

  saveTreatmentInvoice(invoice: Partial<TreatmentInvoice>): Observable<TreatmentInvoice> {
    if (invoice.id) {
      return this.http.put<TreatmentInvoice>(`${this.baseUrl}/treatment-invoices/${invoice.id}`, invoice);
    }
    return this.http.post<TreatmentInvoice>(`${this.baseUrl}/treatment-invoices`, invoice);
  }

  finalizeTreatmentInvoice(id: string): Observable<TreatmentInvoice> {
    return this.http.post<TreatmentInvoice>(`${this.baseUrl}/treatment-invoices/${id}/finalize`, {});
  }

  cancelTreatmentInvoice(id: string): Observable<TreatmentInvoice> {
    return this.http.post<TreatmentInvoice>(`${this.baseUrl}/treatment-invoices/${id}/cancel`, {});
  }

  deleteTreatmentInvoice(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/treatment-invoices/${id}`);
  }

  // ─── Analytics (BR07, BR09) ───────────────────────────────────────────────

  getTreatmentProfitability(): Observable<TreatmentProfitability[]> {
    return this.http.get<TreatmentProfitability[]>(`${this.baseUrl}/analytics/treatment-profitability`);
  }

  getInventoryKPI(): Observable<InventoryKPI> {
    return this.http.get<InventoryKPI>(`${this.baseUrl}/analytics/kpi`);
  }

  // ─── Physical Count Sessions (BR08) ───────────────────────────────────────

  getCountSessions(): Observable<CountSession[]> {
    return this.http.get<CountSession[]>(`${this.baseUrl}/count-sessions`);
  }

  getCountSession(id: string): Observable<CountSession> {
    return this.http.get<CountSession>(`${this.baseUrl}/count-sessions/${id}`);
  }

  /** Create a session — backend freezes current stock snapshot (BR08) */
  createCountSession(notes?: string): Observable<CountSession> {
    const body = notes ? { notes } : {};
    return this.http.post<CountSession>(`${this.baseUrl}/count-sessions`, body);
  }

  /** Enter physical quantities for lines */
  updateCountSessionLines(id: string, lines: { stockItemId: string; physicalQuantity: number; notes?: string }[]): Observable<CountSession> {
    return this.http.put<CountSession>(`${this.baseUrl}/count-sessions/${id}/lines`, lines);
  }

  /** Validate & post adjustments — updates inventory balance + generates ledger entries (BR08) */
  validateCountSession(id: string, validatedBy: string): Observable<CountSession> {
    const params = new HttpParams().set('validatedBy', validatedBy);
    return this.http.post<CountSession>(`${this.baseUrl}/count-sessions/${id}/validate`, {}, { params });
  }

  cancelCountSession(id: string): Observable<CountSession> {
    return this.http.post<CountSession>(`${this.baseUrl}/count-sessions/${id}/cancel`, {});
  }
}
