import '@angular/compiler';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { computed, signal } from '@angular/core';
import { provideTranslateService } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';
import { AuthService } from '../../../core/services/auth.service';
import { SessionExpiryBannerComponent } from './session-expiry-banner.component';

describe('SessionExpiryBannerComponent', () => {
  const warning = signal<number | null>(null);
  const token = signal<string | null>('jwt');
  let login: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    warning.set(null);
    token.set('jwt');
    login = vi.fn(() => {
      warning.set(null);
      return of({ token: 'fresh', user: { email: 'dr@cabinet.ma' } });
    });
    await TestBed.configureTestingModule({
      imports: [SessionExpiryBannerComponent],
      providers: [
        provideTranslateService({ defaultLanguage: 'fr' }),
        {
          provide: AuthService,
          useValue: {
            expiryWarning: warning.asReadonly(),
            isAuthenticated: computed(() => !!token()),
            currentUser: signal({ email: 'dr@cabinet.ma' }),
            login,
          },
        },
      ],
    }).compileComponents();
  });

  const render = () => {
    const fixture = TestBed.createComponent(SessionExpiryBannerComponent);
    fixture.detectChanges();
    return fixture;
  };

  /** Types into the password field once ngModel has settled, and submits. */
  const typeAndSubmit = async (fixture: ReturnType<typeof render>, password: string) => {
    await fixture.whenStable();
    const input: HTMLInputElement = fixture.nativeElement.querySelector('input[type="password"]');
    input.value = password;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();
  };

  it('shows nothing while the session can still be renewed', () => {
    expect(render().nativeElement.querySelector('section')).toBeNull();
  });

  it('says on screen that the session is ending, and lets the person sign in again in place', async () => {
    warning.set(10);
    const fixture = render();
    const section: HTMLElement = fixture.nativeElement.querySelector('section');
    expect(section).not.toBeNull();
    expect(section.querySelector('[role="status"]')).not.toBeNull();

    await typeAndSubmit(fixture, 'correct horse');

    expect(login).toHaveBeenCalledWith('dr@cabinet.ma', 'correct horse');
    expect(fixture.nativeElement.querySelector('section')).toBeNull();
  });

  it('says so when the password is wrong, and stays', async () => {
    login.mockReturnValueOnce(throwError(() => ({ status: 401 })));
    warning.set(5);
    const fixture = render();
    await typeAndSubmit(fixture, 'wrong');

    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('section')).not.toBeNull();
  });

  it('can be put aside, and comes back at the next, closer warning', () => {
    warning.set(30);
    const fixture = render();
    (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[])
      .find(b => b.type === 'button')!.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('section')).toBeNull();

    warning.set(10);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('section')).not.toBeNull();
  });
});
