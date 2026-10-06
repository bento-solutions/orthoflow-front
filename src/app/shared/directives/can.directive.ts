import { Directive, TemplateRef, ViewContainerRef, effect, inject, input } from '@angular/core';
import { Permission } from '../../core/models/permission';
import { PermissionService } from '../../core/services/permission.service';

/**
 * `<button *appCan="'FINANCE_MANAGE'">` renders only for someone holding the
 * permission; a list means any of them. A convenience over {@link PermissionService},
 * not a control: the server refuses what the person may not do either way.
 */
@Directive({ selector: '[appCan]', standalone: true })
export class CanDirective {
  private readonly template = inject(TemplateRef<unknown>);
  private readonly container = inject(ViewContainerRef);
  private readonly permissions = inject(PermissionService);

  readonly appCan = input.required<Permission | Permission[]>();

  constructor() {
    effect(() => {
      const needed = this.appCan();
      const allowed = this.permissions.can(...(Array.isArray(needed) ? needed : [needed]));
      this.container.clear();
      if (allowed) {
        this.container.createEmbeddedView(this.template);
      }
    });
  }
}
