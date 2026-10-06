import '@angular/compiler';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialogService } from '../../core/services/confirm-dialog.service';
import { LanguageService } from '../../core/services/language.service';
import { InboxMessage, MessageLog, MessageTemplate, MessagingApi } from '../../core/services/messaging-api.service';
import { NavCounts } from '../../core/services/nav-counts.service';
import { screenMocks } from '../../testing/screen-mocks';
import { MessageLogsComponent, logActions, statusTone } from './message-logs.component';
import { MessagingSettingsComponent, whatsappTone } from './messaging-settings.component';
import { TemplatesComponent, insertAt, unknownPlaceholders } from './templates.component';
import { WhatsappInboxComponent } from './whatsapp-inbox.component';

const log = (over: Partial<MessageLog> = {}): MessageLog => ({
  id: 'm1', channel: 'WHATSAPP', purpose: 'APPOINTMENT_REMINDER', status: 'SENT', recipient: '+212661000000', patientId: 'p1', subject: '', body: 'Bonjour', attempts: 1,
  lastError: '', scheduledFor: '', sentAt: '2026-10-06T17:00:00Z', createdAt: '2026-10-06T17:00:00Z', bodyPurged: false, ...over,
});

const template = (over: Partial<MessageTemplate> = {}): MessageTemplate => ({
  purpose: 'APPOINTMENT_REMINDER', channel: 'WHATSAPP', language: 'fr', subject: 'Rappel', body: 'Bonjour {{patientName}}, rendez-vous le {{date}}.', active: true, customised: false, ...over,
});

describe('communication helpers', () => {
  it('offers retry for a failure and cancel for what still waits, nothing for the rest', () => {
    expect(logActions({ status: 'FAILED' })).toEqual({ retry: true, cancel: false });
    expect(logActions({ status: 'QUEUED' })).toEqual({ retry: false, cancel: true });
    expect(logActions({ status: 'SENT' })).toEqual({ retry: false, cancel: false });
    expect(logActions({ status: 'DELIVERED' })).toEqual({ retry: false, cancel: false });
  });

  it('colours a failure as a problem and delivery as settled', () => {
    expect(statusTone('FAILED')).toBe('pill-critical');
    expect(statusTone('DELIVERED')).toBe('pill-done');
    expect(statusTone('READ')).toBe('pill-done');
    expect(statusTone('QUEUED')).toBe('pill-attention');
    expect(statusTone('CANCELLED')).toBe('pill-idle');
  });

  it('inserts a placeholder over the selection and puts the caret after it', () => {
    expect(insertAt('Bonjour , voilà', 8, 8, '{{patientName}}')).toEqual({ value: 'Bonjour {{patientName}}, voilà', caret: 23 });
    expect(insertAt('abcdef', 2, 4, 'X')).toEqual({ value: 'abXef', caret: 3 });
    expect(insertAt('abc', 99, 99, 'Z')).toEqual({ value: 'abcZ', caret: 4 });
  });

  it('spots placeholders the server would leave as typed', () => {
    expect(unknownPlaceholders('Bonjour {{patientName}} le {{ date }}')).toEqual([]);
    expect(unknownPlaceholders('{{patientNmae}} {{patientName}} {{ clinic }}')).toEqual(['patientNmae', 'clinic']);
  });

  it('reads the WhatsApp state the bridge reports', () => {
    expect(whatsappTone({ enabled: false, sessionState: 'open' })).toBe('off');
    expect(whatsappTone({ enabled: true, sessionState: 'open' })).toBe('good');
    expect(whatsappTone({ enabled: true, sessionState: 'unreachable' })).toBe('bad');
    expect(whatsappTone({ enabled: true, sessionState: null as unknown as string })).toBe('bad');
    expect(whatsappTone({ enabled: true, sessionState: 'connecting' })).toBe('wait');
  });
});

describe('communication screens', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;
  let mocks: ReturnType<typeof screenMocks>;
  let confirmAnswer = true;
  let refreshInbox: ReturnType<typeof vi.fn>;

  const setup = (component: unknown, can: Parameters<typeof screenMocks>[0] = {}) => {
    mocks = screenMocks(can);
    refreshInbox = vi.fn(async () => undefined);
    TestBed.configureTestingModule({
      imports: [component as never, TranslateModule.forRoot()],
      providers: [
        provideRouter([]),
        { provide: MessagingApi, useValue: api },
        { provide: NavCounts, useValue: { refreshInbox, inbox: signal(0) } },
        { provide: ConfirmDialogService, useValue: { confirm: async () => confirmAnswer } },
        { provide: LanguageService, useValue: { currentLang: () => 'fr' } },
        ...mocks.providers,
      ],
    });
  };
  const mount = async <T>(type: new () => T) => {
    const fixture = TestBed.createComponent(type);
    document.body.appendChild(fixture.nativeElement);
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
    }
    fixture.detectChanges();
    return fixture;
  };
  const settleUi = async (fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) => {
    for (let i = 0; i < 2; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
    }
    fixture.detectChanges();
  };
  const buttonWith = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.includes(text)) as HTMLButtonElement | undefined;

  beforeEach(() => {
    document.body.innerHTML = '';
    confirmAnswer = true;
    api = {};
  });

  describe('message history', () => {
    beforeEach(() => {
      api['logs'] = vi.fn(async () => ({ content: [log(), log({ id: 'm2', status: 'FAILED', lastError: 'bridge down', attempts: 3 }), log({ id: 'm3', status: 'QUEUED' })], totalElements: 3, totalPages: 1, number: 0, size: 25 }));
      api['retry'] = vi.fn(async () => log());
      api['cancel'] = vi.fn(async () => log());
      setup(MessageLogsComponent);
    });

    it('shows the error and attempts of a failed message', async () => {
      await mount(MessageLogsComponent);
      const text = document.body.textContent!;
      expect(text).toContain('bridge down');
      expect(text).toContain('COM.LOGS.ATTEMPTS');
    });

    it('retries a failed message and withdraws a queued one, then reloads', async () => {
      const fixture = await mount(MessageLogsComponent);
      buttonWith('COM.LOGS.RETRY')!.click();
      await settleUi(fixture);
      expect(api['retry']).toHaveBeenCalledWith('m2');
      [...document.querySelectorAll('tbody button')].find(b => b.textContent?.includes('COMMON.CANCEL'))!.dispatchEvent(new Event('click'));
      await settleUi(fixture);
      expect(api['cancel']).toHaveBeenCalledWith('m3');
      expect(api['logs'].mock.calls.length).toBeGreaterThanOrEqual(3);
    });

    it('goes back to the first page when a filter changes', async () => {
      const fixture = await mount(MessageLogsComponent);
      const select = document.querySelectorAll('select')[0] as HTMLSelectElement;
      select.value = 'EMAIL';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await settleUi(fixture);
      expect(api['logs']).toHaveBeenLastCalledWith({ channel: 'EMAIL', status: '', page: 0, size: 25 });
    });
  });

  describe('WhatsApp replies', () => {
    const reply = (over: Partial<InboxMessage> = {}): InboxMessage => ({ id: 'r1', fromPhone: '+212661000000', body: 'Je voudrais décaler', patientId: 'p1', patientName: 'Sara Alami', occurredAt: '2026-10-06T10:00:00Z', handledAt: '', ...over });

    beforeEach(() => {
      api['inbox'] = vi.fn(async () => [reply(), reply({ id: 'r2', patientId: '', patientName: '', body: 'Bonjour ?' })]);
      api['markHandled'] = vi.fn(async () => undefined);
      setup(WhatsappInboxComponent);
    });

    it('asks only for replies still to deal with, and names an unknown sender as such', async () => {
      await mount(WhatsappInboxComponent);
      expect(api['inbox']).toHaveBeenCalledWith(true);
      expect(document.body.textContent).toContain('COM.INBOX.UNKNOWN');
    });

    it('marks a reply handled and refreshes the counter', async () => {
      const fixture = await mount(WhatsappInboxComponent);
      buttonWith('COM.INBOX.MARK_HANDLED')!.click();
      await settleUi(fixture);
      expect(api['markHandled']).toHaveBeenCalledWith('r1');
      expect(refreshInbox).toHaveBeenCalled();
    });
  });

  describe('templates', () => {
    beforeEach(() => {
      api['templates'] = vi.fn(async () => [template(), template({ purpose: 'RECALL', customised: true, body: 'Revenez nous voir' }), template({ language: 'en' })]);
      api['previewTemplate'] = vi.fn(async (r: { body: string }) => ({ subject: 'Rappel', body: r.body.replace('{{patientName}}', 'Sara') }));
      api['saveTemplate'] = vi.fn(async () => template());
      api['resetTemplate'] = vi.fn(async () => undefined);
    });

    it('lists the templates of the interface language by default', async () => {
      setup(TemplatesComponent);
      await mount(TemplatesComponent);
      expect(document.querySelectorAll('tbody tr').length).toBe(2);
      expect(document.body.textContent).toContain('COM.TPL.CUSTOMISED');
    });

    it('opens a template with a live preview and saves the edited text', async () => {
      vi.useFakeTimers();
      try {
        setup(TemplatesComponent);
        const fixture = await mount(TemplatesComponent);
        (document.querySelector('tbody button') as HTMLButtonElement).click();
        await settleUi(fixture);
        const body = document.querySelector('textarea[name=body]') as HTMLTextAreaElement;
        body.value = 'Bonjour {{patientName}}, à demain';
        body.dispatchEvent(new Event('input', { bubbles: true }));
        await settleUi(fixture);
        await vi.advanceTimersByTimeAsync(300);
        await settleUi(fixture);
        expect(api['previewTemplate']).toHaveBeenLastCalledWith(expect.objectContaining({ body: 'Bonjour {{patientName}}, à demain', channel: 'WHATSAPP', language: 'fr' }));
        expect(document.querySelector('[role=dialog]')!.textContent).toContain('Bonjour Sara, à demain');

        (document.querySelector('#tpl-form') as HTMLFormElement).dispatchEvent(new Event('submit'));
        await settleUi(fixture);
        expect(api['saveTemplate']).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'APPOINTMENT_REMINDER', body: 'Bonjour {{patientName}}, à demain', active: true }));
      } finally {
        vi.useRealTimers();
      }
    });

    it('warns about a mistyped placeholder', async () => {
      setup(TemplatesComponent);
      const fixture = await mount(TemplatesComponent);
      (document.querySelector('tbody button') as HTMLButtonElement).click();
      await settleUi(fixture);
      const body = document.querySelector('textarea[name=body]') as HTMLTextAreaElement;
      body.value = 'Bonjour {{patientNmae}}';
      body.dispatchEvent(new Event('input', { bubbles: true }));
      await settleUi(fixture);
      expect(document.querySelector('[role=alert]')!.textContent).toContain('COM.TPL.UNKNOWN');
    });

    it('goes back to the original text only after confirmation', async () => {
      confirmAnswer = false;
      setup(TemplatesComponent);
      const fixture = await mount(TemplatesComponent);
      const customised = [...document.querySelectorAll('tbody tr')].find(r => r.textContent?.includes('COM.TPL.CUSTOMISED'))!;
      (customised.querySelector('button') as HTMLButtonElement).click();
      await settleUi(fixture);
      buttonWith('COM.TPL.RESET')!.click();
      await settleUi(fixture);
      expect(api['resetTemplate']).not.toHaveBeenCalled();
      confirmAnswer = true;
      buttonWith('COM.TPL.RESET')!.click();
      await settleUi(fixture);
      expect(api['resetTemplate']).toHaveBeenCalledWith('RECALL', 'WHATSAPP', 'fr');
    });

    it('is read-only for someone who may not change settings', async () => {
      setup(TemplatesComponent, { can: ['MESSAGING_VIEW'] });
      const fixture = await mount(TemplatesComponent);
      (document.querySelector('tbody button') as HTMLButtonElement).click();
      await settleUi(fixture);
      expect((document.querySelector('textarea[name=body]') as HTMLTextAreaElement).disabled).toBe(true);
      expect(document.querySelector('button[form=tpl-form]')).toBeNull();
    });
  });

  describe('settings', () => {
    beforeEach(() => {
      api['whatsappStatus'] = vi.fn(async () => ({ enabled: true, sessionState: 'open', lastReportedState: 'open', lastReportedAt: '2026-10-06T09:00:00Z', unhandledReplies: 2 }));
      api['settings'] = vi.fn(async () => ({ appointmentReminders: false, reminderSendHour: 17, instalmentReminders: false, instalmentDaysBefore: 2, surveyEnabled: false, surveyDelayHours: 3 }));
      api['saveSettings'] = vi.fn(async (s: unknown) => s);
      api['sendTest'] = vi.fn(async () => ({}));
    });

    it('shows the connection as healthy', async () => {
      setup(MessagingSettingsComponent);
      await mount(MessagingSettingsComponent);
      expect(document.body.textContent).toContain('COM.SET.STATE.good');
    });

    it('saves only when something changed, and sends the whole settings', async () => {
      setup(MessagingSettingsComponent);
      const fixture = await mount(MessagingSettingsComponent);
      const save = () => [...document.querySelectorAll('button[type=submit]')].find(b => b.textContent?.includes('COMMON.SAVE')) as HTMLButtonElement;
      expect(save().disabled).toBe(true);
      (document.querySelector('input[name=appt]') as HTMLInputElement).click();
      await settleUi(fixture);
      expect(save().disabled).toBe(false);
      save().click();
      await settleUi(fixture);
      expect(api['saveSettings']).toHaveBeenCalledWith({ appointmentReminders: true, reminderSendHour: 17, instalmentReminders: false, instalmentDaysBefore: 2, surveyEnabled: false, surveyDelayHours: 3 });
      expect(save().disabled).toBe(true);
    });

    it('sends a test message to the number typed', async () => {
      setup(MessagingSettingsComponent);
      const fixture = await mount(MessagingSettingsComponent);
      const input = document.querySelector('input[name=recipient]') as HTMLInputElement;
      input.value = '+212661000000';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await settleUi(fixture);
      buttonWith('COM.SET.SEND_TEST')!.click();
      await settleUi(fixture);
      expect(api['sendTest']).toHaveBeenCalledWith('WHATSAPP', '+212661000000');
    });

    it('lets someone without the settings permission read but not change', async () => {
      setup(MessagingSettingsComponent, { can: ['MESSAGING_VIEW'] });
      await mount(MessagingSettingsComponent);
      // disabled through the fieldset around the form, which the :disabled selector sees and the element's own property does not
      expect((document.querySelector('input[name=appt]') as HTMLInputElement).matches(':disabled')).toBe(true);
      expect(buttonWith('COM.SET.SEND_TEST')).toBeUndefined();
    });
  });
});
