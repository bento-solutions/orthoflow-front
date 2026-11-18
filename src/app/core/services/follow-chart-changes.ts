import { inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ChartSyncService } from './chart-sync.service';
import { ClinicalRecordService } from './clinical-record.service';
import { DentalChartService } from './dental-chart.service';

/**
 * Reloads what another window changed on this patient's chart, for as long as the calling
 * component lives: the patient file follows the 3D chart's window, and the window follows the
 * patient file. Treatments are each screen's own list, so the caller says how to reload them.
 * Call from a constructor or field initialiser.
 */
export function followChartChanges(patientId: () => string | null | undefined, reloadTreatments: (patientId: string) => void): void {
  const charts = inject(DentalChartService);
  const records = inject(ClinicalRecordService);
  inject(ChartSyncService)
    .changes(patientId)
    .pipe(takeUntilDestroyed())
    .subscribe((what) => {
      const id = patientId();
      if (!id) return;
      switch (what) {
        case 'chart':
          charts.reloadChart(id);
          break;
        case 'findings':
          // A tooth's painted state is worked out on the server from its findings.
          records.refresh(id);
          charts.reloadChart(id);
          break;
        case 'gums':
          records.loadPeriodontal(id);
          break;
        case 'treatments':
          reloadTreatments(id);
          break;
      }
    });
}
