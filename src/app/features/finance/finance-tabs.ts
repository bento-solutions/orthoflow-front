import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Permission } from '../../core/models/permission';
import { PermissionService } from '../../core/services/permission.service';

export interface FinanceTab {
  path: string;
  key: string;
  permission: Permission[];
}

/** The money screens, each behind the permission its report needs (FINANCE_VIEW for the totals, BILLING_READ for patient balances). */
export const FINANCE_TABS: FinanceTab[] = [
  { path: 'dashboard', key: 'FIN.TABS.DASHBOARD', permission: ['FINANCE_VIEW'] },
  { path: 'collections', key: 'FIN.TABS.COLLECTIONS', permission: ['FINANCE_VIEW'] },
  { path: 'cash', key: 'FIN.TABS.CASH', permission: ['FINANCE_VIEW'] },
  { path: 'debts', key: 'FIN.TABS.DEBTS', permission: ['BILLING_READ'] },
  { path: 'instalments', key: 'FIN.TABS.INSTALMENTS', permission: ['BILLING_READ'] },
  { path: 'cheques', key: 'FIN.TABS.CHEQUES', permission: ['BILLING_READ'] },
  { path: 'expenses', key: 'FIN.TABS.EXPENSES', permission: ['FINANCE_VIEW'] },
  { path: 'tax-documents', key: 'FIN.TABS.TAX', permission: ['BILLING_READ'] },
];

/** The first tab this person may open, which is where `/finance` leads. */
export function firstFinanceTab(permissions: PermissionService): string {
  return FINANCE_TABS.find(t => permissions.can(...t.permission))?.path ?? 'debts';
}


/**
 * `/finance` itself shows nothing: it sends the person to their first tab. Done in a guard, not
 * with `redirectTo`, because a redirect is decided while the URL is matched, before the person's
 * permissions have arrived, and would always pick the fallback.
 */
export const financeHomeGuard: CanActivateFn = async () => {
  const permissions = inject(PermissionService);
  const router = inject(Router);
  await permissions.ready();
  return router.parseUrl(`/finance/${firstFinanceTab(permissions)}`);
};
