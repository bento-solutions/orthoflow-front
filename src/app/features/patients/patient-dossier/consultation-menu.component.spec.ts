import '@angular/compiler';
import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { ConsultationMenuComponent } from './consultation-menu.component';

describe('ConsultationMenuComponent', () => {
  let fixture: ComponentFixture<ConsultationMenuComponent>;
  let el: HTMLElement;
  let picked: string[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ConsultationMenuComponent],
      providers: [provideTranslateService()],
    }).compileComponents();
    fixture = TestBed.createComponent(ConsultationMenuComponent);
    el = fixture.nativeElement;
    picked = [];
    fixture.componentInstance.consultation.subscribe(() => picked.push('consultation'));
    fixture.componentInstance.showIntro.subscribe(() => picked.push('showIntro'));
    fixture.componentRef.setInput('consultationAvailable', true);
    fixture.detectChanges();
  });

  function trigger(): HTMLButtonElement {
    return el.querySelector('.cm-trigger') as HTMLButtonElement;
  }

  it('starts a consultation in one tap, with no menu and no dictation entry', () => {
    expect(trigger().textContent).toContain('CONSULTATION.BUTTON');
    trigger().click();
    fixture.detectChanges();
    expect(picked).toEqual(['consultation']);
    expect(el.querySelector('[role="menu"]')).toBeNull();
    expect(el.textContent).not.toContain('VOICE.START');
  });

  it('explains instead of starting when the clinic has consultations off', () => {
    fixture.componentRef.setInput('consultationAvailable', false);
    fixture.detectChanges();
    trigger().click();
    fixture.detectChanges();
    expect(picked).toEqual([]);
    expect(el.querySelector('.cm-note')?.textContent).toContain('CONSULTATION.MENU_OFF');
  });

  it('offers the consent card back once the doctor has hidden it', () => {
    expect(el.querySelector('.cm-more')).toBeNull();
    fixture.componentRef.setInput('introHidden', true);
    fixture.detectChanges();
    (el.querySelector('.cm-more') as HTMLButtonElement).click();
    fixture.detectChanges();
    const items = Array.from(el.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    expect(items).toHaveLength(1);
    items[0].click();
    expect(picked).toEqual(['showIntro']);
  });

  it('closes on Escape', () => {
    fixture.componentRef.setInput('introHidden', true);
    fixture.detectChanges();
    (el.querySelector('.cm-more') as HTMLButtonElement).click();
    fixture.detectChanges();
    (el.querySelector('[role="menu"]') as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(el.querySelector('[role="menu"]')).toBeNull();
  });
});
