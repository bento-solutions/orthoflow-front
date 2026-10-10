/**
 * Inventory, procurement, treatment and reporting types.
 *
 * Every wire type here is re-exported from `core/api/contract`, which derives
 * them from the OpenAPI document the backend publishes. This file previously
 * hand-declared all of them — 449 lines mirroring the backend `stock` module —
 * and had drifted from the server in ways that were invisible to the compiler
 * and visible to users:
 *
 * - `MovementType` declared `PURCHASE_RECEIPT`, `VENDOR_INVOICE_ADJUSTMENT`,
 *   `TREATMENT_CONSUMPTION` and `INVENTORY_COUNT_ADJUSTMENT`. The server has
 *   none of them (`IN`, `OUT`, `ADJUSTMENT`, `RETURN`, `WRITE_OFF`), and
 *   `MOVEMENT_TYPES` below offered all four in the stock-movements filter, so
 *   four of the ten filter options could never match a row.
 * - `SourceType` declared `VENDOR_INVOICE`, which does not exist, and omitted
 *   `PATIENT_TREATMENT`, which does.
 * - `POStatus` declared `CONFIRMED`, `INVOICED` and `CLOSED`, none of which the
 *   server can return.
 * - `DNStatus` declared `CANCELLED`, which does not exist, and omitted
 *   `PARTIAL` and `DISPUTED`, which do — so a disputed delivery note fell
 *   through every status branch in the UI.
 *
 * The unions are now derived from the generated schema, so the filter lists at
 * the bottom of this file are built from the real values and cannot drift from
 * them again.
 */

export type {
  // Inventory
  StockItem,
  StockItemRequest,
  Supplier,
  SupplierRequest,
  StockCategory,
  StockMovement,
  MovementType,
  SourceType,
  CountSession,
  CountSessionLine,
  CountSessionStatus,
  // Procurement
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseOrderRequest,
  POStatus,
  DeliveryNote,
  DeliveryNoteLine,
  DeliveryNoteRequest,
  DNStatus,
  VendorInvoice,
  VendorInvoiceLine,
  VendorInvoiceStatus,
  // Treatment
  Treatment,
  TreatmentRequest,
  TreatmentSurfacePrice,
  TreatmentPrice,
  TreatmentConsumable,
  TreatmentInvoice,
  TreatmentInvoiceConsumable,
  TreatmentInvoiceStatus,
  InvoiceDiscount,
  InvoiceDiscountRequest,
  DiscountType,
  DiscountTarget,
  SalesOrder,
  SalesOrderLine,
  SalesOrderRequest,
  SOStatus,
  // Reporting
  TreatmentProfitability,
  InventoryKPI,
  TopConsumedItem,
} from '../api/contract';

import type { StockCategory, MovementType } from '../api/contract';

/**
 * Units of measure.
 *
 * `StockItemResponse.unit` is a plain `String` server-side, so the generator
 * cannot narrow it. This union is a client-side assumption about what the
 * server stores, not a contract.
 */
export type UnitOfMeasure = 'UNIT' | 'BOX' | 'BOTTLE' | 'PACK' | 'ML' | 'MG' | 'ROLL' | 'PAIR';

// ── Query parameters ───────────────────────────────────────────────────
//
// Not part of the OpenAPI component schemas (springdoc emits query params on
// the operation, not as a named type), so these stay hand-written.

/**
 * Query params for GET /stock/items.
 * All fields are optional — omitted fields fall back to server defaults.
 */
export interface StockItemQuery {
  /** Free-text search on item name or SKU. */
  search?: string;
  /** StockCategory value to filter by, or 'ALL' for no filter. */
  category?: StockCategory | 'ALL';
  /** Column to sort by. Backend-allowed values: name, sku, category,
   *  currentStock, minimumStock, purchasePrice, pricePerUse, createdAt. */
  sortBy?: string;
  /** Sort direction. */
  sortDir?: 'ASC' | 'DESC';
}

/**
 * Query params for GET /stock/movements.
 * All fields are optional — omitted fields fall back to server defaults.
 */
export interface StockMovementQuery {
  /** Free-text search on item name, SKU or source reference. */
  search?: string;
  /** MovementType value to filter by, or 'ALL' for no filter. */
  movementType?: MovementType | 'ALL';
  /** Column to sort by. Backend-allowed values: createdAt, movementType,
   *  quantity, quantityBefore, quantityAfter, sourceType, sourceReference. */
  sortBy?: string;
  /** Sort direction. */
  sortDir?: 'ASC' | 'DESC';
}

// ── Select options ─────────────────────────────────────────────────────
//
// Built from the contract unions rather than restated, so a value the server
// stops returning (or starts returning) cannot silently linger in — or go
// missing from — a filter dropdown.

const CATEGORY_LABELS: Record<StockCategory, string> = {
  ANESTHESIA: 'Anesthesia',
  CONSUMABLES: 'Consumables',
  ORTHODONTIC_PARTS: 'Orthodontic Parts',
  HYGIENE: 'Hygiene',
  INSTRUMENTS: 'Instruments',
  MEDICATION: 'Medication',
};

const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  IN: 'IN — Stock Receipt',
  OUT: 'OUT — Consumption',
  ADJUSTMENT: 'Adjustment',
  RETURN: 'Return',
  WRITE_OFF: 'Write-Off',
};

/** All backend StockCategory values as an ordered array for use in selects. */
export const STOCK_CATEGORIES: { value: string; label: string }[] = [
  { value: 'ALL', label: 'All Categories' },
  ...(Object.entries(CATEGORY_LABELS) as [StockCategory, string][])
    .map(([value, label]) => ({ value, label })),
];

/** All backend MovementType values for use in selects. */
export const MOVEMENT_TYPES: { value: string; label: string }[] = [
  { value: 'ALL', label: 'All Types' },
  ...(Object.entries(MOVEMENT_TYPE_LABELS) as [MovementType, string][])
    .map(([value, label]) => ({ value, label })),
];
