import { Component, ElementRef, HostListener, inject, input, model, signal, viewChild } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { AnnouncerService } from '../../core/services/announcer.service';
import { Subject, debounceTime, distinctUntilChanged, firstValueFrom, switchMap } from 'rxjs';
import { api } from '../../core/api/url';
import type { Wire } from '../../core/api/wire';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

export interface PickedPatient {
  id: string;
  name: string;
  phone?: string;
}

type Row = Wire<'PatientDirectoryRow'>;
type Page = { content: Row[] };

let nextId = 1;

/**
 * Finds a patient by typing part of a name, phone number or patient code. Used wherever a
 * screen needs "which patient?" and a dropdown of every patient would not scale. Two-way:
 * `<app-patient-picker [(value)]="patient" />`.
 */
@Component({
  selector: 'app-patient-picker',
  standalone: true,
  imports: [FormsModule, TranslateModule],
  template: `
    <div class="relative">
      @if (value(); as picked) {
        <div class="input flex items-center justify-between gap-2">
          <span class="truncate font-semibold">{{ picked.name }}@if (picked.phone) { <span class="ms-2 font-normal text-ink-500">{{ picked.phone }}</span> }</span>
          <button #clearButton type="button" class="btn btn-ghost btn-sm" (click)="clear()" [attr.aria-label]="'COMMON.CHANGE_PATIENT' | translate">×</button>
        </div>
      } @else {
        <!-- Focus stays in the field and the arrows move through the list, which says which one is highlighted. -->
        <input #field class="input" type="search" autocomplete="off" role="combobox" aria-autocomplete="list"
          [attr.aria-expanded]="open()" [attr.aria-controls]="listId"
          [attr.aria-activedescendant]="open() && results()[active()] ? listId + '-' + active() : null"
          [attr.aria-label]="label() || ('COMMON.PATIENTS' | translate)"
          [placeholder]="'COMMON.SEARCH_PATIENT' | translate" [ngModel]="term()" (ngModelChange)="type($event)"
          (focus)="open.set(results().length > 0)" (keydown)="onKeydown($event)" />
        @if (open()) {
          <ul [id]="listId" role="listbox" [attr.aria-label]="'COMMON.PATIENTS' | translate" class="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-ink-200 bg-surface py-1 shadow-lg">
            @for (r of results(); track r.id; let i = $index) {
              <li role="option" [id]="listId + '-' + i" [attr.aria-selected]="active() === i" [class.bg-ink-50]="active() === i"
                class="cursor-pointer px-3 py-2 text-start text-sm" (click)="choose(r)" (mouseenter)="active.set(i)">
                <span class="font-semibold text-ink-900">{{ r.lastName }} {{ r.firstName }}</span>
                <span class="ms-2 text-ink-500">{{ r.phone }} · {{ r.patientCode }}</span>
              </li>
            } @empty {
              <li role="option" aria-disabled="true" aria-selected="false" class="px-3 py-2 text-sm text-ink-500">{{ 'COMMON.NOTHING_FOUND' | translate }}</li>
            }
          </ul>
        }
      }
    </div>
  `,
})
export class PatientPickerComponent {
  readonly value = model<PickedPatient | null>(null);
  readonly label = input('');

  private readonly http = inject(HttpClient);
  private readonly host = inject(ElementRef<HTMLElement>);
  protected readonly term = signal('');
  protected readonly results = signal<Row[]>([]);
  protected readonly open = signal(false);
  protected readonly active = signal(0);
  protected readonly listId = `patient-picker-${nextId++}`;
  private readonly typed = new Subject<string>();
  private readonly announcer = inject(AnnouncerService);
  private readonly translate = inject(TranslateService);
  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');
  private readonly clearButton = viewChild<ElementRef<HTMLButtonElement>>('clearButton');

  constructor() {
    this.typed
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap(term => (term.trim().length < 2 ? Promise.resolve<Page>({ content: [] }) : firstValueFrom(this.http.get<Page>(api('/patients/list'), { params: { search: term.trim(), size: 8 } })).catch(() => ({ content: [] as Row[] })))),
        takeUntilDestroyed(),
      )
      .subscribe(page => {
        this.results.set(page.content);
        this.active.set(0);
        this.open.set(this.term().trim().length >= 2);
        if (this.open()) this.announcer.announce(this.translate.instant('COMMON.RESULTS_COUNT', { count: page.content.length }));
      });
  }

  protected type(term: string): void {
    this.term.set(term);
    this.typed.next(term);
  }

  protected choose(r: Row): void {
    this.value.set({ id: r.id, name: `${r.lastName} ${r.firstName}`.trim(), phone: r.phone || undefined });
    this.open.set(false);
    this.term.set('');
    // The field is gone now, and focus would go with it.
    setTimeout(() => this.clearButton()?.nativeElement.focus());
  }

  protected clear(): void {
    this.value.set(null);
    this.results.set([]);
    setTimeout(() => this.field()?.nativeElement.focus());
  }

  protected onKeydown(event: KeyboardEvent): void {
    const count = this.results().length;
    switch (event.key) {
      case 'ArrowDown':
        if (!this.open() && count) { this.open.set(true); break; }
        if (count) this.active.update((i) => (i + 1) % count);
        break;
      case 'ArrowUp':
        if (count) this.active.update((i) => (i - 1 + count) % count);
        break;
      case 'Enter': {
        // Enter in the field must not submit the form around it when there is a list to choose from.
        const row = this.open() ? this.results()[this.active()] : undefined;
        if (!row) return;
        this.choose(row);
        break;
      }
      case 'Escape':
        if (!this.open()) return;
        this.open.set(false);
        event.stopPropagation();
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: Event): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) {
      this.open.set(false);
    }
  }
}
