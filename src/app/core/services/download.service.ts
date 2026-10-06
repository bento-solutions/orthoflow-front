import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from '../api/url';

export type QueryValue = string | number | boolean | null | undefined | ReadonlyArray<string | number | boolean>;

/** Query parameters from a plain object, leaving out anything null, undefined or empty, and repeating list values. */
export function toParams(query: Record<string, QueryValue> | undefined): HttpParams {
  let params = new HttpParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === null || value === undefined || value === '') {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        params = params.append(key, String(item));
      }
    } else {
      params = params.set(key, String(value));
    }
  }
  return params;
}

/**
 * The file name a response asks for, from its `Content-Disposition` header. Prefers the
 * RFC 5987 `filename*` form (which the backend sends for names with accents), then the plain
 * quoted one, and falls back to {@code fallback} when the header is missing or unreadable.
 */
export function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) {
    return fallback;
  }
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim());
    } catch {
      /* a malformed escape: try the plain form */
    }
  }
  const plain = /filename\s*=\s*"?([^";]+)"?/.exec(header);
  return plain ? plain[1].trim() : fallback;
}

/**
 * Downloads or previews a file the API generates (an export, a statement, a label sheet).
 * These endpoints need the bearer token, so a plain link or `<a download>` cannot reach
 * them: the bytes are fetched with the authenticated client and handed to the browser.
 */
@Injectable({ providedIn: 'root' })
export class DownloadService {
  private readonly http = inject(HttpClient);

  /** Saves the file under the name the server gave it. */
  async download(path: string, query?: Record<string, QueryValue>, fallbackName = 'export'): Promise<void> {
    const { blob, name } = await this.fetch(path, query, fallbackName);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  /** Opens the file in a new tab, for a PDF the person wants to read before printing. */
  async open(path: string, query?: Record<string, QueryValue>): Promise<void> {
    const { blob } = await this.fetch(path, query, 'document');
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  private async fetch(path: string, query: Record<string, QueryValue> | undefined, fallbackName: string) {
    const response = await firstValueFrom(
      this.http.get(api(path), { params: toParams(query), responseType: 'blob', observe: 'response' }),
    );
    return {
      blob: response.body as Blob,
      name: filenameFromDisposition(response.headers.get('Content-Disposition'), fallbackName),
    };
  }
}
