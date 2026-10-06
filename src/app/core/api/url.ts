import { environment } from '../../../environments/environment';

/** The absolute URL of an API path: `api('/finance/debts')`. */
export const api = (path: string): string => `${environment.apiUrl}/api/v1${path}`;
