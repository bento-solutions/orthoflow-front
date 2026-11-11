import {
  ChangeDetectionStrategy, Component, ElementRef, afterRenderEffect, computed, inject, input, signal, untracked, viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { ConsultationService } from '../../../../core/consultation/consultation.service';
import { VoiceOrchestratorService } from '../../../../core/voice/voice-orchestrator.service';

/**
 * The conversation as it is heard, each sentence with the time it was said and
 * what became of it. It keeps itself scrolled to the newest line — unless the
 * doctor scrolled up to read, in which case it stays put and offers "↓ nouveau".
 * Deliberately not a live region: read aloud, every sentence would talk over
 * the room.
 *
 * One text box at its foot: what is typed joins the conversation *and* is run as
 * a command, with no wake word — typing is deliberate.
 */
@Component({
  selector: 'app-cockpit-conversation',
  standalone: true,
  imports: [FormsModule, TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="ck-conv" [attr.aria-label]="'COCKPIT.CONVERSATION' | translate">
      <h3 class="ck-conv-head">{{ 'COCKPIT.CONVERSATION' | translate }}</h3>
      <div #scroller class="ck-lines" (scroll)="onScroll()" tabindex="0" [attr.aria-label]="'COCKPIT.CONVERSATION' | translate">
        @if (lines().length === 0) {
          <p class="ck-empty">{{ 'CONSULTATION.HEARD_EMPTY' | translate }}</p>
        }
        <ol>
          @for (line of lines(); track line.id) {
            <li class="ck-line" [attr.data-verdict]="line.verdict ?? 'pending'" [attr.data-line]="line.id">
              <span class="ck-line-time">{{ time(line.at) }}</span>
              <span class="ck-line-text" [class.typed]="line.typed">{{ line.text }}</span>
              @if (line.verdict && line.verdict !== 'heard') {
                <span class="ck-verdict" [attr.data-verdict]="line.verdict">
                  <span class="ck-verdict-name">{{ 'COCKPIT.VERDICT.' + verdictKey(line.verdict) | translate }}</span>
                  @if (line.summary) { <span class="ck-verdict-summary">{{ line.summary }}</span> }
                </span>
              } @else if (line.verdict === null) {
                <!-- Heard this session and still being read. A line restored after a reload has no verdict at all. -->
                <span class="ck-verdict" data-verdict="pending">{{ 'COCKPIT.IN_PROGRESS' | translate }}</span>
              }
            </li>
          }
          @if (voice.userSpeaking()) {
            <li class="ck-line ck-live" data-live="hearing">● {{ 'COCKPIT.HEARING' | translate }}</li>
          } @else if (voice.pendingTranscriptions() > 0) {
            <li class="ck-line ck-live" data-live="transcribing">… {{ 'COCKPIT.TRANSCRIBING' | translate }}</li>
          }
        </ol>
      </div>
      @if (unread()) {
        <button type="button" class="ck-newer" (click)="toBottom()">↓ {{ 'COCKPIT.NEWER' | translate }}</button>
      }
      @if (typing()) {
        <form class="ck-typed" (submit)="submit($event)">
          <input type="text" name="typed" [(ngModel)]="typed" autocomplete="off" enterkeyhint="send"
                 [placeholder]="'COCKPIT.TYPE_INSTEAD' | translate" [attr.aria-label]="'COCKPIT.TYPE_INSTEAD' | translate" />
          <button type="submit" class="ck-send" [attr.aria-label]="'VOICE.SEND' | translate">
            <span class="material-icons" aria-hidden="true">send</span>
          </button>
        </form>
      }
    </section>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; min-height: 0; }
    .ck-conv { position: relative; display: flex; flex-direction: column; min-height: 0; flex: 1; background: var(--surface); border: 1px solid rgb(var(--ink-200)); border-radius: .75rem; }
    .ck-conv-head { margin: 0; padding: .625rem .875rem .25rem; font-size: .75rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: rgb(var(--ink-600)); }
    .ck-lines { flex: 1; min-height: 0; overflow-y: auto; padding: 0 .875rem .5rem; overscroll-behavior: contain; }
    .ck-lines ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .5rem; }
    .ck-line { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: .125rem .5rem; font-size: .9rem; color: rgb(var(--ink-900)); }
    .ck-line-time { font-size: .75rem; font-variant-numeric: tabular-nums; color: rgb(var(--ink-600)); padding-top: .1rem; }
    .ck-line-text { overflow-wrap: anywhere; }
    .ck-line-text.typed { font-style: italic; }
    .ck-verdict { grid-column: 2; display: inline-flex; flex-wrap: wrap; gap: .375rem; align-items: baseline; font-size: .8125rem; }
    .ck-verdict-name { font-weight: 700; padding: 0 .4rem; border-radius: 999px; background: rgb(var(--ink-100)); color: rgb(var(--ink-800)); }
    .ck-verdict[data-verdict='acted'] .ck-verdict-name { background: rgb(var(--positive-100)); color: rgb(var(--positive-900)); }
    .ck-verdict[data-verdict='proposed'] .ck-verdict-name { background: rgb(var(--petrol-50)); color: rgb(var(--petrol-900)); }
    .ck-verdict[data-verdict='unsure'] .ck-verdict-name { background: rgb(var(--caution-100)); color: rgb(var(--caution-900)); }
    .ck-verdict[data-verdict='pending'] { color: rgb(var(--ink-600)); }
    .ck-verdict-summary { color: rgb(var(--ink-800)); font-weight: 600; }
    .ck-live { display: block; color: rgb(var(--ink-600)); font-style: italic; }
    .ck-empty { color: rgb(var(--ink-600)); font-size: .875rem; }
    .ck-newer { position: absolute; bottom: 3.5rem; left: 50%; transform: translateX(-50%); padding: .25rem .75rem; border-radius: 999px; background: rgb(var(--petrol-700)); color: #fff; font-weight: 700; font-size: .8125rem; box-shadow: 0 2px 6px rgb(0 0 0 / .2); }
    .ck-typed { display: flex; gap: .375rem; padding: .5rem; border-top: 1px solid rgb(var(--ink-100)); }
    .ck-typed input { flex: 1; min-width: 0; min-height: 2.5rem; padding: 0 .625rem; border: 1px solid rgb(var(--ink-200)); border-radius: .5rem; background: var(--surface); color: rgb(var(--ink-900)); }
    .ck-send { display: inline-grid; place-items: center; width: 2.5rem; height: 2.5rem; border-radius: .5rem; background: rgb(var(--petrol-700)); color: #fff; }
  `],
})
export class CockpitConversationComponent {
  protected readonly c = inject(ConsultationService);
  protected readonly voice = inject(VoiceOrchestratorService);

  /** The phone's sheet shows the conversation without the text box beneath the stage. */
  readonly typing = input(true);

  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  protected readonly lines = computed(() => this.c.lines().slice(-80));
  /** The doctor scrolled up to read; new lines do not pull them down. */
  private readonly following = signal(true);
  protected readonly unread = signal(false);
  protected typed = '';

  constructor() {
    afterRenderEffect(() => {
      this.lines();
      this.voice.userSpeaking();
      this.voice.pendingTranscriptions();
      const element = this.scroller()?.nativeElement;
      if (!element) return;
      if (untracked(this.following)) {
        element.scrollTop = element.scrollHeight;
        this.unread.set(false);
      } else {
        this.unread.set(true);
      }
    });
  }

  protected onScroll(): void {
    const element = this.scroller()?.nativeElement;
    if (!element) return;
    const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
    this.following.set(atBottom);
    if (atBottom) this.unread.set(false);
  }

  protected toBottom(): void {
    const element = this.scroller()?.nativeElement;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
    this.following.set(true);
    this.unread.set(false);
  }

  protected submit(event: Event): void {
    event.preventDefault();
    const text = this.typed.trim();
    if (!text) return;
    this.typed = '';
    const lineId = this.c.addTyped(text);
    // Typed is deliberate: run as a command without the wake word, on the same line.
    void this.voice.handleTranscript(text, 1, null, false, lineId);
  }

  protected time(at: number): string {
    if (!at) return '';
    const d = new Date(at);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
  }

  protected verdictKey(verdict: string): string {
    return verdict.replace('-', '_').toUpperCase();
  }
}
