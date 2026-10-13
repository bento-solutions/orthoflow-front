import '@angular/compiler';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyPerioData, withValue } from '../../../core/clinical/perio/perio-data';
import { PerioData, ToothStatusMap } from '../../../core/clinical/perio/perio.model';
import { expectNoA11yViolations } from '../../../testing/axe';
import { PerioGridComponent, PerioValueChange } from './perio-grid.component';
import { PerioStatusChange } from './perio-numbers.component';

/** The real French translations, so a spec can say "no raw key reaches the screen". */
const french = JSON.parse(readFileSync(join(process.cwd(), 'public', 'i18n', 'fr.json'), 'utf-8'));
const useFrench = (): void => {
  const translate = TestBed.inject(TranslateService);
  translate.setTranslation('fr', french);
  translate.use('fr');
};

describe('PerioGridComponent', () => {
  let changes: PerioValueChange[];
  let statuses: PerioStatusChange[];
  let modes: string[];

  const mount = async (data: PerioData = emptyPerioData(), status: ToothStatusMap = {}) => {
    TestBed.configureTestingModule({ imports: [PerioGridComponent, TranslateModule.forRoot()] });
    useFrench();
    const fixture = TestBed.createComponent(PerioGridComponent);
    fixture.componentRef.setInput('data', data);
    fixture.componentRef.setInput('toothStatus', status);
    fixture.componentInstance.valueChange.subscribe((c) => changes.push(c));
    fixture.componentInstance.statusChange.subscribe((s) => statuses.push(s));
    fixture.componentInstance.modeChange.subscribe((m) => modes.push(m));
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  };

  const sheet = () => document.querySelector('.sheet') as HTMLElement;
  const press = (key: string, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    sheet().dispatchEvent(event);
    return event;
  };
  const type = (keys: string) => [...keys].forEach((k) => press(k));
  const cellEl = (row: number, tooth: string, site: string) =>
    document.querySelectorAll('app-perio-row')[row].querySelector(`g[data-tooth="${tooth}"][data-site="${site}"]`) as SVGGElement;
  // order of the rows on the sheet
  const ROW = { bleedingUpper: 0, plaqueUpper: 1, mobilityUpper: 3, furcationUpper: 4, pocketUpper: 5, recessionUpper: 6 };

  beforeEach(() => {
    document.body.innerHTML = '';
    changes = [];
    statuses = [];
    modes = [];
  });
  afterEach(() => vi.useRealTimers());

  it('starts on the first probing site of the mouth, in pocket depth', async () => {
    await mount();
    // exactly one cell is highlighted, and it is the first of the pocket depth row of the upper arch
    expect(document.querySelectorAll('rect[stroke="#3b82f6"]')).toHaveLength(1);
    expect(cellEl(ROW.pocketUpper, '18', 'distobuccal').querySelector('rect[stroke="#3b82f6"]')).not.toBeNull();
  });

  it('writes each digit where the cursor is and walks on to the next site', async () => {
    await mount();
    type('345');

    expect(changes.map((c) => [c.tooth, c.site, c.mode, c.value])).toEqual([
      ['18', 'distobuccal', 'pocketDepth', 3],
      ['18', 'buccal', 'pocketDepth', 4],
      ['18', 'mesiobuccal', 'pocketDepth', 5],
    ]);
  });

  it('makes 10 to 16 from a 1 and a second digit, and a lone 1 means one millimetre', async () => {
    vi.useFakeTimers();
    await mount();

    type('12');
    expect(changes.map((c) => c.value)).toEqual([12]);

    press('1');
    expect(changes).toHaveLength(1);
    vi.advanceTimersByTime(500);
    expect(changes.map((c) => c.value)).toEqual([12, 1]);
    expect(changes[1].site).toBe('buccal');
  });

  it('moves with Enter and the arrows', async () => {
    await mount();
    press('Enter');
    type('4');
    press('ArrowLeft');
    press('ArrowLeft');
    type('6');

    expect(changes.map((c) => [c.site, c.value])).toEqual([['buccal', 4], ['distobuccal', 6]]);
  });

  it('clears the value under the cursor with Backspace and steps back, so a second Backspace undoes the last entry', async () => {
    await mount();
    type('6');       // 18 distobuccal = 6, the cursor moves on to 18 buccal
    press('Backspace'); // clears 18 buccal (nothing there) and steps back
    press('Backspace'); // clears 18 distobuccal: the 6

    expect(changes.map((c) => [c.site, c.value])).toEqual([
      ['distobuccal', 6],
      ['buccal', null],
      ['distobuccal', null],
    ]);
  });

  it('refuses a depth the examination cannot have, says why, and stays put', async () => {
    const fixture = await mount();
    type('1');
    type('9'); // 19 mm

    expect(changes).toEqual([]);
    fixture.detectChanges();
    expect(document.querySelector('[role=alert]')?.textContent).toContain('ne peut pas dépasser 16 mm');
  });

  it('records recession, including a negative one with the minus key', async () => {
    await mount();
    const recession = cellEl(ROW.recessionUpper, '18', 'distobuccal');
    recession.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    type('2');
    press('-');

    expect(modes).toEqual(['recession']);
    expect(changes.map((c) => [c.mode, c.site, c.value])).toEqual([
      ['recession', 'distobuccal', 2],
      ['recession', 'buccal', -1],
    ]);
  });

  it('toggles a flag when its dot is clicked, and when its own letter is pressed in its row', async () => {
    const fixture = await mount();
    cellEl(ROW.bleedingUpper, '16', 'buccal').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(changes).toEqual([{ tooth: '16', site: 'buccal', mode: 'bleeding', value: true }]);
    expect(modes).toEqual(['bleeding']);

    // the chart now shows the bleeding the click recorded
    fixture.componentRef.setInput('data', withValue(emptyPerioData(), '16', 'bleeding', 'buccal', true));
    fixture.detectChanges();

    press('p'); // plaque is not this row's key: nothing happens
    expect(changes).toHaveLength(1);
    press('b'); // the cursor is on that dot: B toggles it off, and moves on
    expect(changes.at(-1)).toEqual({ tooth: '16', site: 'buccal', mode: 'bleeding', value: false });
    press('b');
    expect(changes.at(-1)).toMatchObject({ tooth: '16', site: 'mesiobuccal', value: true });
  });

  it('turns a flag off when its dot is clicked again', async () => {
    const data = withValue(emptyPerioData(), '16', 'plaque', 'buccal', true);
    await mount(data);
    cellEl(ROW.plaqueUpper, '16', 'buccal').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(changes).toEqual([{ tooth: '16', site: 'buccal', mode: 'plaque', value: false }]);
  });

  it('takes 0 to 3 for mobility on the tooth, and grades furcation with 1 to 3', async () => {
    await mount();
    cellEl(ROW.mobilityUpper, '16', 'buccal').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    type('2');
    cellEl(ROW.furcationUpper, '16', 'buccal').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    type('3');
    type('7'); // not a grade

    expect(changes.map((c) => [c.mode, c.tooth, c.value])).toEqual([
      ['mobility', '16', 2],
      ['furcation', '16', 'III'],
    ]);
  });

  it('steps over a tooth that is missing', async () => {
    await mount(emptyPerioData(), { '17': 'missing' });
    press('Enter'); press('Enter'); // to 18 mesiobuccal
    type('3');
    expect(changes.at(-1)).toMatchObject({ tooth: '18', site: 'mesiobuccal' });
    type('4');
    expect(changes.at(-1)).toMatchObject({ tooth: '16', site: 'distobuccal' });
  });

  it('does not let a missing tooth be charted by clicking on it', async () => {
    await mount(emptyPerioData(), { '17': 'missing' });
    cellEl(ROW.bleedingUpper, '17', 'buccal').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(changes).toEqual([]);
  });

  it('puts the cursor on a site when its tooth drawing is clicked', async () => {
    await mount();
    const site = document.querySelector('app-perio-teeth g[data-tooth="13"][data-site="mesiobuccal"]') as SVGGElement;
    site.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    type('5');
    expect(changes).toEqual([{ tooth: '13', site: 'mesiobuccal', mode: 'pocketDepth', value: 5 }]);
  });

  it('keeps the keyboard shortcuts of the browser', async () => {
    await mount();
    const event = press('3', { ctrlKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(changes).toEqual([]);
  });

  it('leaves the keys of a tooth-number button to the button', async () => {
    await mount();
    const chip = document.querySelector('button.chip') as HTMLElement;
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    chip.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('reports a status picked from the tooth number menu', async () => {
    const fixture = await mount();
    (document.querySelector('button.chip') as HTMLElement).click();
    fixture.detectChanges();
    (document.querySelector('.popover .option.implant') as HTMLElement).click();
    expect(statuses).toEqual([{ tooth: '18', status: 'implant' }]);
  });

  it('moves the cursor off a tooth that has just gone missing', async () => {
    const fixture = await mount();
    fixture.componentRef.setInput('toothStatus', { '18': 'missing' });
    fixture.detectChanges();
    await fixture.whenStable();
    type('3');
    expect(changes.at(-1)).toMatchObject({ tooth: '17' });
  });

  it('shows the tooth numbers in the system that was asked for', async () => {
    const fixture = await mount();
    fixture.componentRef.setInput('numbering', 'universal');
    fixture.detectChanges();
    const labels = [...document.querySelectorAll('button.chip span')].map((s) => s.textContent?.trim());
    expect(labels.slice(0, 3)).toEqual(['1', '2', '3']);
  });

  it('draws a probing line only between sites that have a depth', async () => {
    let data = emptyPerioData();
    data = withValue(data, '16', 'pocketDepth', 'distobuccal', 3);
    data = withValue(data, '16', 'pocketDepth', 'buccal', 4);
    data = withValue(data, '15', 'pocketDepth', 'buccal', 2); // alone: a dot, not a line
    const fixture = await mount(data);
    fixture.detectChanges();
    const lines = document.querySelectorAll('app-perio-teeth polyline');
    expect(lines).toHaveLength(1);
    expect(lines[0].getAttribute('points')?.split(' ')).toHaveLength(2);
  });

  it('shows no raw translation key anywhere on the sheet', async () => {
    const fixture = await mount();
    (document.querySelector('button.chip') as HTMLElement).click(); // open a tooth's menu as well
    fixture.detectChanges();
    expect(document.body.textContent).not.toMatch(/PERIO\./);
    expect(document.body.textContent).toContain('Profondeur de poche');
  });

  it('has no accessibility violations', async () => {
    await mount();
    await expectNoA11yViolations(document.body);
  }, 60_000);
});
