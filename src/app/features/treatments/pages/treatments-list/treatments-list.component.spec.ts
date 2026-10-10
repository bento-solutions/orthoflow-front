import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialogService } from '../../../../core/services/confirm-dialog.service';
import { NgapAct, NgapService } from '../../../../core/services/ngap.service';
import { StockService } from '../../../../core/services/stock.service';
import { ToastService } from '../../../../core/services/toast.service';
import { TreatmentsListComponent } from './treatments-list.component';

/**
 * A treatment's insurer code is an act of the NGAP: the form finds it by code or label, takes the
 * nomenclature's coefficient, shows the cotation the care form will print ("D 90"), and saves
 * "blank" as "not set".
 */
describe('TreatmentsListComponent — NGAP act', () => {
  const act = (code: string, coefficient: number | null, label: string, priorAgreement = false): NgapAct => ({
    code, keyLetter: 'D', coefficient, anesthesiaCoefficient: null, label, chapter: 'ch', section: null, notes: null, priorAgreement, assimilatedTo: null,
  });
  const acts = [
    act('D629', 90, 'Traitement des dysmorphoses, par période de six mois', true),
    act('D708', 12, 'Détartrage complet sus- et sous-gingival, par séance (deux séances au maximum)'),
  ];
  const bracket = { id: 't-1', code: 'ORTHO-01', name: 'Bague', basePrice: 1500, active: true, consumables: [], actCode: 'D629', actCoefficient: 90 };
  const plain = { id: 't-2', code: 'CONS', name: 'Consultation', basePrice: 200, active: true, consumables: [] };
  let update: ReturnType<typeof vi.fn>;

  const settle = async (fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const open = async () => {
    const fixture = TestBed.createComponent(TreatmentsListComponent);
    await settle(fixture);
    return fixture;
  };

  beforeEach(() => {
    update = vi.fn(() => of({}));
    TestBed.configureTestingModule({
      imports: [TreatmentsListComponent, TranslateModule.forRoot()],
      providers: [
        { provide: StockService, useValue: { getTreatments: () => of([bracket, plain]), getStockItems: () => of([]), updateTreatment: update, createTreatment: vi.fn(() => of({})) } },
        { provide: NgapService, useValue: { acts: () => of(acts) } },
        { provide: ConfirmDialogService, useValue: {} },
        { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn() } },
      ],
    });
  });

  it('shows the act and its cotation on the card, and nothing for a treatment without one', async () => {
    const fixture = await open();
    const cards = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('h3')).map(h => h.closest('div.flex-col')?.textContent ?? '');
    expect(cards.find(c => c.includes('Bague'))).toContain('D629');
    expect(cards.find(c => c.includes('Bague'))).toContain('D 90');
    expect(cards.find(c => c.includes('Consultation'))).not.toContain('TREATMENTS.ACT_CODE');
  });

  it('shows the chosen act, its coefficient and that it needs prior agreement', async () => {
    const fixture = await open();
    fixture.componentInstance.openEditModal(bracket as never);
    await settle(fixture);

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('#act-code')).toBeNull();
    expect(root.textContent).toContain('Traitement des dysmorphoses');
    expect(root.textContent).toContain('TREATMENTS.NGAP_PRIOR_AGREEMENT');
    expect((root.querySelector('#act-coefficient') as HTMLInputElement).value).toBe('90');
  });

  it('finds an act by its label without accents and takes its coefficient', async () => {
    const fixture = await open();
    const component = fixture.componentInstance;
    component.openEditModal(plain as never);
    component.ngapQuery.set('detartrage');
    await settle(fixture);

    expect(component.ngapMatches().map(a => a.code)).toEqual(['D708']);
    component.pickAct(component.ngapMatches()[0]);
    await settle(fixture);

    expect(component.form.actCode).toBe('D708');
    expect(component.form.actCoefficient).toBe(12);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('D 12');
  });

  it('saves a cleared act as not set', async () => {
    const fixture = await open();
    const component = fixture.componentInstance;
    component.openEditModal(bracket as never);
    component.clearAct();
    component.saveTreatment();
    expect(update.mock.calls[0][1]).toMatchObject({ actCode: undefined, actCoefficient: undefined });
  });

  it('saves the tariff by number of faces, leaving empty boxes out, and reloads it on edit', async () => {
    const fixture = await open();
    const component = fixture.componentInstance;
    component.openEditModal({ ...plain, surfacePrices: [{ surfaceCount: 2, price: 400 }] } as never);
    expect(component.faceTariff[2]).toBe(400);

    component.faceTariff[1] = 250;
    component.saveTreatment();
    expect(update.mock.calls[0][1].surfacePrices).toEqual([
      { surfaceCount: 1, price: 250 },
      { surfaceCount: 2, price: 400 },
    ]);

    // Emptying every box clears the tariff on the server (an empty list, not "unchanged").
    component.openEditModal({ ...plain, surfacePrices: [{ surfaceCount: 1, price: 250 }] } as never);
    component.faceTariff[1] = null;
    component.saveTreatment();
    expect(update.mock.calls[1][1].surfacePrices).toEqual([]);
  });
});
