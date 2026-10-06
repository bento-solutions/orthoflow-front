import '@angular/compiler';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgendaConfigService, AppointmentType, DEFAULT_STATUS_COLORS } from '../../../core/services/agenda-config.service';
import { LanguageService } from '../../../core/services/language.service';
import { screenMocks } from '../../../testing/screen-mocks';
import { AgendaSettingsComponent, blankType, codeFrom, customColors, typeProblem, typeRequest } from './agenda-settings.component';

const type = (over: Partial<AppointmentType> = {}): AppointmentType => ({
  id: 't1', code: 'CHECKUP', nameFr: 'Contrôle', nameEn: 'Check-up', nameAr: 'فحص', color: '#2f8fa2', defaultDurationMinutes: 30, bookableOnline: true, specialtyGroup: 'ANY', active: true, displayOrder: 10, ...over,
});

describe('agenda settings helpers', () => {
  it('makes a valid code from a name: capitals, digits and underscores only', () => {
    expect(codeFrom('Contrôle / activation')).toBe('CONTROLE_ACTIVATION');
    expect(codeFrom('  Urgence (attache décollée) ')).toBe('URGENCE_ATTACHE_DECOLLEE');
    expect(codeFrom('x'.repeat(80))).toHaveLength(40);
    expect(codeFrom('???')).toBe('');
  });

  it('says what is wrong with a type before it is sent', () => {
    const ok = { ...blankType(), nameFr: 'a', nameEn: 'b', nameAr: 'c' };
    expect(typeProblem(ok)).toBeNull();
    expect(typeProblem({ ...ok, nameAr: ' ' })).toBe('SET.AGENDA.PROBLEM.NAMES');
    expect(typeProblem({ ...ok, duration: 2 })).toBe('SET.AGENDA.PROBLEM.DURATION');
    expect(typeProblem({ ...ok, duration: 600 })).toBe('SET.AGENDA.PROBLEM.DURATION');
    expect(typeProblem({ ...ok, color: 'red' })).toBe('SET.AGENDA.PROBLEM.COLOR');
  });

  it('takes the code from the English name when none is typed', () => {
    const request = typeRequest({ ...blankType(), nameFr: 'Détartrage', nameEn: 'Scaling', nameAr: 'تنظيف', code: '' });
    expect(request).toMatchObject({ code: 'SCALING', defaultDurationMinutes: 30, bookableOnline: false, specialtyGroup: 'ANY' });
    expect(typeRequest({ ...blankType(), nameFr: 'a', nameEn: 'b', nameAr: 'c', code: 'MINE' }).code).toBe('MINE');
  });

  it('keeps only the colours that differ from the built-in ones', () => {
    expect(customColors({ ...DEFAULT_STATUS_COLORS })).toEqual({});
    expect(customColors({ ...DEFAULT_STATUS_COLORS, LATE: '#FF0000', ARRIVED: DEFAULT_STATUS_COLORS.ARRIVED.toUpperCase() })).toEqual({ LATE: '#FF0000' });
  });
});

describe('AgendaSettingsComponent', () => {
  let config: Record<string, unknown>;
  let saveType: ReturnType<typeof vi.fn>;
  let saveChair: ReturnType<typeof vi.fn>;
  let saveColors: ReturnType<typeof vi.fn>;
  let mocks: ReturnType<typeof screenMocks>;

  const settleUi = async (fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) => {
    for (let i = 0; i < 2; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise(resolve => setTimeout(resolve));
    }
    fixture.detectChanges();
  };
  const type_ = (el: Element | null, value: string) => {
    (el as HTMLInputElement).value = value;
    el!.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const mount = async () => {
    mocks = screenMocks();
    saveType = vi.fn(async () => undefined);
    saveChair = vi.fn(async () => undefined);
    saveColors = vi.fn(async () => undefined);
    config = {
      allTypes: async () => [type(), type({ id: 't2', code: 'OLD', nameFr: 'Ancien', active: false })],
      allChairs: async () => [{ id: 'c1', name: 'Fauteuil 1', active: true, displayOrder: 10 }],
      allRooms: async () => [{ id: 'r1', name: 'Salle A', active: true, displayOrder: 10 }],
      statusColors: signal<Record<string, string>>({}), saveType, saveChair, saveRoom: vi.fn(async () => undefined), saveStatusColors: saveColors,
    };
    TestBed.configureTestingModule({
      imports: [AgendaSettingsComponent, TranslateModule.forRoot()],
      providers: [{ provide: AgendaConfigService, useValue: config }, { provide: LanguageService, useValue: { currentLang: () => 'fr' } }, ...mocks.providers],
    });
    const fixture = TestBed.createComponent(AgendaSettingsComponent);
    document.body.appendChild(fixture.nativeElement);
    await settleUi(fixture);
    await settleUi(fixture);
    return fixture;
  };
  const buttonWith = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.includes(text)) as HTMLButtonElement | undefined;

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('lists the types, greying out a switched-off one', async () => {
    await mount();
    const rows = [...document.querySelectorAll('tbody tr')];
    expect(rows).toHaveLength(2);
    expect(rows[1].className).toContain('opacity-60');
    expect(document.body.textContent).toContain('Salle A');
  });

  it('creates a type from the French, English and Arabic names', async () => {
    const fixture = await mount();
    buttonWith('SET.AGENDA.NEW_TYPE')!.click();
    await settleUi(fixture);
    expect((document.querySelector('button[form=type-form]') as HTMLButtonElement).disabled).toBe(true);
    type_(document.querySelector('input[name=nameFr]'), 'Détartrage');
    type_(document.querySelector('input[name=nameEn]'), 'Scaling');
    type_(document.querySelector('input[name=nameAr]'), 'تنظيف');
    await settleUi(fixture);
    (document.querySelector('#type-form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settleUi(fixture);
    expect(saveType).toHaveBeenCalledWith(null, expect.objectContaining({ code: 'SCALING', nameFr: 'Détartrage', defaultDurationMinutes: 30 }));
  });

  it('cannot change the code of an existing type', async () => {
    const fixture = await mount();
    (document.querySelector('tbody button') as HTMLButtonElement).click();
    await settleUi(fixture);
    expect((document.querySelector('input[name=code]') as HTMLInputElement).disabled).toBe(true);
    (document.querySelector('#type-form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settleUi(fixture);
    expect(saveType).toHaveBeenCalledWith('t1', expect.objectContaining({ code: 'CHECKUP' }));
  });

  it('adds a chair', async () => {
    const fixture = await mount();
    [...document.querySelectorAll('button')].filter(b => b.textContent?.includes('COMMON.ADD'))[0].click();
    await settleUi(fixture);
    type_(document.querySelector('input[name=name]'), 'Fauteuil 2');
    await settleUi(fixture);
    (document.querySelector('#named-form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settleUi(fixture);
    expect(saveChair).toHaveBeenCalledWith(null, { name: 'Fauteuil 2', active: true, displayOrder: 20 });
  });

  it('saves only the colours that were changed, and offers a way back to the default', async () => {
    const fixture = await mount();
    const save = () => [...document.querySelectorAll('form button[type=submit]')].find(b => b.textContent?.includes('COMMON.SAVE') && !b.closest('[role=dialog]')) as HTMLButtonElement;
    expect(save().disabled).toBe(true);
    const inputs = [...document.querySelectorAll('input[type=color]')] as HTMLInputElement[];
    // SCHEDULED, CONFIRMED, LATE: the third is LATE
    const target = inputs[2];
    target.value = '#ff0000';
    target.dispatchEvent(new Event('input', { bubbles: true }));
    await settleUi(fixture);
    expect(save().disabled).toBe(false);
    expect(buttonWith('SET.AGENDA.RESET')).toBeDefined();
    save().click();
    await settleUi(fixture);
    expect(saveColors).toHaveBeenCalledWith({ LATE: '#ff0000' });
  });
});
