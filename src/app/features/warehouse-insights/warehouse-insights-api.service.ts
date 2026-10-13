import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from '../../core/api/url';
import type { Wire } from '../../core/api/wire';

export type LeakageReport = Wire<'LeakageReport'>;
export type LeakageByDoctor = Wire<'LeakageByDoctor'>;
export type LeakageLine = Wire<'LeakageLine'>;
export type OrderForecast = Wire<'OrderForecast'>;
export type OrderSuggestion = Wire<'OrderSuggestion'>;

/**
 * The two questions the warehouse answers beyond "what is on the shelf": where did the
 * stock actually go, and what should we buy next.
 *
 * <p>Both are read-only and both sit behind ANALYTICS_VIEW on the server, because they
 * name doctors and carry costs.
 */
@Injectable({ providedIn: 'root' })
export class WarehouseInsightsApi {
  private readonly http = inject(HttpClient);

  /** Expected consumption from the bill of materials against what really left the shelf. */
  leakage(from: string, to: string): Promise<LeakageReport> {
    return firstValueFrom(this.http.get<LeakageReport>(api('/stock/insights/leakage'), { params: { from, to } }));
  }

  /** Suggested order for a month; omit the month for the next one. */
  forecast(month?: string): Promise<OrderForecast> {
    return firstValueFrom(
      this.http.get<OrderForecast>(api('/stock/insights/forecast'), month ? { params: { month } } : {}),
    );
  }
}
