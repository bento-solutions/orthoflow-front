import { describe, expect, it, vi } from 'vitest';
import { Router } from '@angular/router';
import { chartWindowPath, openChartWindow } from './open-chart-window';

describe('openChartWindow', () => {
  const router = () => ({ navigateByUrl: vi.fn(async () => true) }) as unknown as Router & { navigateByUrl: ReturnType<typeof vi.fn> };

  it('opens one window per patient, as large as the screen, and brings it forward', () => {
    const opened = { focus: vi.fn() };
    const win = { open: vi.fn(() => opened), screen: { availWidth: 1920, availHeight: 1040 } } as unknown as Window;
    const r = router();

    openChartWindow('p 1', r, win);

    expect(win.open).toHaveBeenCalledWith('/chart-window/p%201', 'orthoflow-chart-p 1', 'popup=yes,width=1920,height=1040,left=0,top=0');
    expect(opened.focus).toHaveBeenCalled();
    expect(r.navigateByUrl).not.toHaveBeenCalled();
  });

  it('opens the chart in this tab when the browser refuses a new window', () => {
    const win = { open: vi.fn(() => null), screen: { availWidth: 800, availHeight: 600 } } as unknown as Window;
    const r = router();

    openChartWindow('p1', r, win);

    expect(win.open).toHaveBeenCalledWith('/chart-window/p1', 'orthoflow-chart-p1', 'popup=yes,width=1024,height=700,left=0,top=0');
    expect(r.navigateByUrl).toHaveBeenCalledWith(chartWindowPath('p1'));
  });
});
