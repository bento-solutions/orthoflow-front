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
    fixture.componentInstance.voice.subscribe(() => picked.push('voice'));
    fixture.componentInstance.consultation.subscribe(() => picked.push('consultation'));
    fixture.componentInstance.showIntro.subscribe(() => picked.push('showIntro'));
    fixture.componentRef.setInput('consultationAvailable', true);
    fixture.detectChanges();
  });

  function open(): HTMLButtonElement[] {
    (el.querySelector('.cm-trigger') as HTMLButtonElement).click();
    fixture.detectChanges();
    return Array.from(el.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
  }

  it('offers a voice session and a new consultation, and closes on a pick', () => {
    const items = open();
    expect(items).toHaveLength(2);
    items[1].click();
    fixture.detectChanges();
    expect(picked).toEqual(['consultation']);
    expect(el.querySelector('[role="menu"]')).toBeNull();
  });

  it('keeps a new consultation disabled when the clinic has it off', () => {
    fixture.componentRef.setInput('consultationAvailable', false);
    fixture.detectChanges();
    const items = open();
    expect(items[1].disabled).toBe(true);
    items[0].click();
    expect(picked).toEqual(['voice']);
  });

  it('offers the consent card back once the doctor has hidden it', () => {
    fixture.componentRef.setInput('introHidden', true);
    fixture.detectChanges();
    const items = open();
    expect(items).toHaveLength(3);
    items[2].click();
    expect(picked).toEqual(['showIntro']);
  });

  it('closes on Escape', () => {
    open();
    (el.querySelector('[role="menu"]') as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(el.querySelector('[role="menu"]')).toBeNull();
  });
});
