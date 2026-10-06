import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from '../api/url';
import type { Req, Wire } from '../api/wire';
import { QueryValue, toParams } from './download.service';
import type { PaymentMethod } from './finance-api.service';

export type RetroRule = Wire<'RuleView'>;
export type RetroRuleInput = Req<'RuleRequest'>;
export type RetroAdvance = Wire<'AdvanceView'>;
export type RetroAdvanceInput = Req<'AdvanceRequest'>;
export type RetroSimulation = Wire<'Simulation'>;
export type RetroFigures = Wire<'PractitionerFigures'>;
export type RetroLine = Wire<'LineView'>;
export type StatementSummary = Wire<'StatementSummary'>;
export type Statement = Wire<'StatementView'>;
export type StatementInput = Req<'ValidateRequest'>;
export type PayoutInput = Req<'PayoutRequest'>;
export type ProcedureActivity = Wire<'ProcedureActivity'>;
export type DoctorTime = Wire<'DoctorTime'>;
export type IncomeStatement = Wire<'IncomeStatement'>;
export type GoalInputs = Req<'GoalInputs'>;
export type GoalPlan = Wire<'GoalPlan'>;
export type GoalSuggestions = Wire<'GoalSuggestions'>;
export type GoalTracking = Wire<'GoalTracking'>;

export type InvoiceStatus = 'DRAFT' | 'SENT' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED';
export const INVOICE_STATUSES: readonly InvoiceStatus[] = ['DRAFT', 'SENT', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'];
export type StatementStatus = Statement['status'];
export const INCOME_GROUPS = ['DAY', 'WEEK', 'MONTH', 'YEAR'] as const;

export interface SimulationQuery {
  from: string;
  to: string;
  practitionerId?: string;
  method?: readonly PaymentMethod[];
  status?: readonly InvoiceStatus[];
}

/** What the practice earns and what it pays its doctors: retrocessions (rules, simulations, statements, advances) and the analytics reports. */
@Injectable({ providedIn: 'root' })
export class AnalyticsApi {
  private readonly http = inject(HttpClient);

  private get<T>(path: string, query?: Record<string, QueryValue>): Promise<T> {
    return firstValueFrom(this.http.get<T>(api(path), { params: toParams(query) }));
  }

  private post<T>(path: string, body: unknown = {}): Promise<T> {
    return firstValueFrom(this.http.post<T>(api(path), body));
  }

  // ── retrocessions ──────────────────────────────────────────────────
  rules(practitionerId?: string): Promise<RetroRule[]> {
    return this.get('/retrocessions/rules', { practitionerId });
  }
  createRule(body: RetroRuleInput): Promise<RetroRule> {
    return this.post('/retrocessions/rules', body);
  }
  updateRule(id: string, body: RetroRuleInput): Promise<RetroRule> {
    return firstValueFrom(this.http.put<RetroRule>(api(`/retrocessions/rules/${id}`), body));
  }
  deleteRule(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(api(`/retrocessions/rules/${id}`)));
  }

  advances(practitionerId?: string): Promise<RetroAdvance[]> {
    return this.get('/retrocessions/advances', { practitionerId });
  }
  createAdvance(body: RetroAdvanceInput): Promise<RetroAdvance> {
    return this.post('/retrocessions/advances', body);
  }
  deleteAdvance(id: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(api(`/retrocessions/advances/${id}`)));
  }

  simulation(query: SimulationQuery): Promise<RetroSimulation> {
    return this.get('/retrocessions/simulation', { ...query, method: query.method ? [...query.method] : undefined, status: query.status ? [...query.status] : undefined });
  }
  statements(query: { practitionerId?: string; from?: string; to?: string; includeVoided?: boolean }): Promise<StatementSummary[]> {
    return this.get('/retrocessions/statements', query);
  }
  statement(id: string): Promise<Statement> {
    return this.get(`/retrocessions/statements/${id}`);
  }
  validateStatement(body: StatementInput): Promise<Statement> {
    return this.post('/retrocessions/statements', body);
  }
  payout(id: string, body: PayoutInput): Promise<Statement> {
    return this.post(`/retrocessions/statements/${id}/payouts`, body);
  }
  voidStatement(id: string, reason: string): Promise<Statement> {
    return this.post(`/retrocessions/statements/${id}/void`, { reason });
  }

  // ── analytics ──────────────────────────────────────────────────────
  procedures(query: { from: string; to: string; status?: readonly string[]; practitionerId?: string; category?: string }): Promise<ProcedureActivity> {
    return this.get('/analytics/procedures', { ...query, status: query.status ? [...query.status] : undefined });
  }
  doctorTime(query: { from: string; to: string; practitionerId?: string; minMinutes?: number; maxMinutes?: number; lang?: string }): Promise<DoctorTime> {
    return this.get('/analytics/doctor-time', query);
  }
  incomeStatement(query: { from: string; to: string; group: string; basis?: string; includeRetrocessions?: boolean; lang?: string }): Promise<IncomeStatement> {
    return this.get('/analytics/income-statement', query);
  }
  goalSuggestions(): Promise<GoalSuggestions> {
    return this.get('/analytics/goals/suggestions');
  }
  goalPlan(inputs: GoalInputs): Promise<GoalPlan> {
    return this.post('/analytics/goals/plan', inputs);
  }
  goalTracking(year: number): Promise<GoalTracking> {
    return this.get(`/analytics/goals/${year}`);
  }
  saveGoal(year: number, body: { basis?: string; inputs: GoalInputs }): Promise<GoalTracking> {
    return firstValueFrom(this.http.put<GoalTracking>(api(`/analytics/goals/${year}`), body));
  }
}
