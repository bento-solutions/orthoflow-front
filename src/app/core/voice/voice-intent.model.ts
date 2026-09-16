import { Dentition } from './tooth-lexicon';
import { Severity } from './clinical-lexicon';

/**
 * The typed layer between speech and the application.
 *
 * Nothing in the voice system executes a transcript. Speech becomes a
 * {@link VoiceIntent} — a command id plus validated arguments — and only a
 * registered {@link VoiceCommand} can act on one. That indirection is what
 * makes the whole thing auditable: the audit trail records the resolved
 * command, and a misrecognition can only ever produce a *wrong registered
 * command*, never an arbitrary action.
 */

/** Audit XII.4 §3. */
export type RiskTier =
  /** Navigation and reads. Runs on recognition; undone by navigating back. */
  | 'SAFE'
  /** Any clinical or financial write. Preview the resolved values, then confirm. */
  | 'CONFIRM'
  /**
   * Requires a deliberate physical act — deleting a patient, voiding an
   * invoice. Never executed by voice; the assistant says so and points at the
   * screen that does it.
   */
  | 'BLOCKED';

export type ResolverKind = 'grammar' | 'llm' | 'manual';

export type ConfirmationStatus = 'AUTO' | 'CONFIRMED' | 'REJECTED' | 'CANCELLED' | 'PENDING';
export type CommandOutcome = 'EXECUTED' | 'REJECTED' | 'FAILED' | 'CLARIFICATION' | 'UNDONE';

export interface VoiceIntent {
  /** Id of a registered {@link VoiceCommand}. Never free-form. */
  intent: string;
  entities: Record<string, unknown>;
  /** 0–1. Below the orchestrator's floor, the doctor is asked to confirm even for SAFE. */
  confidence: number;
  resolver: ResolverKind;
  transcript: string;
}

export interface ClarificationOption {
  value: string;
  label: string;
}

/**
 * A question, which is a first-class result rather than a failure. "Which
 * upper molar do you mean?" is the correct output for an under-specified
 * utterance; guessing is not (audit XII.4 §5).
 */
export interface VoiceClarification {
  question: string;
  options: ClarificationOption[];
  transcript: string;
  /**
   * The command this would have been, so answering the question can complete
   * it rather than starting over.
   */
  pendingIntent?: string;
  pendingEntities?: Record<string, unknown>;
  /** Which argument the question is asking for. */
  awaiting?: string;
}

export type VoiceResolution =
  | { kind: 'intent'; intent: VoiceIntent }
  | { kind: 'clarification'; clarification: VoiceClarification }
  | { kind: 'unrecognized'; transcript: string };

/** What the assistant knows about where it is and what just happened. */
export interface VoiceContextSnapshot {
  patientId: string | null;
  patientName: string | null;
  dentition: Dentition;
  /** 'patient-dossier' | 'dental-chart' | 'schedule' | 'billing' | 'stock' | 'global' */
  module: string;
  route: string;
  selectedFdi: string | null;
  sessionId: string | null;
  locale: string;
  /** Most recent first — resolves "that tooth", "the last finding", "change that". */
  recentIntents: VoiceIntent[];
  recentUtterances: string[];
  /** The last write, so "no, actually…" and "undo that" have something to act on. */
  lastWrite: LastWriteRef | null;
}

export interface LastWriteRef {
  commandId: string;
  targetType: string;
  targetId: string;
  fdi?: string;
  description: string;
  auditId?: string;
  undo?: () => Promise<void>;
}

export interface VoiceCommandResult {
  ok: boolean;
  /** Shown in the HUD and spoken back. Should name the resolved values, not echo the transcript. */
  message: string;
  targetType?: string;
  targetId?: string;
  previousValue?: string;
  newValue?: string;
  /** Tooth to highlight on the chart so the doctor can verify without touching anything. */
  highlightFdi?: string;
  /** Inverse operation, offered as an Undo affordance for ~10s (audit XII.4 §4). */
  undo?: () => Promise<void>;
}

export interface VoiceCommand {
  id: string;
  /** One line, written for the NLU prompt as much as for the help screen. */
  description: string;
  /** Restricts the command to a module; undefined means available everywhere. */
  module?: string;
  /** Restricts by route prefix, matching CommandRegistryService's convention. */
  routeScope?: string;
  risk: RiskTier;
  /** Argument name → what it means, sent verbatim to the NLU. */
  args: Record<string, string>;
  examples: string[];
  requiresPatient?: boolean;
  /**
   * What is about to happen, in resolved values — "Tooth 16 → recurrent
   * caries, crown replacement required", never a repeat of the transcript.
   * This is the single most important safety surface (audit XII.4 §2).
   */
  preview: (entities: Record<string, unknown>, context: VoiceContextSnapshot) => string;

  /**
   * The server intent this command is executed as, for CONFIRM-tier writes.
   *
   * When set, the client never performs the write. It records the command as
   * a PENDING audit row, previews it, and on confirmation asks the server to
   * execute *that row* — so what runs is re-derived from what was audited and
   * shown, and cannot drift from it even if the client is wrong or hostile.
   */
  serverIntent?: string;

  /** Maps the grammar's entities onto the shape the server intent expects. */
  toServerEntities?: (
    entities: Record<string, unknown>,
    context: VoiceContextSnapshot,
  ) => Record<string, unknown>;

  /**
   * Feedback and inverse operation for a command the server executed, given
   * the resulting audit row. The command owns how its own result reads and
   * how it is undone.
   */
  onServerExecuted?: (
    audit: { targetType?: string | null; targetId?: string | null; newValue?: string | null },
    entities: Record<string, unknown>,
    context: VoiceContextSnapshot,
  ) => VoiceCommandResult;

  /**
   * Client-side execution, for SAFE commands only (navigation and reads).
   * Clinical writes must go through {@link serverIntent} instead.
   */
  execute?: (
    entities: Record<string, unknown>,
    context: VoiceContextSnapshot,
  ) => Promise<VoiceCommandResult>;
}

/** One finding as the grammar extracted it, before it becomes an API call. */
export interface FindingEntity {
  code: string;
  label: string;
  kind: string;
  surface: string | null;
  severity: Severity | null;
  note?: string;
}

/**
 * Reads an entity value that the rest of the system treats as a string.
 *
 * The server canonicalises `fdi` when it parses a model's JSON, but entity
 * maps reach the browser from three places — the on-device grammar, the LLM
 * fallback, and an audit row read back from the database — and a model will
 * happily emit `"fdi": 16` as a number. Every consumer that tested
 * `typeof === 'string'` silently skipped those, so a finding would save
 * correctly and then vanish from the review page's tooth chart and refuse to
 * be removed by voice. One tolerant reader is cheaper than remembering.
 */
export function entityString(
  entities: Record<string, unknown> | undefined,
  key: string,
): string | null {
  const value = entities?.[key];
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/**
 * The finding codes a staged command carries, whatever shape its entities
 * took. A staged tooth finding holds `findings: [{ code }]` — the server
 * intent's shape — while the NLU and older rows use `findingCodes` or a
 * single `findingCode`. Readers that only knew the latter two found nothing
 * on any dictated finding: removing one by voice matched no entry, and the
 * review page listed teeth with no findings on them.
 */
export function stagedFindingCodes(entities: Record<string, unknown> | undefined): string[] {
  if (!entities) return [];
  const codes: string[] = [];
  const findings = entities['findings'];
  if (Array.isArray(findings)) {
    for (const finding of findings) {
      const code = (finding as { code?: unknown } | null)?.code;
      if (typeof code === 'string') codes.push(code);
    }
  }
  if (Array.isArray(entities['findingCodes'])) {
    codes.push(...(entities['findingCodes'] as unknown[]).map(String));
  }
  if (typeof entities['findingCode'] === 'string') codes.push(entities['findingCode']);
  return [...new Set(codes)];
}
