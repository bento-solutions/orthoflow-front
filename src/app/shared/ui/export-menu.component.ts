import { Component, ElementRef, HostListener, inject, input, signal } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { ApiErrors } from '../../core/services/api-error.service';
import { DownloadService, QueryValue } from '../../core/services/download.service';
import { LanguageService } from '../../core/services/language.service';
import { IconComponent } from './icon.component';

export type ExportFormat = 'pdf' | 'xlsx' | 'csv';

const LABEL: Record<ExportFormat, string> = { pdf: 'PDF', xlsx: 'Excel', csv: 'CSV' };

/**
 * One button for the three formats every report offers (`…/export?format=pdf|xlsx|csv`).
 * The current filters go along in {@link query}, and the interface language as `lang`, so
 * the file reads like the screen. Downloads go through the authenticated client; see
 * {@link DownloadService}.
 */
@Component({
  selector: 'app-export-menu',
  standalone: true,
  imports: [TranslateModule, IconComponent],
  template: `
    <div class="relative inline-block">
      <button type="button" class="btn btn-secondary btn-sm" (click)="toggle()" [disabled]="busy()" aria-haspopup="menu" [attr.aria-expanded]="open()">
        <app-icon name="download" [size]="15" />
        {{ 'COMMON.EXPORT' | translate }}
        <app-icon name="chevron-down" [size]="14" />
      </button>
      @if (open()) {
        <ul role="menu" class="absolute end-0 z-30 mt-1 min-w-32 overflow-hidden rounded-md border border-ink-200 bg-surface py-1 shadow-lg">
          @for (format of formats(); track format) {
            <li role="none">
              <button type="button" role="menuitem" class="block w-full px-3 py-1.5 text-start text-sm text-ink-900 hover:bg-ink-50" (click)="run(format)">
                {{ labels[format] }}
              </button>
            </li>
          }
        </ul>
      }
    </div>
  `,
})
export class ExportMenuComponent {
  /** The API path of the report's export endpoint, for example `/finance/debts/export`. */
  readonly path = input.required<string>();
  readonly query = input<Record<string, QueryValue>>({});
  readonly formats = input<ExportFormat[]>(['pdf', 'xlsx', 'csv']);
  readonly fallbackName = input('export');

  protected readonly labels = LABEL;
  protected readonly open = signal(false);
  protected readonly busy = signal(false);

  private readonly downloads = inject(DownloadService);
  private readonly errors = inject(ApiErrors);
  private readonly language = inject(LanguageService);
  private readonly host = inject(ElementRef<HTMLElement>);

  protected toggle(): void {
    this.open.update(v => !v);
  }

  protected async run(format: ExportFormat): Promise<void> {
    this.open.set(false);
    this.busy.set(true);
    try {
      await this.downloads.download(
        this.path(),
        { ...this.query(), format, lang: this.language.currentLang() },
        `${this.fallbackName()}.${format}`,
      );
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.busy.set(false);
    }
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: Event): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) {
      this.open.set(false);
    }
  }

  @HostListener('keydown.escape')
  protected onEscape(): void {
    this.open.set(false);
  }
}
