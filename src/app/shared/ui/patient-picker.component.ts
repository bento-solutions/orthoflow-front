import { Component, ElementRef, HostListener, inject, input, model, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
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
          <button type="button" class="btn btn-ghost btn-sm" (click)="clear()" [attr.aria-label]="'COMMON.CLOSE' | translate">×</button>
        </div>
      } @else {
        <input class="input" type="search" autocomplete="off" role="combobox" [attr.aria-expanded]="open()" [attr.aria-label]="label() || ('COMMON.PATIENTS' | translate)"
          [placeholder]="'COMMON.SEARCH_PATIENT' | translate" [ngModel]="term()" (ngModelChange)="type($event)" (focus)="open.set(results().length > 0)" />
        @if (open()) {
          <ul role="listbox" class="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-ink-200 bg-surface py-1 shadow-lg">
            @for (r of results(); track r.id) {
              <li role="option">
                <button type="button" class="block w-full px-3 py-2 text-start text-sm hover:bg-ink-50" (click)="choose(r)">
                  <span class="font-semibold text-ink-900">{{ r.lastName }} {{ r.firstName }}</span>
                  <span class="ms-2 text-ink-500">{{ r.phone }} · {{ r.patientCode }}</span>
                </button>
              </li>
            } @empty {
              <li class="px-3 py-2 text-sm text-ink-500">{{ 'COMMON.NOTHING_FOUND' | translate }}</li>
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
  private readonly typed = new Subject<string>();

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
        this.open.set(this.term().trim().length >= 2);
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
  }

  protected clear(): void {
    this.value.set(null);
    this.results.set([]);
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: Event): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) {
      this.open.set(false);
    }
  }
}
