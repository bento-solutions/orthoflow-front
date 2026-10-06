import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from '../api/url';
import type { Req, Wire } from '../api/wire';
import { QueryValue, toParams } from './download.service';

export type SterilItem = Wire<'ItemView'>;
export type SterilItemInput = Req<'ItemRequest'>;
export type SterilItemUpdate = Req<'ItemUpdate'>;
export type Autoclave = Wire<'AutoclaveView'>;
export type AutoclaveInput = Req<'AutoclaveRequest'>;
export type CycleSummary = Wire<'CycleSummary'>;
export type Cycle = Wire<'CycleView'>;
export type CycleInput = Req<'CycleRequest'>;
export type Exposure = Wire<'Exposure'>;
export type TraceEntry = Wire<'TraceEntry'>;
export type SterilDashboard = Wire<'SterilizationDashboard'>;
export type EndoKit = Wire<'KitView'>;
export type EndoModel = Wire<'ModelView'>;
export type EndoModelInput = Req<'ModelRequest'>;
export type EndoAlert = Wire<'EndoAlert'>;

export type ItemState = SterilItem['state'];
export type ItemKind = SterilItem['kind'];
export type ItemAction = SterilItem['nextActions'][number];
export type ControlResult = CycleSummary['controlResult'];
export type ControlType = CycleSummary['controlType'];

export const ITEM_STATES: readonly ItemState[] = ['READY', 'USED', 'DIRTY', 'PROCESSED'];
export const ITEM_KINDS: readonly ItemKind[] = ['TRAY', 'INSTRUMENT', 'HANDPIECE', 'ENDO_KIT'];
export const CONTROL_TYPES: readonly ControlType[] = ['CHEMICAL', 'BIOLOGICAL', 'PHYSICAL'];

/** Instruments, trays, handpieces and endo kits through cleaning and the autoclave, and who they were used on. */
@Injectable({ providedIn: 'root' })
export class SterilizationApi {
  private readonly http = inject(HttpClient);

  private get<T>(path: string, query?: Record<string, QueryValue>): Promise<T> {
    return firstValueFrom(this.http.get<T>(api(path), { params: toParams(query) }));
  }

  private post<T>(path: string, body: unknown = {}): Promise<T> {
    return firstValueFrom(this.http.post<T>(api(path), body));
  }

  dashboard(): Promise<SterilDashboard> {
    return this.get('/sterilization/dashboard');
  }

  // ── items ──────────────────────────────────────────────────────────
  items(query: { state?: string; kind?: string; search?: string; includeRetired?: boolean }): Promise<SterilItem[]> {
    return this.get('/sterilization/items', query);
  }
  item(id: string): Promise<SterilItem> {
    return this.get(`/sterilization/items/${id}`);
  }
  createItem(body: SterilItemInput): Promise<SterilItem> {
    return this.post('/sterilization/items', body);
  }
  updateItem(id: string, body: SterilItemUpdate): Promise<SterilItem> {
    return firstValueFrom(this.http.put<SterilItem>(api(`/sterilization/items/${id}`), body));
  }
  scan(code: string): Promise<SterilItem> {
    return this.get('/sterilization/scan', { code });
  }
  useItem(id: string, body: { patientId: string; appointmentId?: string; note?: string }): Promise<SterilItem> {
    return this.post(`/sterilization/items/${id}/use`, body);
  }
  cleanItem(id: string): Promise<SterilItem> {
    return this.post(`/sterilization/items/${id}/clean`);
  }
  lubricateItem(id: string, product?: string): Promise<SterilItem> {
    return this.post(`/sterilization/items/${id}/lubricate`, { product });
  }
  retireItem(id: string, reason: string): Promise<SterilItem> {
    return this.post(`/sterilization/items/${id}/retire`, { reason });
  }

  // ── cycles ─────────────────────────────────────────────────────────
  autoclaves(): Promise<Autoclave[]> {
    return this.get('/sterilization/autoclaves');
  }
  createAutoclave(body: AutoclaveInput): Promise<Autoclave> {
    return this.post('/sterilization/autoclaves', body);
  }
  updateAutoclave(id: string, body: AutoclaveInput): Promise<Autoclave> {
    return firstValueFrom(this.http.put<Autoclave>(api(`/sterilization/autoclaves/${id}`), body));
  }
  cycles(query: { from?: string; to?: string; autoclaveId?: string; result?: string }): Promise<CycleSummary[]> {
    return this.get('/sterilization/cycles', query);
  }
  cycle(id: string): Promise<Cycle> {
    return this.get(`/sterilization/cycles/${id}`);
  }
  createCycle(body: CycleInput): Promise<Cycle> {
    return this.post('/sterilization/cycles', body);
  }
  recordControl(id: string, result: ControlResult, note?: string): Promise<Cycle> {
    return this.post(`/sterilization/cycles/${id}/control`, { result, note });
  }
  exposure(id: string): Promise<Exposure> {
    return this.get(`/sterilization/cycles/${id}/exposure`);
  }

  // ── traceability ───────────────────────────────────────────────────
  traceByPatient(patientId: string): Promise<TraceEntry[]> {
    return this.get(`/sterilization/traceability/patients/${patientId}`);
  }
  traceByItem(itemId: string): Promise<TraceEntry[]> {
    return this.get(`/sterilization/traceability/items/${itemId}`);
  }
  traceByAppointment(appointmentId: string): Promise<TraceEntry[]> {
    return this.get(`/sterilization/traceability/appointments/${appointmentId}`);
  }

  // ── endo kits ──────────────────────────────────────────────────────
  kits(): Promise<EndoKit[]> {
    return this.get('/endo/kits');
  }
  addKitFile(kitItemId: string, modelId: string, quantity: number): Promise<EndoKit> {
    return this.post(`/endo/kits/${kitItemId}/files`, { modelId, quantity });
  }
  discardFile(fileId: string, reason: string): Promise<EndoKit> {
    return this.post(`/endo/files/${fileId}/discard`, { reason });
  }
  endoModels(): Promise<EndoModel[]> {
    return this.get('/endo/models');
  }
  createEndoModel(body: EndoModelInput): Promise<EndoModel> {
    return this.post('/endo/models', body);
  }
  updateEndoModel(id: string, body: EndoModelInput): Promise<EndoModel> {
    return firstValueFrom(this.http.put<EndoModel>(api(`/endo/models/${id}`), body));
  }
}
