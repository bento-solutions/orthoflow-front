import { Component, inject, signal, computed, ElementRef, ViewChild, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { CommandRegistryService, Command } from '../../../core/services/command-registry.service';

@Component({
  selector: 'app-command-palette',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    @if (registry.isOpen()) {
      <div class="palette-backdrop" (click)="close()">
        <div
          class="palette-panel"
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
          (click)="$event.stopPropagation()"
        >
          <div class="palette-input-row">
            <span class="material-icons search-icon" aria-hidden="true">search</span>
            <input
              #inputEl
              type="text"
              class="palette-input"
              placeholder="Search actions, patients, pages..."
              [ngModel]="query()"
              (ngModelChange)="onQueryChange($event)"
              (keydown)="onKeydown($event)"
              autocomplete="off"
              aria-label="Search commands"
            />
            <kbd class="palette-esc">Esc</kbd>
          </div>

          @if (grouped().length === 0) {
            <div class="palette-empty">No matching commands.</div>
          } @else {
            <div class="palette-results" role="listbox">
              @for (group of grouped(); track group.category) {
                <div class="palette-group-label">{{ categoryLabel(group.category) }}</div>
                @for (cmd of group.commands; track cmd.id) {
                  <button
                    type="button"
                    class="palette-item"
                    role="option"
                    [class.active]="flatIndex(cmd) === activeIndex()"
                    [attr.aria-selected]="flatIndex(cmd) === activeIndex()"
                    (mouseenter)="activeIndex.set(flatIndex(cmd))"
                    (click)="run(cmd)"
                  >
                    <span class="material-icons item-icon" aria-hidden="true">{{ cmd.icon }}</span>
                    <span class="item-text">
                      <span class="item-label">{{ cmd.label }}</span>
                      @if (cmd.description) {
                        <span class="item-desc">{{ cmd.description }}</span>
                      }
                    </span>
                  </button>
                }
              }
            </div>
          }

          <div class="palette-footer">
            <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
            <span><kbd>Enter</kbd> select</span>
            <span><kbd>Esc</kbd> close</span>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .palette-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.5);
      z-index: 3000;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding: 10vh 1rem 1rem;
      animation: backdrop-in 0.12s ease-out;
    }
    .palette-panel {
      background: var(--surface);
      border-radius: 16px;
      width: 100%;
      max-width: 34rem;
      box-shadow: 0 24px 48px -12px rgba(0, 0, 0, 0.35);
      overflow: hidden;
      animation: panel-in 0.15s ease-out;
      display: flex;
      flex-direction: column;
      max-height: 70vh;
    }
    .palette-input-row {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 1rem 1.25rem;
      border-bottom: 1px solid rgb(var(--ink-200));
    }
    .search-icon { color: rgb(var(--ink-400)); }
    .palette-input {
      flex: 1;
      border: none;
      outline: none;
      font-size: 1rem;
      color: rgb(var(--ink-900));
      background: transparent;
    }
    .palette-esc {
      font-size: 0.7rem;
      color: rgb(var(--ink-400));
      border: 1px solid rgb(var(--ink-200));
      border-radius: 4px;
      padding: 0.1rem 0.4rem;
    }
    .palette-empty {
      padding: 2rem 1.25rem;
      text-align: center;
      color: rgb(var(--ink-400));
      font-size: 0.875rem;
    }
    .palette-results {
      overflow-y: auto;
      padding: 0.5rem;
    }
    .palette-group-label {
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: rgb(var(--ink-400));
      padding: 0.5rem 0.75rem 0.25rem;
    }
    .palette-item {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      width: 100%;
      text-align: left;
      padding: 0.6rem 0.75rem;
      border: none;
      background: transparent;
      border-radius: 8px;
      cursor: pointer;
      color: rgb(var(--ink-900));
    }
    .palette-item:hover,
    .palette-item.active {
      background: rgb(var(--petrol-50));
    }
    .item-icon { color: rgb(var(--petrol-900)); font-size: 20px; }
    .item-text { display: flex; flex-direction: column; min-width: 0; }
    .item-label { font-size: 0.875rem; font-weight: 600; }
    .item-desc { font-size: 0.75rem; color: rgb(var(--ink-500)); }
    .palette-footer {
      display: flex;
      gap: 1rem;
      padding: 0.6rem 1.25rem;
      border-top: 1px solid rgb(var(--ink-200));
      font-size: 0.7rem;
      color: rgb(var(--ink-400));
    }
    .palette-footer kbd {
      border: 1px solid rgb(var(--ink-200));
      border-radius: 4px;
      padding: 0 0.3rem;
      margin-right: 0.2rem;
    }
    @keyframes backdrop-in { from { opacity: 0; } to { opacity: 1; } }
    @keyframes panel-in { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
    @media (prefers-reduced-motion: reduce) {
      .palette-backdrop, .palette-panel { animation: none; }
    }
  `]
})
export class CommandPaletteComponent implements AfterViewChecked {
  registry = inject(CommandRegistryService);
  private router = inject(Router);

  @ViewChild('inputEl') inputEl?: ElementRef<HTMLInputElement>;

  query = signal('');
  activeIndex = signal(0);
  private focusedOnce = false;

  filtered = computed<Command[]>(() => {
    // registry.isOpen() is read here purely so this recomputes fresh every
    // time the palette opens on a new route — Router.url is a plain getter,
    // not a signal, so without a signal read in this computed the list
    // could go stale if you open the palette on a different page without
    // ever touching the search box.
    this.registry.isOpen();
    const path = this.router.url;
    const available = this.registry.availableFor(path);
    const q = this.query().trim().toLowerCase();
    if (!q) return available;
    return available.filter(c => {
      const haystack = [c.label, c.description ?? '', ...(c.keywords ?? [])].join(' ').toLowerCase();
      return q.split(/\s+/).every(term => haystack.includes(term));
    });
  });

  grouped = computed(() => {
    const items = this.filtered();
    const order: Command['category'][] = ['action', 'navigation', 'read'];
    return order
      .map(category => ({ category, commands: items.filter(c => c.category === category) }))
      .filter(g => g.commands.length > 0);
  });

  categoryLabel(category: Command['category']): string {
    switch (category) {
      case 'action': return 'Actions';
      case 'navigation': return 'Go to';
      case 'read': return 'Info';
    }
  }

  flatIndex(cmd: Command): number {
    return this.filtered().findIndex(c => c.id === cmd.id);
  }

  onQueryChange(value: string): void {
    this.query.set(value);
    this.activeIndex.set(0);
  }

  onKeydown(event: KeyboardEvent): void {
    const items = this.filtered();
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.activeIndex.update(i => Math.min(i + 1, items.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.activeIndex.update(i => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const cmd = items[this.activeIndex()];
      if (cmd) this.run(cmd);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
    }
  }

  run(cmd: Command): void {
    this.close();
    cmd.execute();
  }

  close(): void {
    this.registry.close();
    this.query.set('');
    this.activeIndex.set(0);
    this.focusedOnce = false;
  }

  ngAfterViewChecked(): void {
    if (this.registry.isOpen() && this.inputEl && !this.focusedOnce) {
      this.inputEl.nativeElement.focus();
      this.focusedOnce = true;
    }
  }
}
