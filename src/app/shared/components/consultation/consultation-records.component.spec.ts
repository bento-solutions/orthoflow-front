import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConsultationApiService } from '../../../core/consultation/consultation-api.service';
import { ConsultationDto } from '../../../core/consultation/consultation.model';
import { ConsultationService } from '../../../core/consultation/consultation.service';
import { ConfirmDialogService } from '../../../core/services/confirm-dialog.service';
import { ToastService } from '../../../core/services/toast.service';
import { audioOffsetSeconds } from './consultation-audio-player.component';
import { ConsultationRecordsComponent, consultationMinutes } from './consultation-records.component';

const base: ConsultationDto = {
  id: 'c-1', patientId: 'p-1', actorId: 'u-1', voiceSessionId: null, status: 'COMPLETED', locale: 'fr-MA', mode: 'DEFERRED',
  patientInformedAt: '', transcript: null, draft: null, reviewed: null, report: null, appointmentId: null,
  startedAt: '2026-11-13T10:00:00Z', examinationStartedAt: null, endedAt: '2026-11-13T10:12:00Z', completedAt: null,
};

describe('where a line is in the recording', () => {
  it('is its time since the recording began, a little before, never before the start', () => {
    const start = Date.parse('2026-11-13T10:00:00Z');
    expect(audioOffsetSeconds(start + 754_000, start)).toBe(750);
    expect(audioOffsetSeconds(start + 1_000, start)).toBe(0);
  });

  it('a consultation lasts as long as its recording, or else from start to end', () => {
    expect(consultationMinutes({ ...base, audio: { fileId: 'f', contentType: 'audio/webm', sizeBytes: 1, startedAt: null, durationMs: 754_000 } })).toBe(13);
    expect(consultationMinutes(base)).toBe(12);
    expect(consultationMinutes({ ...base, endedAt: null })).toBeNull();
  });
});

describe('ConsultationRecordsComponent', () => {
  let fixture: ComponentFixture<ConsultationRecordsComponent>;
  let element: HTMLElement;
  let list: ConsultationDto[];
  let available: ReturnType<typeof signal<boolean>>;

  beforeEach(async () => {
    available = signal(true);
    list = [
      { ...base, audio: { fileId: 'f-1', contentType: 'audio/webm', sizeBytes: 1000, startedAt: base.startedAt, durationMs: 720_000 } },
      { ...base, id: 'c-2', status: 'REVIEW', mode: 'LIVE', audio: null },
      { ...base, id: 'c-3', status: 'EXAMINATION' },
    ];
    TestBed.configureTestingModule({
      imports: [ConsultationRecordsComponent, TranslateModule.forRoot()],
      providers: [
        { provide: ConsultationService, useValue: { available, loadConfig: async () => undefined, savedVersion: () => 0 } },
        { provide: ConsultationApiService, useValue: { list: () => of(list), audio: () => of(new Blob()), deleteAudio: () => of(base), log: () => of(null) } },
        { provide: ConfirmDialogService, useValue: { confirm: async () => true } },
        { provide: ToastService, useValue: { error: () => undefined } },
      ],
    });
    fixture = TestBed.createComponent(ConsultationRecordsComponent);
    fixture.componentRef.setInput('patientId', 'p-1');
    element = fixture.nativeElement;
    fixture.detectChanges();
    await settle();
  });

  async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  afterEach(() => fixture.destroy());

  it('lists the saved consultations and the ones to validate, each with its transcript, and its audio when kept', () => {
    const rows = [...element.querySelectorAll('[data-consultation]')];
    expect(rows.map(row => row.getAttribute('data-consultation'))).toEqual(['c-1', 'c-2']);
    expect(rows[0].querySelector('app-consultation-audio-player')).not.toBeNull();
    expect(rows[1].querySelector('app-consultation-audio-player')).toBeNull();
    expect(rows[1].textContent).toContain('CONSULTATION.DOCS_NO_AUDIO');
    expect(rows.every(row => row.querySelector('[data-open-log]'))).toBe(true);
    expect(rows[0].textContent).toContain('12 min');
  });

  it('removes the audio and keeps the consultation', async () => {
    const remove = [...element.querySelectorAll('[data-consultation="c-1"] button')].find(b => b.textContent?.includes('DOCS_DELETE_AUDIO')) as HTMLButtonElement;
    remove.click();
    await settle();
    expect(element.querySelector('[data-consultation="c-1"] app-consultation-audio-player')).toBeNull();
    expect(element.querySelector('[data-consultation="c-1"]')).not.toBeNull();
  });

  it('shows nothing to whoever may not open consultations', async () => {
    available.set(false);
    fixture.detectChanges();
    expect(element.querySelector('[data-consultation-records]')).toBeNull();
  });
});
