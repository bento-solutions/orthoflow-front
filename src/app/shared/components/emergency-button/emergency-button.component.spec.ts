import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { EmergencyButtonComponent } from './emergency-button.component';

describe('EmergencyButtonComponent', () => {
  let fixture: ComponentFixture<EmergencyButtonComponent>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EmergencyButtonComponent, TranslateModule.forRoot()],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(EmergencyButtonComponent);
    fixture.detectChanges();
    const req = httpMock.expectOne(r => r.url.endsWith('/public/config'));
    req.flush({
      clinicName: 'Orthoflow Clinic',
      baileysPhone: '+212754411515',
      emergencyMarker: 'URGENT',
      captchaEnabled: false,
      captchaSiteKey: '',
    });
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('opens the emergency panel with tel and prefixed WhatsApp URGENT links', () => {
    const trigger = fixture.nativeElement.querySelector('[data-testid="emergency-trigger"]') as HTMLButtonElement;
    expect(trigger).toBeTruthy();
    expect(trigger.textContent).toContain('PUB.EMERGENCY.CTA');

    trigger.click();
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog).toBeTruthy();
    const call = dialog.querySelector('[data-testid="emergency-call"]') as HTMLAnchorElement;
    const wa = dialog.querySelector('[data-testid="emergency-whatsapp"]') as HTMLAnchorElement;
    expect(call.getAttribute('href')).toBe('tel:+212754411515');
    expect(wa.getAttribute('href')).toContain('https://wa.me/212754411515?text=URGENT');

    const closeBtn = dialog.querySelector('[data-testid="emergency-close"]') as HTMLButtonElement;
    closeBtn.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeFalsy();
  });
});
