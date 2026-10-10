import '@angular/compiler';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PeriodontalAssessment, PeriodontalStatus } from '../../../core/models/clinical-record.model';
import { ClinicalRecordService } from '../../../core/services/clinical-record.service';
import { expectNoA11yViolations } from '../../../testing/axe';
import { screenMocks } from '../../../testing/screen-mocks';
import { GumStatusComponent } from './gum-status.component';

const assessment = (over: Partial<PeriodontalAssessment>): PeriodontalAssessment => ({
  id: crypto.randomUUID(), region: 'WHOLE_MOUTH', condition: 'HEALTHY', assessedOn: '2026-10-01', source: 'manual',
  createdAt: '2026-10-01T09:00:00Z', ...over,
} as PeriodontalAssessment);

describe('GumStatusComponent', () => {
  let status: ReturnType<typeof signal<PeriodontalStatus | null>>;
  let records: { periodontal: typeof status; loadPeriodontal: ReturnType<typeof vi.fn>; recordPeriodontal: ReturnType<typeof vi.fn> };
  let mocks: ReturnType<typeof screenMocks>;

  const flush = async (fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) => {
    for (let i = 0; i < 2; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise(resolve => setTimeout(resolve));
    }
  };
  const mount = async () => {
    mocks = screenMocks();
    TestBed.configureTestingModule({
      imports: [GumStatusComponent, TranslateModule.forRoot()],
      providers: [{ provide: ClinicalRecordService, useValue: records }, ...mocks.providers],
    });
    const fixture = TestBed.createComponent(GumStatusComponent);
    fixture.componentRef.setInput('patientId', 'p1');
    document.body.appendChild(fixture.nativeElement);
    await flush(fixture);
    return fixture;
  };
  const tile = (region: string) => [...document.querySelectorAll('.tile')].find(t => t.textContent?.includes(`GUMS.REGION.${region}`)) as HTMLButtonElement;
  const radio = (condition: string) => document.querySelector(`[role=radio][data-state=${condition}]`) as HTMLButtonElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    status = signal<PeriodontalStatus | null>(null);
    records = { periodontal: status, loadPeriodontal: vi.fn(), recordPeriodontal: vi.fn(() => of({})) };
  });

  it('loads the patient’s gum status and says so for areas never assessed', async () => {
    await mount();

    expect(records.loadPeriodontal).toHaveBeenCalledWith('p1');
    expect(document.querySelectorAll('.tile')).toHaveLength(7);
    expect(document.body.textContent).toContain('GUMS.NOT_ASSESSED');
  });

  it('shows each area’s own state, not one state for the mouth', async () => {
    status.set({
      current: [
        assessment({ region: 'UPPER_FRONT', condition: 'HEALTHY' }),
        assessment({ region: 'LOWER_LEFT', condition: 'PERIODONTITIS', stage: 2 }),
      ],
      history: [],
    });
    await mount();

    expect(tile('UPPER_FRONT').dataset['state']).toBe('HEALTHY');
    expect(tile('LOWER_LEFT').dataset['state']).toBe('PERIODONTITIS');
    expect(tile('LOWER_LEFT').textContent).toContain('GUMS.STAGE_N');
    expect(tile('UPPER_LEFT').dataset['state']).toBe('NONE');
  });

  it('lists earlier assessments apart from the current ones', async () => {
    const old = assessment({ region: 'UPPER_FRONT', condition: 'GINGIVITIS', assessedOn: '2026-03-01' });
    const now = assessment({ region: 'UPPER_FRONT', condition: 'HEALTHY' });
    status.set({ current: [now], history: [now, old] });
    await mount();

    const history = [...document.querySelectorAll('.history li')];
    expect(history).toHaveLength(1);
    expect(history[0].getAttribute('data-state')).toBe('GINGIVITIS');
  });

  it('records an assessment for the tapped area', async () => {
    const fixture = await mount();

    tile('LOWER_FRONT').click();
    await flush(fixture);
    radio('GINGIVITIS').click();
    await flush(fixture);
    (document.querySelector('form button[type=submit]') as HTMLButtonElement).click();
    await flush(fixture);

    expect(records.recordPeriodontal).toHaveBeenCalledTimes(1);
    const [patientId, request] = records.recordPeriodontal.mock.calls[0];
    expect(patientId).toBe('p1');
    expect(request).toMatchObject({ region: 'LOWER_FRONT', condition: 'GINGIVITIS', source: 'manual' });
    expect(request.stage).toBeUndefined();
    expect(mocks.toasts.map(t => t.kind)).toEqual(['success']);
  });

  it('asks for a stage only for periodontitis, and drops it when the state changes', async () => {
    const fixture = await mount();

    expect(document.querySelector('select[name=stage]')).toBeNull();
    radio('PERIODONTITIS').click();
    await flush(fixture);
    expect(document.querySelector('select[name=stage]')).not.toBeNull();

    radio('HEALTHY').click();
    await flush(fixture);
    expect(document.querySelector('select[name=stage]')).toBeNull();
  });

  it('cannot save before a state is chosen', async () => {
    await mount();
    expect((document.querySelector('form button[type=submit]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('has no accessibility violations', async () => {
    await mount();
    await expectNoA11yViolations(document.body);
  });
});
