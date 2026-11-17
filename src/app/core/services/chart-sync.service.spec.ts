import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { ChartSyncService } from './chart-sync.service';

const CHANNEL = 'orthoflow-patient-chart';
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('ChartSyncService', () => {
  const others: BroadcastChannel[] = [];
  const otherWindow = () => {
    const channel = new BroadcastChannel(CHANNEL);
    others.push(channel);
    return channel;
  };

  afterEach(() => {
    others.splice(0).forEach((c) => c.close());
    TestBed.resetTestingModule();
  });

  it('tells the other windows which patient changed and what, and nothing else', async () => {
    const service = TestBed.inject(ChartSyncService);
    const heard: unknown[] = [];
    otherWindow().onmessage = (event) => heard.push(event.data);

    service.announce('p1', 'findings');
    await settle();

    expect(heard).toEqual([{ patientId: 'p1', what: 'findings' }]);
  });

  it('passes on what another window changed on this patient only', async () => {
    const service = TestBed.inject(ChartSyncService);
    let current = 'p1';
    const seen: string[] = [];
    const sub = service.changes(() => current).subscribe((what) => seen.push(what));
    const other = otherWindow();

    other.postMessage({ patientId: 'p1', what: 'treatments' });
    other.postMessage({ patientId: 'p2', what: 'chart' });
    other.postMessage({ nonsense: true });
    await settle();
    current = 'p2';
    other.postMessage({ patientId: 'p2', what: 'gums' });
    await settle();

    expect(seen).toEqual(['treatments', 'gums']);
    sub.unsubscribe();
  });
});
