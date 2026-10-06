import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Permission } from '../models/permission';
import { PermissionService } from '../services/permission.service';

/**
 * Lets a route through only to someone holding at least one of the permissions.
 * It waits for `/me` first, so a page reload on a deep link does not bounce a
 * person who is allowed in. Anyone else lands on the overview; the server is the
 * real gate, this only spares them a screen full of refusals.
 */
export const permissionGuard = (...needed: Permission[]): CanActivateFn => async () => {
  const permissions = inject(PermissionService);
  const router = inject(Router);
  await permissions.ready();
  return permissions.can(...needed) ? true : router.parseUrl('/');
};
