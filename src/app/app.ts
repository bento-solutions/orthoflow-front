import { Component, HostListener, inject } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { LanguageService } from './core/services/language.service';
import { ToastContainerComponent } from './shared/components/toast/toast-container.component';
import { ConfirmDialogComponent } from './shared/components/confirm-dialog/confirm-dialog.component';
import { CommandPaletteComponent } from './shared/components/command-palette/command-palette.component';
import { CommandRegistryService } from './core/services/command-registry.service';
import { registerAppCommands } from './core/services/register-app-commands';
import { HelpPanelService } from './core/services/help-panel.service';
import { ThemeService } from './core/services/theme.service';
import { VoiceCommandsService } from './core/voice/register-voice-commands';
import { VoiceOrchestratorService } from './core/voice/voice-orchestrator.service';
import { VoiceApiService } from './core/voice/voice-api.service';
import { assertLexiconMatches } from './core/voice/clinical-lexicon';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterOutlet,
    ToastContainerComponent,
    ConfirmDialogComponent,
    CommandPaletteComponent,
  ],
  // The voice HUD is deliberately *not* here. It used to be mounted at the
  // app root, which put a listening indicator and a live microphone on every
  // screen in the application. Dictation only means anything inside a patient
  // dossier — that is the only context in which "add a finding to sixteen"
  // has a referent — so the HUD lives there now, and the session cannot be
  // started from anywhere else.
  template: `<router-outlet />
    <app-toast-container />
    <app-confirm-dialog />
    <app-command-palette />`,
})
export class App {
  private voiceCommands = inject(VoiceCommandsService);
  private voice = inject(VoiceOrchestratorService);
  private voiceApi = inject(VoiceApiService);

  constructor(
    private languageService: LanguageService,
    private commandRegistry: CommandRegistryService,
    private router: Router,
    help: HelpPanelService,
    theme: ThemeService,
  ) {
    registerAppCommands(this.commandRegistry, this.router, help, theme);
    this.voiceCommands.registerAll();
    this.verifyLexicon();
  }

  /**
   * The browser's spoken-finding vocabulary and the server's finding catalog
   * have to agree, or a doctor dictates a finding that fails validation
   * mid-examination. Checking at boot turns that into a console warning a
   * developer sees, rather than a failure a clinician does.
   */
  private verifyLexicon(): void {
    this.voiceApi.lexicon().subscribe({
      next: response => {
        const result = assertLexiconMatches(response.codes ?? []);
        if (!result.ok) console.warn(result.message);
      },
      // Pre-auth or offline: not worth surfacing, the server still validates
      // every code it is sent.
      error: () => undefined,
    });
  }

  /**
   * ⌘K opens the command palette; ⌘⇧V toggles one-shot listening, which is
   * still useful outside an examination (and on a machine where the dentist
   * is at the keyboard). During an examination the wake word is the trigger,
   * because their hands are not free. Enter and Escape answer a pending
   * confirmation without reaching for the mouse.
   */
  @HostListener('window:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    const mod = event.metaKey || event.ctrlKey;

    if (mod && event.shiftKey && event.key.toLowerCase() === 'v') {
      event.preventDefault();
      this.voice.toggleListening();
      return;
    }

    if (mod && !event.shiftKey && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.commandRegistry.toggle();
      return;
    }

    if (this.voice.confirmation()) {
      // Only when focus isn't in a text field, so typing a note that happens
      // to end with Enter cannot confirm a clinical write by accident.
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;
      if (typing) return;

      if (event.key === 'Enter') {
        event.preventDefault();
        void this.voice.confirmPending();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        void this.voice.rejectPending();
      }
    }
  }
}
