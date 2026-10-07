import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialogService } from '../../../../core/services/confirm-dialog.service';
import { StockService } from '../../../../core/services/stock.service';
import { ToastService } from '../../../../core/services/toast.service';
import { TreatmentsListComponent } from './treatments-list.component';

/**
 * The insurer's act code and coefficient are left blank until a clinic confirms its coding, so the
 * form must be able to hold them, show them, and save "blank" as "not set".
 */
describe('TreatmentsListComponent — insurance act code', () => {
  const bracket = { id: 't-1', code: 'ORTHO-01', name: 'Bague', basePrice: 1500, active: true, consumables: [], actCode: 'TO 90', actCoefficient: 90 };
  const plain = { id: 't-2', code: 'CONS', name: 'Consultation', basePrice: 200, active: true, consumables: [] };
  let update: ReturnType<typeof vi.fn>;
  let create: ReturnType<typeof vi.fn>;

  const open = async () => {
    const fixture = TestBed.createComponent(TreatmentsListComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  };

  beforeEach(() => {
    update = vi.fn(() => of({}));
    create = vi.fn(() => of({}));
    TestBed.configureTestingModule({
      imports: [TreatmentsListComponent, TranslateModule.forRoot()],
      providers: [
        { provide: StockService, useValue: { getTreatments: () => of([bracket, plain]), getStockItems: () => of([]), updateTreatment: update, createTreatment: create } },
        { provide: ConfirmDialogService, useValue: {} },
        { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn() } },
      ],
    });
  });

  it('shows the code a clinic set on the card, and nothing for an act without one', async () => {
    const fixture = await open();
    const cards = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('h3')).map(h => h.closest('div.flex-col')?.textContent ?? '');
    expect(cards.find(c => c.includes('Bague'))).toContain('TO 90');
    expect(cards.find(c => c.includes('Consultation'))).not.toContain('TREATMENTS.ACT_CODE');
  });

  it('edits the code and coefficient already set', async () => {
    const fixture = await open();
    fixture.componentInstance.openEditModal(bracket as never);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect((root.querySelector('#act-code') as HTMLInputElement).value).toBe('TO 90');
    expect((root.querySelector('#act-coefficient') as HTMLInputElement).value).toBe('90');
  });

  it('saves a blank code as not set and a filled one trimmed', async () => {
    const fixture = await open();
    const component = fixture.componentInstance;

    component.openEditModal(plain as never);
    component.form.actCode = '   ';
    component.form.actCoefficient = '' as never;
    component.saveTreatment();
    expect(update.mock.calls[0][1]).toMatchObject({ actCode: undefined, actCoefficient: undefined });

    component.openEditModal(bracket as never);
    component.form.actCode = ' TO 91 ';
    component.form.actCoefficient = 12.5;
    component.saveTreatment();
    expect(update.mock.calls[1][1]).toMatchObject({ actCode: 'TO 91', actCoefficient: 12.5 });
  });
});
