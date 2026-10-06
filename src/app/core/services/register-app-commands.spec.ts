import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandPaletteComponent } from '../../shared/components/command-palette/command-palette.component';
import { PatientDirectoryApi } from '../../features/patients/patient-directory-api.service';
import { CommandRegistryService } from './command-registry.service';
import { LanguageService } from './language.service';
import { PermissionService } from './permission.service';
import { registerAppCommands } from './register-app-commands';

const tree = (lang: string): Record<string, unknown> => JSON.parse(readFileSync(join(process.cwd(), 'public', 'i18n', `${lang}.json`), 'utf-8'));
const has = (t: Record<string, unknown>, key: string): boolean => {
  let node: unknown = t;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null || !(part in node)) return false;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string';
};

describe('registerAppCommands', () => {
  let granted: string[];
  let navigated: string[];
  let registry: CommandRegistryService;

  beforeEach(() => {
    granted = ['PATIENT_READ', 'AGENDA_VIEW'];
    navigated = [];
    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot()],
      providers: [{ provide: PermissionService, useValue: { can: (...needed: string[]) => needed.some(p => granted.includes(p)) } }],
    });
    registry = TestBed.inject(CommandRegistryService);
    registerAppCommands(registry, { navigateByUrl: (u: string) => { navigated.push(u); return Promise.resolve(true); } } as unknown as Router);
  });

  it('labels every command with a translation that exists in French, English and Arabic', () => {
    // with every permission granted, all commands are listed
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [TranslateModule.forRoot()], providers: [{ provide: PermissionService, useValue: { can: () => true } }] });
    const everything = TestBed.inject(CommandRegistryService);
    registerAppCommands(everything, { navigateByUrl: () => Promise.resolve(true) } as unknown as Router);
    const keys = everything.availableFor('/').map(c => c.label);
    expect(keys.length).toBeGreaterThan(40);
    for (const lang of ['fr', 'en', 'ar']) {
      expect(keys.filter(k => !has(tree(lang), k)), `missing in ${lang}`).toEqual([]);
    }
  });

  it('offers only what the person may open', () => {
    const ids = registry.availableFor('/').map(c => c.id);
    expect(ids).toContain('nav.patients');
    expect(ids).toContain('nav.schedule');
    expect(ids).not.toContain('nav.finance');
    expect(ids).not.toContain('nav.retrocessions');
    expect(ids).not.toContain('nav.settings.users');
    // what has no permission attached is for everyone
    expect(ids).toContain('nav.account');
  });

  it('goes to the page it names', () => {
    registry.availableFor('/').find(c => c.id === 'nav.patients')!.execute();
    expect(navigated).toEqual(['/patients']);
  });

  it('has a search keyword in French for the screens people look for by their French name', () => {
    granted = ['FINANCE_VIEW', 'BILLING_READ'];
    const cash = registry.availableFor('/').find(c => c.id === 'nav.finance.cash')!;
    expect(cash.keywords).toContain('clôture de caisse');
  });
});

describe('CommandPaletteComponent', () => {
  let list: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;

  const mount = (granted: string[]) => {
    list = vi.fn(async () => ({ content: [{ id: 'p1', firstName: 'Sara', lastName: 'Alami', patientCode: 'P-1', phone: '0600' }] }));
    navigate = vi.fn(async () => true);
    TestBed.configureTestingModule({
      imports: [CommandPaletteComponent, TranslateModule.forRoot()],
      providers: [
        { provide: PermissionService, useValue: { can: (...needed: string[]) => needed.some(p => granted.includes(p)) } },
        { provide: LanguageService, useValue: { currentLang: signal('fr') } },
        { provide: PatientDirectoryApi, useValue: { list } },
        { provide: Router, useValue: { url: '/', navigate, navigateByUrl: navigate } },
      ],
    });
    TestBed.inject(TranslateService).use('fr');
    registerAppCommands(TestBed.inject(CommandRegistryService), TestBed.inject(Router));
    const fixture = TestBed.createComponent(CommandPaletteComponent);
    document.body.appendChild(fixture.nativeElement);
    TestBed.inject(CommandRegistryService).open();
    fixture.detectChanges();
    return fixture;
  };
  const type = async (fixture: { detectChanges(): void; whenStable(): Promise<unknown> }, text: string) => {
    const input = document.querySelector('input.palette-input') as HTMLInputElement;
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    await fixture.whenStable();
    // the search waits 250 ms for typing to stop
    await new Promise(resolve => setTimeout(resolve, 330));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('finds a page by its French name even though the screen has no French translation loaded', async () => {
    const fixture = mount(['FINANCE_VIEW', 'BILLING_READ', 'PATIENT_READ']);
    await type(fixture, 'clôture');
    const labels = [...document.querySelectorAll('.item-label')].map(l => l.textContent);
    expect(labels.some(l => /cash|closing|CMD\.CASH_CLOSING/i.test(l ?? ''))).toBe(true);
  });

  it('searches patients on the server a moment after typing and goes to the one chosen', async () => {
    const fixture = mount(['PATIENT_READ']);
    await type(fixture, 'alam');
    expect(list).toHaveBeenCalledWith({ search: 'alam', size: 5 });
    const hit = [...document.querySelectorAll('.palette-item')].find(b => b.textContent?.includes('Sara Alami')) as HTMLButtonElement;
    expect(hit).toBeDefined();
    hit.click();
    expect(navigate).toHaveBeenCalledWith(['/patients', 'p1']);
  });

  it('does not search patients for someone who may not read them', async () => {
    const fixture = mount(['AGENDA_VIEW']);
    await type(fixture, 'alam');
    expect(list).not.toHaveBeenCalled();
  });

  it('does not search for a single character', async () => {
    const fixture = mount(['PATIENT_READ']);
    await type(fixture, 'a');
    expect(list).not.toHaveBeenCalled();
  });
});
