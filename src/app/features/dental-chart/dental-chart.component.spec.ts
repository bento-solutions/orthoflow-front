import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TranslateModule } from '@ngx-translate/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DentalChartComponent } from './dental-chart.component';

/** The keys only: where the drawing puts each tooth takes a real browser (tools/a11y/chart-keys.mjs). */
describe('DentalChartComponent from the keyboard', () => {
  let fixture: ComponentFixture<DentalChartComponent>;
  let root: HTMLElement;

  const setup = (inputs: Record<string, unknown> = {}) => {
    fixture = TestBed.createComponent(DentalChartComponent);
    Object.entries(inputs).forEach(([name, value]) => fixture.componentRef.setInput(name, value));
    root = fixture.nativeElement;
    document.body.appendChild(root);
    fixture.detectChanges();
  };
  const cell = (fdi: string) => root.querySelector<HTMLElement>(`[data-fdi="${fdi}"]`)!;
  const focused = () => (document.activeElement as HTMLElement | null)?.dataset['fdi'];
  const press = (key: string, init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    document.activeElement?.dispatchEvent(event);
    fixture.detectChanges();
    return event;
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [DentalChartComponent, TranslateModule.forRoot()],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    Element.prototype.scrollIntoView = () => undefined;
  });

  afterEach(() => root.remove());

  it('is one grid with one row per arch, and one stop on Tab', () => {
    setup();
    expect(root.querySelector('[role=grid]')).not.toBeNull();
    expect(root.querySelectorAll('[role=row]').length).toBe(2);
    expect(root.querySelectorAll('[role=row] > [role=gridcell]').length).toBe(32);
    expect(root.querySelectorAll('[role=gridcell][tabindex="0"]').length).toBe(1);
    expect(root.querySelector('[role=gridcell][tabindex="0"]')?.getAttribute('data-fdi')).toBe('18');
  });

  it('hides the drawing, for which the grid stands in', () => {
    setup();
    expect(root.querySelector('.svg-drawing')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('describes its keys', () => {
    setup();
    const described = root.querySelector('[role=grid]')?.getAttribute('aria-describedby');
    expect(document.getElementById(described!)?.textContent).toContain('DENTAL_CHART.KEYS_MOUTH');
  });

  it('moves along the arch and to the opposing tooth, and the tab stop moves too', () => {
    setup();
    cell('18').focus();
    expect(press('ArrowRight').defaultPrevented).toBe(true);
    expect(focused()).toBe('17');
    press('ArrowDown');
    expect(focused()).toBe('47');
    expect(root.querySelector('[role=gridcell][tabindex="0"]')?.getAttribute('data-fdi')).toBe('47');
  });

  it('goes to a tooth by its number', () => {
    setup();
    cell('18').focus();
    press('3');
    press('6');
    expect(focused()).toBe('36');
  });

  it('closes in with Enter, follows the arrows there, and comes back with Escape', () => {
    setup();
    cell('16').focus();
    press('Enter');
    expect(root.querySelector('.svg-container.close-up')).not.toBeNull();
    expect(cell('16').getAttribute('aria-selected')).toBe('true');
    expect(root.querySelector('[role=grid]')?.getAttribute('aria-describedby')).toBeTruthy();

    press('ArrowRight');
    expect(focused()).toBe('15');
    expect(cell('15').getAttribute('aria-selected')).toBe('true');

    expect(press('Escape').defaultPrevented).toBe(true);
    expect(root.querySelector('.svg-container.close-up')).toBeNull();
    expect(focused()).toBe('15');
  });

  it('lets Escape through once there is nothing to come back from', () => {
    setup();
    cell('16').focus();
    expect(press('Escape').defaultPrevented).toBe(false);
  });

  it('opens the tooth as a dialog on the second Enter, and goes back to it on closing', () => {
    setup();
    cell('16').focus();
    press('Enter');
    expect(root.querySelector('[role=dialog]')).toBeNull();
    press('Enter');
    expect(root.querySelector('[role=dialog]')).not.toBeNull();

    fixture.componentInstance.closeStatusMenu();
    fixture.detectChanges();
    expect(root.querySelector('[role=dialog]')).toBeNull();
    expect(focused()).toBe('16');
  });

  it('opens nothing on a chart that only reads', () => {
    setup({ interactive: false, summary: true });
    cell('16').focus();
    press('Enter');
    press('Enter');
    expect(root.querySelector('.svg-container.close-up')).not.toBeNull();
    expect(root.querySelector('[role=dialog]')).toBeNull();
    cell('16').click();
    fixture.detectChanges();
    expect(root.querySelector('[role=dialog]')).toBeNull();
  });

  it('reads out what is on the tooth, not just its number', () => {
    setup({ teeth: { '16': { id: '16', status: 'caries', notes: 'À surveiller' } }, toothNotes: { '16': ['Couronne'] } });
    const label = cell('16').getAttribute('aria-label')!;
    expect(label).toContain('16');
    expect(label).toContain('DENTAL_CHART.STATUS.CARIES');
    expect(label).toContain('Couronne');
    expect(label).toContain('À surveiller');
  });
});
