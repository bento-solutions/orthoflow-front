/**
 * What a signed-in person may do, finer than the three roles (backend ADR 0008).
 *
 * This mirrors the server's `Permission` enum, which is the source of truth and
 * the only thing that enforces anything. The browser copy exists so screens can
 * hide what the server would refuse; it is a convenience, never the control.
 * `permission.service.spec.ts` checks the names the server sends against this
 * list, so a permission added on the backend and forgotten here fails a test
 * instead of silently hiding a screen.
 */
export const PERMISSIONS = [
  'PATIENT_READ', 'PATIENT_WRITE', 'PATIENT_DELETE', 'PATIENT_MERGE',
  'CLINICAL_READ', 'CLINICAL_WRITE',
  'AGENDA_VIEW', 'AGENDA_MANAGE', 'WAITING_ROOM_MANAGE',
  'BILLING_READ', 'BILLING_WRITE', 'FINANCE_VIEW', 'FINANCE_MANAGE', 'EXPENSES_MANAGE',
  'RETROCESSION_VIEW', 'RETROCESSION_MANAGE',
  'STOCK_READ', 'STOCK_WRITE', 'LAB_ORDERS_MANAGE',
  'TASKS_MANAGE', 'TASKS_ADMIN',
  'MESSAGING_SEND', 'MESSAGING_VIEW', 'BOOKING_REVIEW', 'SURVEYS_VIEW',
  'ANALYTICS_VIEW', 'STERILIZATION_MANAGE',
  'SETTINGS_MANAGE', 'USERS_MANAGE',
] as const;

export type Permission = (typeof PERMISSIONS)[number];
