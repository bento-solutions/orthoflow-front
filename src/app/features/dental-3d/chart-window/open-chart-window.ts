import { Router } from '@angular/router';

/** Where the 3D chart's own window lives: outside the app's frame, with nothing but the chart. */
export function chartWindowPath(patientId: string): string {
  return `/chart-window/${encodeURIComponent(patientId)}`;
}

/**
 * Opens the patient's 3D chart in a window of its own, as large as the screen, which the doctor
 * can drag to a second screen. One window per patient: asking again brings the same one forward.
 * Where the browser refuses a new window, the chart opens in this tab instead.
 */
export function openChartWindow(patientId: string, router: Router, win: Window = window): void {
  const path = chartWindowPath(patientId);
  const width = Math.max(1024, win.screen?.availWidth ?? 1440);
  const height = Math.max(700, win.screen?.availHeight ?? 900);
  const opened = win.open(path, `orthoflow-chart-${patientId}`, `popup=yes,width=${width},height=${height},left=0,top=0`);
  if (opened) {
    opened.focus();
  } else {
    void router.navigateByUrl(path);
  }
}
