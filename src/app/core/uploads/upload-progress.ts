import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpEventType, HttpInterceptorFn } from '@angular/common/http';
import { finalize, tap } from 'rxjs';

interface Upload {
  readonly id: number;
  readonly name: string;
  readonly loaded: number;
  readonly total: number;
}

/**
 * Every file upload in flight, so one bar can show them all and the page can warn before
 * it is closed mid-upload. Fed by {@link uploadProgressInterceptor}, not by the screens.
 */
@Injectable({ providedIn: 'root' })
export class UploadProgressService {
  private readonly uploads = signal<readonly Upload[]>([]);
  private nextId = 0;

  readonly active = computed(() => this.uploads().length > 0);

  /** What the bar says: the single file's name, or how many files. */
  readonly label = computed(() => {
    const list = this.uploads();
    return list.length === 1 ? list[0].name : '';
  });
  readonly count = computed(() => this.uploads().length);

  /** 0–100 across every upload, or null while no upload has reported a size yet. */
  readonly percent = computed<number | null>(() => {
    const list = this.uploads();
    const total = list.reduce((sum, u) => sum + u.total, 0);
    if (!total) return null;
    const loaded = list.reduce((sum, u) => sum + Math.min(u.loaded, u.total), 0);
    return Math.min(100, Math.round((loaded / total) * 100));
  });

  start(name: string): number {
    const id = ++this.nextId;
    this.uploads.update(list => [...list, { id, name, loaded: 0, total: 0 }]);
    return id;
  }

  progress(id: number, loaded: number, total: number): void {
    this.uploads.update(list => list.map(u => (u.id === id ? { ...u, loaded, total } : u)));
  }

  end(id: number): void {
    this.uploads.update(list => list.filter(u => u.id !== id));
  }
}

/**
 * Dictation sends each spoken phrase as a small clip while the dentist talks. That is not a
 * file the user chose to upload, and a bar flashing on every sentence would be noise.
 */
const isBackgroundUpload = (url: string): boolean => url.includes('/voice/') && url.endsWith('/transcribe');

function fileName(body: FormData): string {
  for (const [, value] of body.entries()) {
    if (value instanceof File && value.name) return value.name;
  }
  return '';
}

/**
 * Turns on progress events for any request that sends a file (a FormData body) and reports
 * them to {@link UploadProgressService}. Callers still get only the response: HttpClient
 * drops progress events for the default `observe: 'body'`.
 */
export const uploadProgressInterceptor: HttpInterceptorFn = (req, next) => {
  if (!(req.body instanceof FormData) || isBackgroundUpload(req.url)) {
    return next(req);
  }
  const uploads = inject(UploadProgressService);
  const id = uploads.start(fileName(req.body));
  return next(req.clone({ reportProgress: true })).pipe(
    tap(event => {
      if (event.type === HttpEventType.UploadProgress) {
        uploads.progress(id, event.loaded, event.total ?? 0);
      }
    }),
    finalize(() => uploads.end(id)),
  );
};
