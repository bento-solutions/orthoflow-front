import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslateModule } from '@ngx-translate/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClinicalRecordService } from '../../../core/services/clinical-record.service';
import { ConfirmDialogService } from '../../../core/services/confirm-dialog.service';
import { PatientService } from '../../../core/services/patient.service';
import { PatientTreatmentService } from '../../../core/services/patient-treatment.service';
import { ScheduleService } from '../../../core/services/schedule.service';
import { ToastService } from '../../../core/services/toast.service';
import { SessionBufferService } from '../../../core/voice/session-buffer.service';
import { BufferedEntry, VoiceOrchestratorService } from '../../../core/voice/voice-orchestrator.service';
import { VoiceSessionService } from '../../../core/voice/voice-session.service';
import { InvoiceService } from '../../billing/services/invoice.service';
import { SessionReviewComponent } from './session-review.component';

/**
 * The page where a dictated examination becomes part of the record. What
 * matters here is that Save sends exactly what the dentist left ticked, that a
 * corrected tooth is saved as a correction and described as one, and that a
 * failure leaves the consultation open instead of looking saved.
 */

const entry = (auditId: string, fdi: string, code = 'caries'): BufferedEntry => ({
  auditId,
  intent: 'clinical.addFindings',
  entities: { fdi, findings: [{ code }] },
  preview: `Dent ${fdi} : ${code}`,
  transcript: `dent ${fdi} ${code}`,
  corrections: [],
  at: Date.now(),
});

const note = (auditId: string): BufferedEntry => ({
  auditId, intent: 'clinical.addNote', entities: { content: 'Patient anxieux' },
  preview: 'Note : patient anxieux', transcript: 'note patient anxieux', corrections: [], at: Date.now(),
});

type CommitResult = {
  ok: boolean; executed: number; notReviewed: number; failed: { auditId: string; errorMessage: string }[];
};

describe('SessionReviewComponent', () => {
  let fixture: ComponentFixture<SessionReviewComponent>;
  let component: SessionReviewComponent;
  let commit: ReturnType<typeof vi.fn>;
  let generateNarrative: ReturnType<typeof vi.fn>;
  let abandon: ReturnType<typeof vi.fn>;
  let toasts: { kind: string; message: string }[];
  let confirmAnswer: boolean;
  let entries: BufferedEntry[];
  let finished: string[];

  beforeEach(async () => {
    vi.useFakeTimers();
    entries = [entry('a-1', '16'), entry('a-2', '26', 'fracture'), note('a-3')];
    toasts = [];
    finished = [];
    confirmAnswer = true;
    commit = vi.fn(async (): Promise<CommitResult> => ({ ok: true, executed: 2, notReviewed: 0, failed: [] }));
    generateNarrative = vi.fn(async () => undefined);
    abandon = vi.fn(async () => undefined);

    TestBed.configureTestingModule({
      imports: [SessionReviewComponent, TranslateModule.forRoot()],
      providers: [
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => null } } } },
        { provide: Router, useValue: { navigate: vi.fn(async () => true) } },
        {
          provide: VoiceSessionService,
          useValue: {
            commit,
            generateNarrative,
            abandon,
            session: () => ({ id: 's-1' }),
            narrative: signal('Compte rendu'),
            narrativeError: signal(null),
            narrativeGenerated: signal(true),
          },
        },
        { provide: VoiceOrchestratorService, useValue: { buffered: () => entries, resetBuffer: vi.fn() } },
        { provide: SessionBufferService, useValue: { get: async () => null, clear: vi.fn(async () => undefined) } },
        {
          provide: ToastService,
          useValue: {
            success: (message: string) => toasts.push({ kind: 'success', message }),
            error: (message: string) => toasts.push({ kind: 'error', message }),
            info: (message: string) => toasts.push({ kind: 'info', message }),
          },
        },
        { provide: ConfirmDialogService, useValue: { confirm: async () => confirmAnswer } },
        { provide: PatientService, useValue: { currentPatient: signal(null), setCurrentPatient: () => ({ subscribe: () => undefined }) } },
        { provide: ScheduleService, useValue: { appointments: signal([]) } },
        { provide: PatientTreatmentService, useValue: {} },
        { provide: ClinicalRecordService, useValue: { allergies: signal([]), refresh: vi.fn() } },
        { provide: InvoiceService, useValue: {} },
      ],
    });

    fixture = TestBed.createComponent(SessionReviewComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('sessionId', 's-1');
    fixture.componentRef.setInput('patientId', 'p-1');
    fixture.componentRef.setInput('embedded', true);
    component.finished.subscribe(outcome => finished.push(outcome));
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    fixture.detectChanges();
  });

  afterEach(() => vi.useRealTimers());

  const commitArgs = () => commit.mock.calls.at(-1) as [string, string[], string[], string, unknown[]];

  // ── Save sends what was left ticked ─────────────────────────────────

  it('approves what is ticked and rejects what was unticked', async () => {
    component.toggle('a-2');

    await component.save();

    const [sessionId, approved, rejected, summary, amendments] = commitArgs();
    expect(sessionId).toBe('s-1');
    expect(approved).toEqual(['a-1', 'a-3']);
    expect(rejected).toEqual(['a-2']);
    expect(summary).toBe('Compte rendu');
    expect(amendments).toEqual([]);
  });

  it('ignores a second tap on Save while the first is still saving', async () => {
    let release!: (value: CommitResult) => void;
    commit.mockImplementationOnce(() => new Promise<CommitResult>(resolve => { release = resolve; }));

    const first = component.save();
    const second = component.save();
    release({ ok: true, executed: 3, notReviewed: 0, failed: [] });
    await Promise.all([first, second]);

    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('closes the page and says the consultation is saved once the server has it', async () => {
    await component.save();

    expect(finished).toEqual(['saved']);
    expect(toasts.at(-1)).toEqual({ kind: 'success', message: 'VOICE.REVIEW_SAVED_N' });
  });

  it('does not make a second Save sound as though it lost something', async () => {
    commit.mockResolvedValueOnce({ ok: true, executed: 0, notReviewed: 0, failed: [] });

    await component.save();

    expect(toasts.at(-1)?.message).toBe('VOICE.REVIEW_SAVED');
  });

  it('cannot be saved when nothing was dictated', () => {
    entries = [];
    const empty = TestBed.createComponent(SessionReviewComponent);
    empty.componentRef.setInput('sessionId', 's-1');
    empty.componentRef.setInput('embedded', true);
    empty.detectChanges();

    const save = empty.nativeElement.querySelector('.header-actions .btn-primary') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  // ── When it does not all go through ─────────────────────────────────

  it('stays open and names the failure instead of looking saved', async () => {
    commit.mockResolvedValueOnce({
      ok: false, executed: 1, notReviewed: 0,
      failed: [{ auditId: 'a-1', errorMessage: 'Finding code no longer accepted' }],
    });

    await component.save();
    fixture.detectChanges();

    expect(finished).toEqual([]);
    expect(component.failures()).toEqual([{ auditId: 'a-1', errorMessage: 'Finding code no longer accepted' }]);
    expect(toasts.at(-1)).toEqual({ kind: 'error', message: 'VOICE.REVIEW_PARTIAL' });
    expect(fixture.nativeElement.querySelector('.banner-error')?.textContent).toContain('Finding code no longer accepted');
  });

  it('retries a failed entry on the next Save, together with the rest', async () => {
    commit.mockResolvedValueOnce({
      ok: false, executed: 1, notReviewed: 0, failed: [{ auditId: 'a-1', errorMessage: 'x' }],
    });
    await component.save();

    await component.save();

    expect(commitArgs()[1]).toEqual(['a-1', 'a-2', 'a-3']);
  });

  it('tells the dentist about dictated items that were never on the list', async () => {
    commit.mockResolvedValueOnce({ ok: true, executed: 3, notReviewed: 2, failed: [] });

    await component.save();

    expect(toasts.map(t => t.message)).toContain('VOICE.REVIEW_NOT_REVIEWED');
  });

  it('says a 409 means the consultation is already being saved, not that the connection failed', async () => {
    commit.mockRejectedValueOnce({ status: 409 });

    await component.save();

    expect(toasts.at(-1)?.message).toBe('VOICE.REVIEW_ALREADY_SAVING');
    expect(finished).toEqual([]);
  });

  it('says nothing was saved when the request itself fails', async () => {
    commit.mockRejectedValueOnce({ status: 0 });

    await component.save();

    expect(toasts.at(-1)?.message).toBe('VOICE.REVIEW_NOT_SAVED');
  });

  // ── Correcting a tooth ──────────────────────────────────────────────

  it('saves a corrected tooth as a correction of the dictated entry, not as dictated', async () => {
    component.applyTooth(entries[0], '46');

    await component.save();

    const [, approved, rejected, , amendments] = commitArgs();
    expect(approved).toEqual(['a-2', 'a-3']);
    expect(rejected).toEqual([]);
    expect(amendments).toEqual([{
      originalAuditId: 'a-1',
      intent: 'clinical.addFindings',
      entities: JSON.stringify({ fdi: '46', findings: [{ code: 'caries' }] }),
    }]);
  });

  it('shows the corrected tooth in the teeth of this examination', () => {
    component.applyTooth(entries[0], '46');

    expect(component.includedTeeth()).toEqual(expect.arrayContaining(['46', '26']));
    expect(component.includedTeeth()).not.toContain('16');
    expect(component.stagedTeeth().map(tooth => tooth.fdi)).toEqual(['26', '46']);
  });

  it('refuses a tooth number that does not exist and keeps the dictated one', async () => {
    for (const bad of ['58', '49', '0', '', 'ab', '1']) {
      component.startEditing('a-1');
      component.applyTooth(entries[0], bad);
      expect(component.toothInvalid(), bad).toBe(true);
    }

    await component.save();

    expect(commitArgs()[4]).toEqual([]);
    expect(commitArgs()[1]).toContain('a-1');
  });

  it('puts the dictated tooth back when the correction is changed back', async () => {
    component.applyTooth(entries[0], '46');
    component.applyTooth(entries[0], '16');

    await component.save();

    expect(commitArgs()[4]).toEqual([]);
    expect(commitArgs()[1]).toContain('a-1');
  });

  it('does not send a correction for an entry that was then unticked', async () => {
    component.applyTooth(entries[0], '46');
    component.toggle('a-1');

    await component.save();

    const [, approved, rejected, , amendments] = commitArgs();
    expect(amendments).toEqual([]);
    expect(approved).toEqual(['a-2', 'a-3']);
    expect(rejected).toEqual(['a-1']);
  });

  it('offers a tooth correction only for findings, not for a note', () => {
    expect(component.canAmend(entries[0])).toBe(true);
    expect(component.canAmend(entries[2])).toBe(false);
  });

  it('retries a correction that failed by naming the replacement the server made', async () => {
    component.applyTooth(entries[0], '46');
    commit.mockResolvedValueOnce({
      ok: false, executed: 2, notReviewed: 0,
      // The replacement row, which the dentist never saw.
      failed: [{ auditId: 'replacement-1', errorMessage: 'Invalid FDI' }],
    });
    await component.save();

    await component.save();

    const [, approved, , , amendments] = commitArgs();
    expect(approved).toContain('replacement-1');
    expect(approved).not.toContain('a-1');
    // Sent again; the server recognises the original as already handled.
    expect(amendments).toHaveLength(1);
  });

  it('lets the dentist remove a failure that has no entry to untick', async () => {
    commit.mockResolvedValueOnce({
      ok: false, executed: 1, notReviewed: 0,
      failed: [{ auditId: 'replacement-1', errorMessage: 'Invalid FDI' }, { auditId: 'a-1', errorMessage: 'x' }],
    });
    await component.save();
    fixture.detectChanges();

    // The replacement was never shown as an entry; the entry itself was.
    expect(component.isUnseen('replacement-1')).toBe(true);
    expect(component.isUnseen('a-1')).toBe(false);
    expect(fixture.nativeElement.querySelectorAll('.banner-error .link-btn')).toHaveLength(1);

    component.dismissOutstanding('replacement-1');
    await component.save();

    const [, approved, rejected] = commitArgs();
    expect(rejected).toContain('replacement-1');
    expect(approved).not.toContain('replacement-1');
    expect(component.failures().map(f => f.auditId)).not.toContain('replacement-1');
  });

  it('describes the corrected tooth in the narrative it regenerates', async () => {
    component.applyTooth(entries[0], '46');

    await vi.advanceTimersByTimeAsync(700);

    expect(generateNarrative).toHaveBeenLastCalledWith('s-1', ['a-1', 'a-2', 'a-3'], { 'a-1': '46' });
  });

  it('leaves a narrative the dentist has edited alone', async () => {
    component.narrativeEdited = true;

    component.applyTooth(entries[0], '46');
    await vi.advanceTimersByTimeAsync(700);

    expect(generateNarrative).not.toHaveBeenCalled();
  });

  it('never summarises everything when nothing is left included', async () => {
    component.toggle('a-1');
    component.toggle('a-2');
    component.toggle('a-3');

    await vi.advanceTimersByTimeAsync(700);

    expect(generateNarrative).not.toHaveBeenCalled();
    expect(component.narrativeText).toBe('');
  });

  it('lets the dentist correct a tooth from the page', async () => {
    const link = Array.from(fixture.nativeElement.querySelectorAll('.entry-amend .link-btn') as NodeListOf<HTMLButtonElement>)[0];
    link.click();
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('.tooth-edit input') as HTMLInputElement;
    input.value = '58';
    fixture.nativeElement.querySelector('.tooth-edit').dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.tooth-error')).not.toBeNull();

    input.value = '46';
    fixture.nativeElement.querySelector('.tooth-edit').dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.tooth-edit')).toBeNull();
    expect(fixture.nativeElement.querySelector('.chip-amended')).not.toBeNull();
  });

  // ── Throwing it all away ────────────────────────────────────────────

  it('abandons the examination only when the dentist confirms', async () => {
    confirmAnswer = false;
    await component.discardAll();
    expect(abandon).not.toHaveBeenCalled();
    expect(finished).toEqual([]);

    confirmAnswer = true;
    await component.discardAll();
    expect(abandon).toHaveBeenCalledTimes(1);
    expect(finished).toEqual(['discarded']);
  });
});
