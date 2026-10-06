import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { api } from '../api/url';
import type { Wire } from '../api/wire';

export type HelpNote = Wire<'NoteView'>;
export type HelpAnswer = Wire<'AskResponse'>;

/** The help text behind the "?" button, and the assistant that answers questions from it. */
@Injectable({ providedIn: 'root' })
export class HelpApi {
  private readonly http = inject(HttpClient);

  notes(lang: string): Promise<HelpNote[]> {
    return firstValueFrom(this.http.get<HelpNote[]>(api('/help/notes'), { params: { lang } }));
  }

  note(pageKey: string, lang: string): Promise<HelpNote> {
    return firstValueFrom(this.http.get<HelpNote>(api(`/help/notes/${pageKey}`), { params: { lang } }));
  }

  ask(question: string, lang: string, pageKey?: string): Promise<HelpAnswer> {
    return firstValueFrom(this.http.post<HelpAnswer>(api('/help/ask'), { question, lang, pageKey }));
  }
}
