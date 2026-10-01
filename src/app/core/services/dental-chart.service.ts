import { Injectable, signal, inject } from '@angular/core';
import {
  DentalChartState,
  DentalChartType,
  ToothState,
  ToothStatus,
  ADULT_TEETH,
  CHILD_TEETH,
} from '../models/patient.model';
import { DentalChartApiService, ToothUpdateSource, DentalChartResponse } from './dental-chart-api.service';

/**
 * DentalChartService
 *
 * The dental chart is a clinical record, so the server (not the browser) is
 * the source of truth: every read goes through the backend and every write
 * is pushed there immediately. localStorage is kept only as a same-tab,
 * synchronous cache so the UI has something to paint before the network
 * round-trip resolves — never as the record of truth.
 */
@Injectable({
  providedIn: 'root',
})
export class DentalChartService {
  private api = inject(DentalChartApiService);

  // In-memory store keyed by patientId
  private chartStore = new Map<string, DentalChartState>();

  // Current chart being viewed/edited
  currentChart = signal<DentalChartState | null>(null);

  /**
   * Determine chart type based on patient age.
   * Children < 12 years → deciduous (child) chart
   * Adults ≥ 12 years → permanent (adult) chart
   */
  getChartTypeForAge(dateOfBirth: string | null | undefined): DentalChartType {
    // A patient registered by name alone has no date of birth yet. Say what the
    // chart is rather than leaving it to what `new Date(undefined)` happens to do.
    if (!dateOfBirth) return 'adult';
    const birthDate = new Date(dateOfBirth);
    if (Number.isNaN(birthDate.getTime())) return 'adult';
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age < 12 ? 'child' : 'adult';
  }

  /**
   * Initialize a fresh dental chart with all teeth set to "present".
   */
  createDefaultChart(patientId: string, chartType: DentalChartType): DentalChartState {
    const toothIds = chartType === 'adult' ? ADULT_TEETH : CHILD_TEETH;
    const teeth: Record<string, ToothState> = {};
    for (const id of toothIds) {
      teeth[id] = { id, status: 'present' };
    }
    return {
      patientId,
      chartType,
      teeth,
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Load a patient's dental chart. Returns an immediate best-effort chart
   * (local cache, else a default) so the UI has something to render, and
   * fetches the server's record in the background — the authoritative
   * source — updating `currentChart` when it resolves.
   */
  loadChart(patientId: string, dateOfBirth: string | null | undefined): DentalChartState {
    const chartType = this.getChartTypeForAge(dateOfBirth);
    let chart = this.chartStore.get(patientId);
    if (!chart) {
      const stored = localStorage.getItem(`dental_chart_${patientId}`);
      chart = stored ? this.deserialize(patientId, stored) : this.createDefaultChart(patientId, chartType);
      this.chartStore.set(patientId, chart);
    }
    this.currentChart.set(chart);

    this.api.getChart(patientId, chartType).subscribe({
      next: (response) => this.applyServerChart(patientId, response),
      error: (err) => console.error(`Failed to load dental chart for patient ${patientId}`, err),
    });

    return chart;
  }

  private applyServerChart(patientId: string, response: DentalChartResponse): void {
    const chart = this.createDefaultChart(patientId, response.chartType);
    for (const tooth of response.teeth) {
      chart.teeth[tooth.fdi] = { id: tooth.fdi, status: tooth.status, notes: tooth.notes };
    }
    chart.lastUpdated = response.updatedAt;
    this.chartStore.set(patientId, chart);
    this.currentChart.set({ ...chart });
    this.saveToLocalStorage(patientId, chart);
  }

  /**
   * Update a single tooth status. Applies optimistically so the UI responds
   * immediately, then pushes the write to the server. If the server write
   * fails, the local change stays (so the user's action isn't silently
   * discarded) but the failure is surfaced to the console — a full
   * offline-queue/retry is future work, this at minimum never pretends an
   * unsynced write succeeded.
   */
  updateToothStatus(
    patientId: string,
    toothId: string,
    status: ToothStatus,
    notes?: string,
    source: ToothUpdateSource = '2d'
  ): void {
    const chart = this.chartStore.get(patientId);
    if (!chart) return;

    chart.teeth[toothId] = {
      id: toothId,
      status,
      notes: notes !== undefined ? notes : chart.teeth[toothId]?.notes,
    };
    chart.lastUpdated = new Date().toISOString();
    this.chartStore.set(patientId, chart);
    this.currentChart.set({ ...chart });
    this.saveToLocalStorage(patientId, chart);

    this.api.updateTooth(patientId, toothId, status, chart.teeth[toothId].notes, source).subscribe({
      error: (err) => console.error(`Failed to persist tooth ${toothId} for patient ${patientId}`, err),
    });
  }

  /**
   * Returns all teeth for the currently active chart (used by ThreeDentalSyncService to seed 3D state).
   * Returns an empty object if no chart is currently loaded.
   */
  getAllTeeth(): Record<string, ToothState> {
    return this.currentChart()?.teeth ?? {};
  }

  /**
   * Update a single tooth on the currently active chart without requiring a patientId.
   * Called by ThreeDentalSyncService to bridge 3D → 2D chart state.
   * No-op if no chart is currently loaded.
   */
  updateTooth(toothId: string, partial: { status?: ToothStatus; notes?: string }, source: ToothUpdateSource = '3d_top'): void {
    const chart = this.currentChart();
    if (!chart) return;

    const existing = chart.teeth[toothId] ?? { id: toothId, status: 'present' as ToothStatus };
    const updatedTooth: ToothState = {
      ...existing,
      ...(partial.status !== undefined ? { status: partial.status } : {}),
      ...(partial.notes !== undefined ? { notes: partial.notes } : {}),
    };

    this.updateToothStatus(chart.patientId, toothId, updatedTooth.status, updatedTooth.notes, source);
  }

  /**
   * Get a tooth's current state.
   */
  getToothState(patientId: string, toothId: string): ToothState | undefined {
    return this.chartStore.get(patientId)?.teeth[toothId];
  }

  /**
   * Serialize chart state to a compact string for storage/transmission.
   * Only stores non-"present" teeth to keep the string minimal.
   */
  serialize(chart: DentalChartState): string {
    const compact: Record<string, any> = {
      t: chart.chartType === 'adult' ? 'a' : 'c',
      d: {} as Record<string, string>,
    };

    for (const [id, tooth] of Object.entries(chart.teeth)) {
      if (tooth.status !== 'present') {
        (compact.d as Record<string, string>)[id] = tooth.status;
        if (tooth.notes) {
          (compact.d as Record<string, string>)[`${id}_n`] = tooth.notes;
        }
      }
    }

    return btoa(JSON.stringify(compact));
  }

  /**
   * Deserialize a compact string back into a full DentalChartState.
   */
  deserialize(patientId: string, encoded: string): DentalChartState {
    try {
      const compact = JSON.parse(atob(encoded));
      const chartType: DentalChartType = compact.t === 'a' ? 'adult' : 'child';
      const chart = this.createDefaultChart(patientId, chartType);

      if (compact.d) {
        for (const [key, value] of Object.entries(compact.d)) {
          if (key.endsWith('_n')) {
            // It's a note
            const toothId = key.replace('_n', '');
            if (chart.teeth[toothId]) {
              chart.teeth[toothId].notes = value as string;
            }
          } else {
            // It's a status
            if (chart.teeth[key]) {
              chart.teeth[key].status = value as ToothStatus;
            }
          }
        }
      }

      return chart;
    } catch {
      // If deserialization fails, return default
      return this.createDefaultChart(patientId, 'adult');
    }
  }

  /**
   * Export chart state as a JSON string (human-readable).
   */
  exportAsJson(patientId: string): string {
    const chart = this.chartStore.get(patientId);
    if (!chart) return '{}';
    return JSON.stringify(chart, null, 2);
  }

  /**
   * Export chart state as a compact encoded string.
   */
  exportAsCompactString(patientId: string): string {
    const chart = this.chartStore.get(patientId);
    if (!chart) return '';
    return this.serialize(chart);
  }

  /**
   * Import chart state from a compact encoded string.
   */
  importFromCompactString(patientId: string, encoded: string): DentalChartState {
    const chart = this.deserialize(patientId, encoded);
    this.chartStore.set(patientId, chart);
    this.currentChart.set(chart);
    this.saveToLocalStorage(patientId, chart);
    return chart;
  }

  /**
   * Local cache only — not the source of truth. See loadChart/updateToothStatus.
   */
  private saveToLocalStorage(patientId: string, chart: DentalChartState): void {
    try {
      localStorage.setItem(`dental_chart_${patientId}`, this.serialize(chart));
    } catch (err) {
      console.error(`Failed to cache dental chart for patient ${patientId} locally`, err);
    }
  }

}
