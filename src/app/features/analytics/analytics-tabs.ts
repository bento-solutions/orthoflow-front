import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Permission } from '../../core/models/permission';
import { PermissionService } from '../../core/services/permission.service';

export interface AnalyticsTab {
  path: string;
  key: string;
  permission: Permission[];
}

/** Procedures and doctor time are practice activity (ANALYTICS_VIEW); the income statement and the goal show the clinic's money (FINANCE_VIEW). */
export const ANALYTICS_TABS: AnalyticsTab[] = [
  { path: 'procedures', key: 'ANA.TABS.PROCEDURES', permission: ['ANALYTICS_VIEW'] },
  { path: 'time', key: 'ANA.TABS.TIME', permission: ['ANALYTICS_VIEW'] },
  { path: 'income', key: 'ANA.TABS.INCOME', permission: ['FINANCE_VIEW'] },
  { path: 'goals', key: 'ANA.TABS.GOALS', permission: ['FINANCE_VIEW'] },
];

/** `/analytics` opens on the first report this person may see (decided after their permissions are known, so not with a plain redirect). */
export const analyticsHomeGuard: CanActivateFn = async () => {
  const permissions = inject(PermissionService);
  const router = inject(Router);
  await permissions.ready();
  const first = ANALYTICS_TABS.find(t => permissions.can(...t.permission));
  return router.parseUrl(first ? `/analytics/${first.path}` : '/');
};
