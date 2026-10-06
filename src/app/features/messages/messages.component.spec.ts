import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NavCounts } from '../../core/services/nav-counts.service';
import { OperationsApi, ThreadDetail, ThreadRow } from '../../core/services/operations-api.service';
import { screenMocks } from '../../testing/screen-mocks';
import { MessagesComponent } from './messages.component';

const row = (over: Partial<ThreadRow> = {}): ThreadRow => ({ id: 't1', subject: 'Stock de gants', lastMessageAt: '2026-10-06T09:00:00Z', lastSender: 'Salma', preview: 'Il en reste peu', unread: 2, participants: ['Salma', 'Dr Tazi'], ...over });
const detail = (over: Partial<ThreadDetail> = {}): ThreadDetail => ({
  id: 't1', subject: 'Stock de gants', participants: [{ id: 'u1', name: 'Salma', role: 'ASSISTANT' }, { id: 'u2', name: 'Dr Tazi', role: 'DOCTOR' }],
  messages: [{ id: 'm1', senderId: 'u1', senderName: 'Salma', body: 'Il en reste peu', createdAt: '2026-10-06T09:00:00Z', mine: false }], ...over,
});

describe('MessagesComponent', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;
  let mocks: ReturnType<typeof screenMocks>;
  let refreshMessages: ReturnType<typeof vi.fn>;

  const mount = async () => {
    mocks = screenMocks();
    refreshMessages = vi.fn(async () => undefined);
    TestBed.configureTestingModule({
      imports: [MessagesComponent, TranslateModule.forRoot()],
      providers: [{ provide: OperationsApi, useValue: api }, { provide: NavCounts, useValue: { refreshMessages } }, ...mocks.providers],
    });
    const fixture = TestBed.createComponent(MessagesComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  };
  const settleUi = async (fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    api = {
      threads: vi.fn(async () => [row()]),
      thread: vi.fn(async () => detail()),
      recipients: vi.fn(async () => [{ id: 'u1', name: 'Salma', role: 'ASSISTANT' }, { id: 'u2', name: 'Dr Tazi', role: 'DOCTOR' }]),
      reply: vi.fn(async () => detail({ messages: [...detail().messages, { id: 'm2', senderId: 'me', senderName: 'Moi', body: 'Je commande', createdAt: '2026-10-06T09:05:00Z', mine: true }] })),
      newThread: vi.fn(async () => detail({ id: 't2', subject: 'Nouveau' })),
    };
  });

  it('lists the threads with their unread count', async () => {
    await mount();
    expect(document.body.textContent).toContain('Stock de gants');
    expect(document.body.textContent).toContain('Il en reste peu');
  });

  it('opens a thread, which reads it, and refreshes the unread counts', async () => {
    const fixture = await mount();
    (document.querySelector('ul button') as HTMLButtonElement).click();
    await settleUi(fixture);
    expect(api['thread']).toHaveBeenCalledWith('t1');
    expect(refreshMessages).toHaveBeenCalled();
    expect(document.querySelector('ol')!.textContent).toContain('Il en reste peu');
  });

  it('sends a reply and clears the box', async () => {
    const fixture = await mount();
    (document.querySelector('ul button') as HTMLButtonElement).click();
    await settleUi(fixture);
    const box = document.querySelector('textarea[name=reply]') as HTMLTextAreaElement;
    box.value = 'Je commande';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    await settleUi(fixture);
    (document.querySelector('form button[type=submit]') as HTMLButtonElement).click();
    await settleUi(fixture);
    expect(api['reply']).toHaveBeenCalledWith('t1', 'Je commande');
    expect((document.querySelector('textarea[name=reply]') as HTMLTextAreaElement).value).toBe('');
  });

  it('starts a conversation with the people ticked', async () => {
    const fixture = await mount();
    [...document.querySelectorAll('button')].find(b => b.textContent?.includes('MSG.NEW'))!.click();
    await settleUi(fixture);
    (document.querySelectorAll('[role=dialog] input[type=checkbox]')[1] as HTMLInputElement).click();
    for (const [name, value] of [['subject', 'Nouveau'], ['body', 'Bonjour']]) {
      const el = document.querySelector(`[name=${name}]`) as HTMLInputElement;
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await settleUi(fixture);
    (document.querySelector('#msg-form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settleUi(fixture);
    expect(api['newThread']).toHaveBeenCalledWith({ subject: 'Nouveau', recipientIds: ['u2'], body: 'Bonjour' });
  });

  it('cannot send to nobody', async () => {
    const fixture = await mount();
    [...document.querySelectorAll('button')].find(b => b.textContent?.includes('MSG.NEW'))!.click();
    await settleUi(fixture);
    const submit = document.querySelector('button[form=msg-form]') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });
});
