import { Injectable, inject, signal } from '@angular/core';
import { Permission } from '../models/permission';
import { PermissionService } from './permission.service';

export type CommandCategory = 'navigation' | 'action' | 'read' | 'patient';

export interface Command {
  id: string;
  /** Translation key or literal label shown in the palette. */
  label: string;
  /** Optional secondary line — e.g. "Go to /patients/:id" or a hint. */
  description?: string;
  category: CommandCategory;
  /** Material icon ligature name. */
  icon: string;
  /** Extra terms the fuzzy matcher should also match against. */
  keywords?: string[];
  /**
   * Restricts the command to routes matching this prefix (e.g. '/patients').
   * Undefined means available everywhere.
   */
  routeScope?: string;
  /** Shown only to someone holding at least one of these. None means everyone. The palette is a shortcut, not a way around the menu: what the menu hides it hides too. */
  permission?: Permission[];
  /** Executes the command. Receives nothing — closures capture what they need. */
  execute: () => void;
  /** True for destructive/typed-confirm-only actions that must never appear in quick search alone. */
  requiresConfirmation?: boolean;
}

/**
 * Single source of truth for every keyboard/voice-reachable action in the
 * app (audit XII.3/XII.6 phase 3). Building this as a keyboard command
 * palette first — independently valuable, testable without a microphone —
 * is what audit Part XII recommends as the prerequisite for voice: a voice
 * front-end becomes a thin adapter over this registry rather than a
 * parallel, unaudited action surface. Every command here has a natural
 * keyboard/click equivalent already; nothing new is exposed by registering
 * it, it's just made reachable from one place with one shortcut (Cmd/Ctrl+K).
 */
@Injectable({
  providedIn: 'root'
})
export class CommandRegistryService {
  private readonly permissions = inject(PermissionService);
  private commandsSignal = signal<Map<string, Command>>(new Map());
  private isOpenSignal = signal(false);

  isOpen = this.isOpenSignal.asReadonly();

  register(command: Command): void {
    this.commandsSignal.update(map => {
      const next = new Map(map);
      next.set(command.id, command);
      return next;
    });
  }

  registerMany(commands: Command[]): void {
    this.commandsSignal.update(map => {
      const next = new Map(map);
      for (const c of commands) next.set(c.id, c);
      return next;
    });
  }

  unregister(id: string): void {
    this.commandsSignal.update(map => {
      const next = new Map(map);
      next.delete(id);
      return next;
    });
  }

  /** Returns commands available for the given current route path. */
  availableFor(currentPath: string): Command[] {
    return Array.from(this.commandsSignal().values()).filter(
      c => (!c.routeScope || currentPath.startsWith(c.routeScope)) && (!c.permission || this.permissions.can(...c.permission))
    );
  }

  open(): void {
    this.isOpenSignal.set(true);
  }

  close(): void {
    this.isOpenSignal.set(false);
  }

  toggle(): void {
    this.isOpenSignal.update(v => !v);
  }
}
