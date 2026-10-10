/**
 * The wire contract: TypeScript types for what the backend actually sends.
 *
 * ## Why this file exists
 *
 * `core/api-types.d.ts` is generated from the live OpenAPI document by
 * `npm run generate:api-types`, and the backend's CI has an `openapi-drift`
 * job that regenerates it and fails if it changed. That machinery was in place
 * and working — but the generated file was imported by **nothing**. Every
 * component instead used hand-written interfaces in `core/models/*.model.ts`
 * and `features/billing/models/`, which nothing compared against the server.
 * The drift check was therefore guarding a file with no consumers: it could
 * pass green while `Invoice` and the API disagreed, and a backend field rename
 * surfaced as `undefined` at runtime rather than as a compile error.
 *
 * This module is the missing link. It derives named, ergonomic types from the
 * generated schemas so that application code gets both: names it can read, and
 * field names the compiler checks against the server.
 *
 * ## Why the generated types are not used raw
 *
 * springdoc does not emit `required` for response properties, so every field in
 * `api-types.d.ts` is optional. Consuming those directly would mean a null
 * check on `patient.firstName`, which is why nobody did. {@link Always} marks
 * the fields the server genuinely never omits, restoring ergonomics without
 * discarding the generated field names.
 *
 * ## Editing rules
 *
 * - Never hand-write a field name here. Derive it, so a rename breaks the build.
 * - Client-only shapes (form state, view models, things the API never sends)
 *   do not belong in this file. Keep them in `core/models/` and name them for
 *   what they are, e.g. `InvoiceDraft`, not `Invoice`.
 * - After changing the backend, run `npm run generate:api-types` (with the
 *   backend running) and fix whatever stops compiling. That is the point.
 */
import type { components } from '../api-types';

type Schemas = components['schemas'];

/** A generated schema, by name. */
type Api<K extends keyof Schemas> = Schemas[K];

/**
 * Marks `K` as always present on `T`.
 *
 * Everything the generator produces is optional because springdoc omits
 * `required`. This narrows the fields the server is known never to omit, while
 * leaving genuinely absent-able ones (`deletedAt`, `email`) optional.
 *
 * Because `K extends keyof T`, naming a field the backend has removed is a
 * compile error here — which is the whole point of routing types through this
 * file rather than re-typing them by hand.
 */
type Always<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>;

/**
 * Replaces `K` on `T` with a narrower client-side type.
 *
 * Used where the backend models a field as a bare `String` but the UI treats it
 * as a closed set. The `K extends keyof T` bound means the assumption is still
 * anchored: if the field disappears server-side, this stops compiling instead
 * of silently describing a field that no longer exists.
 */
type Narrow<T, K extends keyof T, V> = Omit<T, K> & V;

// ─── Patient ────────────────────────────────────────────────────────────────

/**
 * Backend types these as `String` on the entity, so they arrive as plain
 * strings and the generator cannot narrow them. The unions are a client-side
 * assumption, carried over from the hand-written model they replace. If these
 * ever become real enums in Java, the generated schema will narrow them and
 * these declarations should be deleted rather than kept in sync.
 */
export type PatientGender = 'M' | 'F' | 'O';
export type PatientStatus = 'ACTIVE' | 'COMPLETED' | 'ON_HOLD';

export type Patient = Narrow<
  Always<
    Api<'Patient'>,
    'id' | 'firstName' | 'lastName' | 'dateOfBirth' | 'phone' | 'createdAt' | 'updatedAt'
  >,
  'gender' | 'status',
  { gender: PatientGender; status: PatientStatus }
>;

/** The projection other modules read patients through — see backend ADR-0001. */
export type PatientSummary = Always<Api<'PatientSummary'>, 'id'>;

// ─── Scheduling ─────────────────────────────────────────────────────────────

export type AppointmentStatus = NonNullable<Api<'AppointmentResponse'>['status']>;

/** `type`, `durationMinutes` and `status` are `nullable = false` on the entity. */
export type Appointment = Always<
  Api<'AppointmentResponse'>,
  'id' | 'patientId' | 'dateTime' | 'status' | 'type' | 'durationMinutes'
>;

export type AppointmentRequest = Api<'AppointmentRequest'>;

export type Chair = Always<Api<'ChairResponse'>, 'id' | 'name'>;

// ─── Billing ────────────────────────────────────────────────────────────────

export type InvoiceStatus = NonNullable<Api<'InvoiceResponse'>['status']>;
export type PaymentMethod = NonNullable<Api<'PaymentResponse'>['method']>;

export type InvoiceLine = Always<Api<'InvoiceLineResponse'>, 'label' | 'quantity' | 'unitPrice'>;

export type Payment = Always<Api<'PaymentResponse'>, 'id' | 'amount' | 'method'>;

export type Invoice = Always<
  Api<'InvoiceResponse'>,
  | 'id'
  | 'patientId'
  | 'invoiceNumber'
  | 'status'
  | 'issueDate'
  | 'currency'
  | 'subtotal'
  | 'total'
  | 'amountPaid'
  | 'balanceDue'
  | 'createdAt'
>;

export type CreateInvoiceRequest = Api<'CreateInvoiceRequest'>;
export type InvoiceLineRequest = Api<'InvoiceLineRequest'>;
export type RecordPaymentRequest = Api<'RecordPaymentRequest'>;
export type BillingSummary = Always<
  Api<'BillingSummaryResponse'>,
  'totalInvoiced' | 'totalCollected' | 'outstandingAmount' | 'invoiceCount' | 'byStatus'
>;

// ─── Stock, procurement and treatment ───────────────────────────────────────

export type StockCategory = NonNullable<Api<'StockItemResponse'>['category']>;

export type StockItem = Always<Api<'StockItemResponse'>, 'id' | 'sku' | 'name' | 'currentStock'>;
export type StockItemRequest = Api<'StockItemRequest'>;

export type Supplier = Always<Api<'SupplierResponse'>, 'id' | 'name'>;
export type SupplierRequest = Api<'SupplierRequest'>;

export type MovementType = NonNullable<Api<'StockMovementResponse'>['movementType']>;
export type SourceType = NonNullable<Api<'StockMovementResponse'>['sourceType']>;

export type StockMovement = Always<Api<'StockMovementResponse'>, 'id'>;

export type Treatment = Always<Api<'TreatmentResponse'>, 'id' | 'name'>;
export type TreatmentRequest = Api<'TreatmentRequest'>;

export type TreatmentConsumable = Api<'TreatmentConsumableResponse'>;

export type POStatus = NonNullable<Api<'PurchaseOrderResponse'>['status']>;
export type PurchaseOrder = Always<Api<'PurchaseOrderResponse'>, 'id'>;
export type PurchaseOrderLine = Api<'PurchaseOrderLineResponse'>;
export type PurchaseOrderRequest = Api<'PurchaseOrderRequest'>;

export type DNStatus = NonNullable<Api<'DeliveryNoteResponse'>['status']>;
export type DeliveryNote = Always<Api<'DeliveryNoteResponse'>, 'id'>;
export type DeliveryNoteLine = Api<'DeliveryNoteLineResponse'>;
export type DeliveryNoteRequest = Api<'DeliveryNoteRequest'>;

export type VendorInvoiceStatus = NonNullable<Api<'VendorInvoiceResponse'>['status']>;
export type VendorInvoice = Always<Api<'VendorInvoiceResponse'>, 'id'>;
export type VendorInvoiceLine = Api<'VendorInvoiceLineResponse'>;

export type SOStatus = NonNullable<Api<'SalesOrderResponse'>['status']>;
export type SalesOrder = Always<Api<'SalesOrderResponse'>, 'id'>;
export type SalesOrderLine = Api<'SalesOrderLineResponse'>;
export type SalesOrderRequest = Api<'SalesOrderRequest'>;

export type CountSessionStatus = NonNullable<Api<'CountSessionResponse'>['status']>;
export type CountSession = Always<Api<'CountSessionResponse'>, 'id'>;
export type CountSessionLine = Api<'CountSessionLineResponse'>;

export type TreatmentInvoiceStatus = NonNullable<Api<'TreatmentInvoiceResponse'>['status']>;
export type TreatmentInvoice = Always<Api<'TreatmentInvoiceResponse'>, 'id'>;
export type TreatmentInvoiceConsumable = Api<'TreatmentInvoiceConsumableResponse'>;
export type DiscountType = NonNullable<Api<'InvoiceDiscountResponse'>['type']>;
export type DiscountTarget = NonNullable<Api<'InvoiceDiscountResponse'>['target']>;
export type InvoiceDiscount = Api<'InvoiceDiscountResponse'>;
export type InvoiceDiscountRequest = Api<'InvoiceDiscountRequest'>;

// ─── Reporting ──────────────────────────────────────────────────────────────

export type TreatmentProfitability = Api<'TreatmentProfitabilityResponse'>;
export type InventoryKPI = Api<'InventoryKPIResponse'>;
export type TopConsumedItem = Api<'TopConsumedItemResponse'>;

export type PatientTreatment = Always<Api<'PatientTreatmentResponse'>, 'id'>;
export type PatientTreatmentRequest = Api<'PatientTreatmentRequest'>;

// ─── Clinical ───────────────────────────────────────────────────────────────

export type PatientClinicalRecord = Api<'PatientClinicalRecordResponse'>;
export type ToothFinding = Always<Api<'ToothFindingResponse'>, 'id'>;
export type ClinicalNote = Always<Api<'ClinicalNoteResponse'>, 'id'>;
export type PeriodontalAssessment = Always<Api<'PeriodontalAssessmentResponse'>, 'id'>;
export type PeriodontalStatus = Api<'PeriodontalStatusResponse'>;
export type TreatmentPassport = Api<'TreatmentPassport'>;
export type PassportWork = Api<'PassportWork'>;
export type PassportFinding = Api<'PassportFinding'>;
export type PassportGum = Api<'PassportGum'>;
export type RecordPeriodontalRequest = Api<'RecordPeriodontalRequest'>;
export type PatientAllergy = Always<Api<'AllergyResponse'>, 'id'>;
export type MedicalHistoryEntry = Always<Api<'MedicalHistoryResponse'>, 'id'>;
export type DentalChart = Api<'DentalChartResponse'>;
export type ToothStateEvent = Api<'ToothStateEvent'>;

// ─── Auth and settings ──────────────────────────────────────────────────────

export type User = Always<
  Api<'UserResponse'>,
  'id' | 'email' | 'firstName' | 'lastName' | 'role'
>;

export type LoginRequest = Api<'LoginRequest'>;

/** A successful login always carries both a token and the user it belongs to. */
export type LoginResponse = Narrow<
  Always<Api<'LoginResponse'>, 'token'>,
  'user',
  { user: User }
>;
export type RegisterRequest = Api<'RegisterRequest'>;
export type PracticeSettings = Api<'PracticeSettingsResponse'>;
export type PracticeSettingsRequest = Api<'PracticeSettingsRequest'>;

// ─── Pagination ─────────────────────────────────────────────────────────────

/**
 * Spring's `Page<T>` envelope, parameterised.
 *
 * The generator emits one concrete type per element type (`PageInvoiceResponse`,
 * `PagePatient`, …). This keeps the envelope shape honest while letting call
 * sites say what they hold.
 */
export interface SpringPage<T> {
  content: T[];
  totalElements: number;
  totalPages: number;
  number: number;
  size: number;
  first: boolean;
  last: boolean;
}
