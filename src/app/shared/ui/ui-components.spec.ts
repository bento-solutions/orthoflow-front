import '@angular/compiler';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoA11yViolations } from '../../testing/axe';
import { ApiErrors } from '../../core/services/api-error.service';
import { DownloadService } from '../../core/services/download.service';
import { LanguageService } from '../../core/services/language.service';
import { Period, periodFor } from '../../core/utils/format';
import { ExportMenuComponent } from './export-menu.component';
import { ModalComponent } from './modal.component';
import { PeriodPickerComponent } from './period-picker.component';

@Component({
  standalone: true,
  imports: [ModalComponent],
  template: `
    <button id="opener" (click)="open.set(true)">open</button>
    <app-modal [open]="open()" title="Nouveau praticien" [dismissable]="dismissable()" (closed)="open.set(false)">
      <label>Nom <input id="first" /></label>
      <div modal-footer><button id="save" class="btn">Enregistrer</button></div>
    </app-modal>
  `,
})
class ModalHost {
  open = signal(false);
  dismissable = signal(true);
}

describe('ModalComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideTranslateService({ defaultLanguage: 'fr' })] });
  });

  const mount = async () => {
    const fixture = TestBed.createComponent(ModalHost);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    return fixture;
  };

  it('renders nothing until it is opened', async () => {
    const fixture = await mount();
    expect(fixture.nativeElement.querySelector('[role=dialog]')).toBeNull();
  });

  it('is a labelled modal dialog that moves focus to its first field', async () => {
    const fixture = await mount();
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    const dialog = fixture.nativeElement.querySelector('[role=dialog]') as HTMLElement;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')!)!.textContent).toContain('Nouveau praticien');
    await Promise.resolve();
    expect(document.activeElement?.id).toBe('first');
  });

  it('closes on Escape and gives focus back to what opened it', async () => {
    const fixture = await mount();
    const opener = fixture.nativeElement.querySelector('#opener') as HTMLButtonElement;
    opener.focus();
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
    await Promise.resolve();

    (fixture.nativeElement.querySelector('[role=dialog]') as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(fixture.componentInstance.open()).toBe(false);
    expect(fixture.nativeElement.querySelector('[role=dialog]')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('keeps Tab inside the dialog', async () => {
    const fixture = await mount();
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
    await Promise.resolve();
    const dialog = fixture.nativeElement.querySelector('[role=dialog]') as HTMLElement;
    const save = fixture.nativeElement.querySelector('#save') as HTMLButtonElement;
    save.focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    dialog.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).not.toBe(save);
  });

  it('cannot be dismissed by Escape or a backdrop click when it holds work that must not be lost', async () => {
    const fixture = await mount();
    fixture.componentInstance.dismissable.set(false);
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
    const dialog = fixture.nativeElement.querySelector('[role=dialog]') as HTMLElement;
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    (fixture.nativeElement.querySelector('.bg-black\\/50') as HTMLElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.open()).toBe(true);
    expect(fixture.nativeElement.querySelector('button[aria-label]')).toBeNull();
  });

  it('has no accessibility violations', async () => {
    const fixture = await mount();
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
    await expectNoA11yViolations(fixture.nativeElement);
  });
});

@Component({
  standalone: true,
  imports: [PeriodPickerComponent],
  template: `<app-period-picker [(value)]="period" />`,
})
class PickerHost {
  period = signal<Period>(periodFor('month', new Date()));
}

describe('PeriodPickerComponent', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideTranslateService({ defaultLanguage: 'fr' })] }));

  it('lights the preset the dates equal, and sets the dates when one is pressed', () => {
    const fixture = TestBed.createComponent(PickerHost);
    fixture.detectChanges();
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('.seg-item')) as HTMLButtonElement[];
    const pressed = () => buttons.filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.textContent!.trim());
    expect(pressed()).toEqual(['COMMON.THIS_MONTH']);

    buttons.find(b => b.textContent!.includes('LAST_MONTH'))!.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.period()).toEqual(periodFor('lastMonth'));
    expect(pressed()).toEqual(['COMMON.LAST_MONTH']);
  });

  it('un-selects the preset when a date is edited by hand', () => {
    const fixture = TestBed.createComponent(PickerHost);
    fixture.detectChanges();
    const from = fixture.nativeElement.querySelectorAll('input[type=date]')[0] as HTMLInputElement;
    from.value = '2020-01-01';
    from.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(fixture.componentInstance.period().from).toBe('2020-01-01');
    expect(fixture.nativeElement.querySelectorAll('.seg-item[aria-pressed=true]').length).toBe(0);
  });

  it('keeps the range ordered when "from" is moved past "to"', () => {
    const fixture = TestBed.createComponent(PickerHost);
    fixture.componentInstance.period.set({ from: '2026-03-01', to: '2026-03-31' });
    fixture.detectChanges();
    const from = fixture.nativeElement.querySelectorAll('input[type=date]')[0] as HTMLInputElement;
    from.value = '2026-05-10';
    from.dispatchEvent(new Event('change'));
    expect(fixture.componentInstance.period()).toEqual({ from: '2026-05-10', to: '2026-05-10' });
  });
});

@Component({
  standalone: true,
  imports: [ExportMenuComponent],
  template: `<app-export-menu path="/finance/debts/export" [query]="{ debtOnly: true }" fallbackName="situation" />`,
})
class ExportHost {}

describe('ExportMenuComponent', () => {
  const download = vi.fn();
  const report = vi.fn();

  beforeEach(() => {
    download.mockReset();
    report.mockReset();
    TestBed.configureTestingModule({
      providers: [
        provideTranslateService({ defaultLanguage: 'fr' }),
        { provide: DownloadService, useValue: { download } },
        { provide: ApiErrors, useValue: { report } },
        { provide: LanguageService, useValue: { currentLang: () => 'ar' } },
      ],
    });
  });

  const open = () => {
    const fixture = TestBed.createComponent(ExportHost);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();
    fixture.detectChanges();
    return fixture;
  };

  it('offers the three formats once opened', () => {
    const fixture = open();
    const items = Array.from(fixture.nativeElement.querySelectorAll('[role=menuitem]')) as HTMLElement[];
    expect(items.map(i => i.textContent!.trim())).toEqual(['PDF', 'Excel', 'CSV']);
  });

  it('downloads in the chosen format, in the interface language, with the current filters', async () => {
    download.mockResolvedValue(undefined);
    const fixture = open();
    (fixture.nativeElement.querySelectorAll('[role=menuitem]')[1] as HTMLElement).click();
    await fixture.whenStable();
    expect(download).toHaveBeenCalledWith('/finance/debts/export', { debtOnly: true, format: 'xlsx', lang: 'ar' }, 'situation.xlsx');
  });

  it('reports a failed download instead of failing silently', async () => {
    download.mockRejectedValue(new Error('boom'));
    const fixture = open();
    (fixture.nativeElement.querySelectorAll('[role=menuitem]')[0] as HTMLElement).click();
    await fixture.whenStable();
    expect(report).toHaveBeenCalledTimes(1);
  });

  it('closes when the person clicks elsewhere', () => {
    const fixture = open();
    document.body.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role=menu]')).toBeNull();
  });
});
