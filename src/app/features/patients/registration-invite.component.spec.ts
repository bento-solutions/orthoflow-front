import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IntakeApi } from '../../core/services/intake-api.service';
import { screenMocks } from '../../testing/screen-mocks';
import { RegistrationInviteComponent } from './registration-invite.component';

describe('RegistrationInviteComponent', () => {
  let api: { inviteToRegister: ReturnType<typeof vi.fn> };
  let mocks: ReturnType<typeof screenMocks>;
  let writeText: ReturnType<typeof vi.fn>;

  const mount = async (can: Parameters<typeof screenMocks>[0] = {}) => {
    mocks = screenMocks(can);
    TestBed.configureTestingModule({ imports: [RegistrationInviteComponent, TranslateModule.forRoot()], providers: [{ provide: IntakeApi, useValue: api }, ...mocks.providers] });
    const fixture = TestBed.createComponent(RegistrationInviteComponent);
    fixture.componentRef.setInput('patientId', 'p1');
    fixture.componentRef.setInput('name', 'Sara Alami');
    document.body.appendChild(fixture.nativeElement);
    for (let i = 0; i < 2; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise(resolve => setTimeout(resolve));
    }
    return fixture;
  };
  const flush = async (fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) => {
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise(resolve => setTimeout(resolve));
    fixture.detectChanges();
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    api = { inviteToRegister: vi.fn(async () => ({ url: 'https://clinic.ma/public/register/abc', sent: false })) };
    writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });

  it('makes a link for the patient and shows it', async () => {
    const fixture = await mount();
    (document.querySelector('button') as HTMLButtonElement).click();
    await flush(fixture);
    expect(api.inviteToRegister).toHaveBeenCalledWith('p1');
    expect((document.querySelector('[role=dialog] input') as HTMLInputElement).value).toBe('https://clinic.ma/public/register/abc');
    expect(document.querySelector('[role=dialog]')!.textContent).toContain('PAT.INVITE.HINT');
  });

  it('copies the link', async () => {
    const fixture = await mount();
    (document.querySelector('button') as HTMLButtonElement).click();
    await flush(fixture);
    ([...document.querySelectorAll('[role=dialog] button')].find(b => b.textContent?.includes('PAT.INVITE.COPY')) as HTMLButtonElement).click();
    await flush(fixture);
    expect(writeText).toHaveBeenCalledWith('https://clinic.ma/public/register/abc');
    expect(document.querySelector('[role=dialog]')!.textContent).toContain('PAT.INVITE.COPIED');
  });

  it('says to copy by hand when the browser refuses the clipboard', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    const fixture = await mount();
    (document.querySelector('button') as HTMLButtonElement).click();
    await flush(fixture);
    ([...document.querySelectorAll('[role=dialog] button')].find(b => b.textContent?.includes('PAT.INVITE.COPY')) as HTMLButtonElement).click();
    await flush(fixture);
    expect(mocks.toasts).toHaveLength(1);
  });

  it('is not offered to someone who may not edit patients', async () => {
    await mount({ can: ['PATIENT_READ'] });
    expect(document.querySelector('button')).toBeNull();
  });
});
