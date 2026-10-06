import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATEGORY_KINDS, PAYMENT_METHODS, PLAN_FREQUENCIES, RECURRENCES } from './services/finance-api.service';
import { ASSIGNEE_ROLES, LAB_ITEM_TYPES, LAB_STATUSES, TASK_PRIORITIES } from './services/operations-api.service';
import { RECALL_KINDS } from '../features/patients/patient-directory-api.service';

/**
 * Templates build some keys at run time (`'REC.KINDS.' + kind`), which the static scan in
 * `i18n.spec.ts` cannot see. Each family is listed here with the values it is built from, so a new
 * value on the server or in an enum without a translation fails the build instead of showing a
 * raw key to a patient's receptionist.
 */
const fr = JSON.parse(readFileSync(join(process.cwd(), 'public', 'i18n', 'fr.json'), 'utf-8')) as Record<string, unknown>;
const has = (key: string): boolean => {
  let node: unknown = fr;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null || !(part in node)) {
      return false;
    }
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string';
};

const FAMILIES: Record<string, readonly string[]> = {
  'REC.KINDS': RECALL_KINDS,
  'REC.KIND_HINTS': RECALL_KINDS,
  'REC.SORTS': ['last', 'remaining', 'name'],
  'PAT.DUP.REASONS': ['CIN', 'PHONE', 'NAME'],
  'ACC.FORM': ['AUTO', 'CHOOSE', 'ADVANCE'],
  'ACC.PLAN.FREQUENCIES': PLAN_FREQUENCIES,
  'BILLING.METHODS': PAYMENT_METHODS,
  'FIN.EXP.RECURRENCES': RECURRENCES,
  'FIN.EXP.KINDS': CATEGORY_KINDS,
  'FIN.TAX.KINDS': ['FEE_NOTE', 'CARE_FORM'],
  'FIN.TAX.LANGS': ['fr', 'en', 'ar'],
  'FIN.DEBT.SORTS': ['balance', 'name', 'lastPayment'],
  'LAB.STATUSES': LAB_STATUSES,
  'LAB.MOVE': LAB_STATUSES,
  'LAB.ITEMS': LAB_ITEM_TYPES,
  'LAB.WARNINGS': ['OVERDUE', 'FITTING_BEFORE_DUE', 'NOT_RECEIVED_BEFORE_FITTING'],
  'TASK.GROUPS': ['overdue', 'today', 'upcoming', 'doneToday'],
  'TASK.STATUSES': ['OPEN', 'DONE', 'CANCELLED'],
  'TASK.PRIORITIES': TASK_PRIORITIES,
  'TASK.ROLES': ASSIGNEE_ROLES,
  'PAT.DUP.MERGE.FIELDS': [
    'email', 'phone', 'cin', 'address', 'dateOfBirth', 'gender', 'guardianName', 'guardianPhone', 'insuranceProvider', 'insuranceNumber',
    'occupation', 'referralSource', 'insurerId', 'primaryPractitionerId', 'photoFileId',
  ],
};

describe('translation keys built at run time', () => {
  for (const [prefix, values] of Object.entries(FAMILIES)) {
    it(`${prefix}.* exists for every value`, () => {
      expect(values.filter(v => !has(`${prefix}.${v}`)).map(v => `${prefix}.${v}`)).toEqual([]);
    });
  }
});
