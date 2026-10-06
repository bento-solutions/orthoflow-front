import { Component, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { ApiErrors } from '../../core/services/api-error.service';
import { ConfirmDialogService } from '../../core/services/confirm-dialog.service';
import { refreshOnLive } from '../../core/services/live-refresh';
import { EndoKit, EndoModel, SterilizationApi } from '../../core/services/sterilization-api.service';
import { ToastService } from '../../core/services/toast.service';
import { formState } from '../../core/utils/form-state';
import { loadable } from '../../core/utils/loadable';
import { IconComponent } from '../../shared/ui/icon.component';
import { ModalComponent } from '../../shared/ui/modal.component';
import { stateTone } from './item-actions.component';

type KitFile = EndoKit['files'][number];

/** A file's wear as one word: past its limit it must not be used again, one use from the limit it is flagged. */
export function wear(file: Pick<KitFile, 'atLimit' | 'nearLimit'>): 'LIMIT' | 'NEAR' | 'OK' {
  return file.atLimit ? 'LIMIT' : file.nearLimit ? 'NEAR' : 'OK';
}

/**
 * Endodontic files are single-patient-limited: each use is counted, and at the limit the file
 * is thrown away and replaced. Kits are the trays they sit in (a kit is a sterilization item);
 * each file in a kit counts its uses from the cycles the kit goes through.
 */
@Component({
  selector: 'app-sterilization-endo',
  standalone: true,
  imports: [FormsModule, TranslateModule, IconComponent, ModalComponent],
  template: `
    <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
      <p class="text-sm text-ink-600">{{ 'STER.ENDO.HINT' | translate }}</p>
      <button type="button" class="btn btn-secondary btn-sm" (click)="modelsOpen.set(true)">{{ 'STER.ENDO.MODELS' | translate }}</button>
    </div>

    <div class="space-y-4" [attr.aria-busy]="kits.loading()">
      @for (k of kits.data(); track k.item.id) {
        <article class="card">
          <div class="card-head">
            <div>
              <h2 class="text-base font-bold text-ink-900"><span class="mono">{{ k.item.code }}</span> · {{ k.item.name }}</h2>
              <p class="text-xs text-ink-500"><span class="pill" [class]="'pill pill-nodot ' + tone(k.item.state)">{{ 'STER.STATES.' + k.item.state | translate }}</span></p>
            </div>
            <span class="flex items-center gap-2">
              @if (k.needsReplacement) { <span class="pill pill-critical pill-nodot">{{ 'STER.ENDO.REPLACE' | translate }}</span> }
              <button type="button" class="btn btn-secondary btn-sm" (click)="openAdd(k)"><app-icon name="plus" [size]="14" /> {{ 'STER.ENDO.ADD_FILES' | translate }}</button>
            </span>
          </div>
          <div class="table-scroll">
            <table class="data-table">
              <thead><tr><th scope="col">{{ 'STER.ENDO.MODEL' | translate }}</th><th scope="col" class="cell-num">{{ 'STER.ENDO.USES' | translate }}</th><th scope="col">{{ 'STER.ENDO.WEAR' | translate }}</th><th scope="col" class="cell-actions"><span class="sr-only">{{ 'COMMON.ACTIONS' | translate }}</span></th></tr></thead>
              <tbody>
                @for (f of k.files; track f.id) {
                  <tr>
                    <td class="font-semibold">{{ f.modelName }}</td>
                    <td class="cell-num tabular-nums">{{ f.useCount }} / {{ f.maxUses }}</td>
                    <td>
                      <span class="flex items-center gap-2"><span class="h-1.5 w-24 overflow-hidden rounded-full bg-ink-100" aria-hidden="true"><span class="block h-full rounded-full" [class.bg-critical-500]="wearOf(f) === 'LIMIT'" [class.bg-caution-500]="wearOf(f) === 'NEAR'" [class.bg-positive-500]="wearOf(f) === 'OK'" [style.width.%]="percent(f)"></span></span>
                        <span class="text-xs" [class.font-semibold]="wearOf(f) !== 'OK'" [class.text-critical-700]="wearOf(f) === 'LIMIT'" [class.text-caution-700]="wearOf(f) === 'NEAR'">{{ 'STER.ENDO.WEARS.' + wearOf(f) | translate: { remaining: f.remaining } }}</span></span>
                    </td>
                    <td class="cell-actions"><button type="button" class="btn btn-ghost btn-sm" (click)="openDiscard(f)">{{ 'STER.ENDO.DISCARD' | translate }}</button></td>
                  </tr>
                } @empty { <tr><td colspan="4" class="py-4 text-center text-ink-500">{{ 'STER.ENDO.NO_FILES' | translate }}</td></tr> }
              </tbody>
            </table>
          </div>
        </article>
      } @empty {
        @if (!kits.loading()) { <div class="empty"><span class="empty-icon"><app-icon name="shield" [size]="20" /></span><p class="empty-title">{{ 'STER.ENDO.EMPTY' | translate }}</p><p class="empty-text">{{ 'STER.ENDO.EMPTY_TEXT' | translate }}</p></div> }
      }
    </div>

    <app-modal [open]="adding() !== null" [title]="'STER.ENDO.ADD_FILES' | translate" size="sm" [dismissable]="!busy()" (closed)="adding.set(null)">
      <form id="add-form" class="space-y-3" (ngSubmit)="addFiles()">
        <p class="text-sm text-ink-700"><strong>{{ adding()?.item?.name }}</strong></p>
        <label class="field"><span class="label label-required">{{ 'STER.ENDO.MODEL' | translate }}</span>
          <select class="select" name="model" required [ngModel]="modelId()" (ngModelChange)="modelId.set($event)"><option value="">—</option>@for (m of activeModels(); track m.id) { <option [value]="m.id">{{ m.name }} ({{ m.maxUses }})</option> }</select></label>
        <label class="field"><span class="label">{{ 'STER.ENDO.QUANTITY' | translate }}</span><input class="input" type="number" min="1" max="30" name="qty" [ngModel]="quantity()" (ngModelChange)="quantity.set(+$event || 1)" /></label>
      </form>
      <div modal-footer>
        <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="adding.set(null)">{{ 'COMMON.CANCEL' | translate }}</button>
        <button type="submit" form="add-form" class="btn btn-primary" [disabled]="busy() || !modelId()">{{ 'COMMON.ADD' | translate }}</button>
      </div>
    </app-modal>

    <app-modal [open]="discarding() !== null" [title]="'STER.ENDO.DISCARD' | translate" size="sm" [dismissable]="!busy()" (closed)="discarding.set(null)">
      <form id="discard-form" class="space-y-3" (ngSubmit)="discard()">
        <p class="text-sm text-ink-700"><strong>{{ discarding()?.modelName }}</strong> — {{ 'STER.ENDO.DISCARD_HINT' | translate }}</p>
        <label class="field"><span class="label label-required">{{ 'ACC.VOID_REASON' | translate }}</span>
          <input class="input" name="reason" required maxlength="300" list="reasons" [ngModel]="reason()" (ngModelChange)="reason.set($event)" />
          <datalist id="reasons"><option [value]="'STER.ENDO.REASONS.LIMIT' | translate"></option><option [value]="'STER.ENDO.REASONS.BROKEN' | translate"></option></datalist></label>
      </form>
      <div modal-footer>
        <button type="button" class="btn btn-secondary" [disabled]="busy()" (click)="discarding.set(null)">{{ 'COMMON.CANCEL' | translate }}</button>
        <button type="submit" form="discard-form" class="btn btn-danger" [disabled]="busy() || !reason().trim()">{{ 'STER.ENDO.DISCARD' | translate }}</button>
      </div>
    </app-modal>

    <app-modal [open]="modelsOpen()" [title]="'STER.ENDO.MODELS' | translate" size="lg" (closed)="modelsOpen.set(false)">
      <div class="table-wrap mb-4"><div class="table-scroll">
        <table class="data-table">
          <thead><tr><th scope="col">{{ 'COMMON.NAME' | translate }}</th><th scope="col">{{ 'STER.ENDO.BRAND' | translate }}</th><th scope="col">{{ 'STER.ENDO.SIZE_TAPER' | translate }}</th><th scope="col" class="cell-num">{{ 'STER.ENDO.MAX_USES' | translate }}</th><th scope="col" class="cell-actions"><span class="sr-only">{{ 'COMMON.ACTIONS' | translate }}</span></th></tr></thead>
          <tbody>
            @for (m of models(); track m.id) {
              <tr [class.opacity-60]="!m.active"><td class="font-semibold">{{ m.name }}</td><td>{{ m.brand || '—' }}</td><td>{{ m.sizeTaper || '—' }}</td><td class="cell-num">{{ m.maxUses }}</td>
                <td class="cell-actions"><button type="button" class="btn btn-ghost btn-icon" (click)="editModel(m)" [attr.aria-label]="('COMMON.EDIT' | translate) + ' ' + m.name"><app-icon name="edit" [size]="16" /></button></td></tr>
            } @empty { <tr><td colspan="5" class="py-4 text-center text-ink-500">{{ 'STER.ENDO.NO_MODELS' | translate }}</td></tr> }
          </tbody>
        </table>
      </div></div>
      <form id="model-form" class="grid gap-3 rounded-lg border border-ink-200 p-3 sm:grid-cols-4" (ngSubmit)="saveModel()">
        <label class="field sm:col-span-2"><span class="label label-required">{{ 'COMMON.NAME' | translate }}</span><input class="input" name="mname" required maxlength="120" [ngModel]="model.value().name" (ngModelChange)="model.set('name', $event)" /></label>
        <label class="field"><span class="label">{{ 'STER.ENDO.BRAND' | translate }}</span><input class="input" name="mbrand" maxlength="80" [ngModel]="model.value().brand" (ngModelChange)="model.set('brand', $event)" /></label>
        <label class="field"><span class="label">{{ 'STER.ENDO.SIZE_TAPER' | translate }}</span><input class="input" name="msize" maxlength="40" [ngModel]="model.value().sizeTaper" (ngModelChange)="model.set('sizeTaper', $event)" /></label>
        <label class="field"><span class="label label-required">{{ 'STER.ENDO.MAX_USES' | translate }}</span><input class="input" type="number" min="1" max="100" name="mmax" required [ngModel]="model.value().maxUses" (ngModelChange)="model.set('maxUses', +$event || 1)" /></label>
        <label class="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="mactive" [ngModel]="model.value().active" (ngModelChange)="model.set('active', $event)" /> {{ 'COMMON.ACTIVE' | translate }}</label>
        <div class="flex justify-end gap-2 sm:col-span-2 sm:self-end">
          @if (modelId2()) { <button type="button" class="btn btn-secondary btn-sm" (click)="editModel(null)">{{ 'COMMON.CANCEL' | translate }}</button> }
          <button type="submit" class="btn btn-primary btn-sm" [disabled]="busy() || !model.value().name.trim()">{{ 'COMMON.SAVE' | translate }}</button>
        </div>
      </form>
      <div modal-footer><button type="button" class="btn btn-secondary" (click)="modelsOpen.set(false)">{{ 'COMMON.CLOSE' | translate }}</button></div>
    </app-modal>
  `,
})
export class SterilizationEndoComponent {
  private readonly api = inject(SterilizationApi);
  private readonly errors = inject(ApiErrors);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly translate = inject(TranslateService);

  protected readonly tone = stateTone;
  protected readonly wearOf = wear;
  protected readonly kits = loadable<EndoKit[]>([]);
  protected readonly models = signal<EndoModel[]>([]);
  protected readonly busy = signal(false);
  protected readonly adding = signal<EndoKit | null>(null);
  protected readonly modelId = signal('');
  protected readonly quantity = signal(1);
  protected readonly discarding = signal<KitFile | null>(null);
  protected readonly reason = signal('');
  protected readonly modelsOpen = signal(false);
  protected readonly modelId2 = signal<string | null>(null);
  protected readonly model = formState({ name: '', brand: '', sizeTaper: '', maxUses: 4, active: true });

  protected activeModels(): EndoModel[] {
    return this.models().filter(m => m.active);
  }

  protected percent(f: KitFile): number {
    return f.maxUses > 0 ? Math.min(100, Math.round((f.useCount / f.maxUses) * 100)) : 0;
  }

  constructor() {
    void this.loadModels();
    effect(() => {
      untracked(() => void this.kits.load(() => this.api.kits()));
    });
    refreshOnLive(['sterilization'], () => void this.kits.load(() => this.api.kits()));
  }

  private async loadModels(): Promise<void> {
    try {
      this.models.set(await this.api.endoModels());
    } catch (error) {
      this.errors.report(error);
    }
  }

  protected openAdd(k: EndoKit): void {
    this.modelId.set('');
    this.quantity.set(1);
    this.adding.set(k);
  }

  protected async addFiles(): Promise<void> {
    const k = this.adding();
    if (!k || !this.modelId() || this.busy()) {
      return;
    }
    await this.run(async () => {
      await this.api.addKitFile(k.item.id, this.modelId(), this.quantity());
      this.adding.set(null);
    });
  }

  protected openDiscard(f: KitFile): void {
    this.reason.set('');
    this.discarding.set(f);
  }

  protected async discard(): Promise<void> {
    const f = this.discarding();
    if (!f || !this.reason().trim() || this.busy()) {
      return;
    }
    if (!(await this.confirm.confirm(this.translate.instant('STER.ENDO.DISCARD_CONFIRM', { name: f.modelName }), { danger: true }))) {
      return;
    }
    await this.run(async () => {
      await this.api.discardFile(f.id, this.reason().trim());
      this.discarding.set(null);
      this.toast.success(this.translate.instant('STER.ENDO.DISCARDED'));
    });
  }

  protected editModel(m: EndoModel | null): void {
    this.modelId2.set(m?.id ?? null);
    this.model.reset(m ? { name: m.name, brand: m.brand ?? '', sizeTaper: m.sizeTaper ?? '', maxUses: m.maxUses, active: m.active } : { name: '', brand: '', sizeTaper: '', maxUses: 4, active: true });
  }

  protected async saveModel(): Promise<void> {
    const f = this.model.value();
    const id = this.modelId2();
    if (this.busy() || !f.name.trim()) {
      return;
    }
    this.busy.set(true);
    try {
      const body = { name: f.name.trim(), brand: f.brand.trim() || undefined, sizeTaper: f.sizeTaper.trim() || undefined, maxUses: f.maxUses, active: f.active };
      await (id ? this.api.updateEndoModel(id, body) : this.api.createEndoModel(body));
      await this.loadModels();
      this.editModel(null);
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.busy.set(false);
    }
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    try {
      await action();
      await this.kits.load(() => this.api.kits());
    } catch (error) {
      this.errors.report(error);
    } finally {
      this.busy.set(false);
    }
  }
}
