/**
 * Experiment state machine. The server is authoritative: every stage change goes through
 * `assertTransition`, and trial submissions are only accepted in the stage that owns the phase.
 */

export const STAGES = [
  'created',
  'consent_pending',
  'audio_setup',
  'baseline_screening',
  'diagnostic',
  'learning',
  'profile_generation',
  'final_assessment',
  'retention_screening',
  'retention_test',
  'completed',
  'declined',
  'withdrawn',
  'abandoned',
] as const;

export type Stage = (typeof STAGES)[number];

export const TERMINAL_STAGES: readonly Stage[] = ['completed', 'declined', 'withdrawn', 'abandoned'];

const ANY_ACTIVE_TO_EXIT: Stage[] = ['withdrawn', 'abandoned'];

const TRANSITIONS: Record<Stage, readonly Stage[]> = {
  created: ['consent_pending', ...ANY_ACTIVE_TO_EXIT],
  consent_pending: ['audio_setup', 'declined', ...ANY_ACTIVE_TO_EXIT],
  // Day 1: audio -> baseline screening. Retention: audio -> retention screening.
  audio_setup: ['baseline_screening', 'retention_screening', ...ANY_ACTIVE_TO_EXIT],
  baseline_screening: ['diagnostic', 'learning', ...ANY_ACTIVE_TO_EXIT],
  diagnostic: ['learning', ...ANY_ACTIVE_TO_EXIT],
  learning: ['profile_generation', ...ANY_ACTIVE_TO_EXIT],
  profile_generation: ['final_assessment', ...ANY_ACTIVE_TO_EXIT],
  final_assessment: ['completed', ...ANY_ACTIVE_TO_EXIT],
  retention_screening: ['retention_test', ...ANY_ACTIVE_TO_EXIT],
  retention_test: ['completed', ...ANY_ACTIVE_TO_EXIT],
  completed: [],
  declined: [],
  withdrawn: [],
  abandoned: [],
};

export class TransitionError extends Error {
  constructor(public from: Stage, public to: Stage) {
    super(`Invalid stage transition ${from} -> ${to}`);
    this.name = 'TransitionError';
  }
}

export function canTransition(from: Stage, to: Stage): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: Stage, to: Stage): void {
  if (!canTransition(from, to)) throw new TransitionError(from, to);
}

export function isTerminal(s: Stage): boolean {
  return TERMINAL_STAGES.includes(s);
}

/** Stage in which trials of each phase may be submitted. */
export const PHASE_STAGE = {
  diagnostic: 'diagnostic',
  learning: 'learning',
  final: 'final_assessment',
  retention: 'retention_test',
} as const satisfies Record<string, Stage>;

/** Telemetry is accepted only after consent and before the session ends. */
export function telemetryAllowed(s: Stage): boolean {
  return !['created', 'consent_pending', 'declined', 'withdrawn'].includes(s);
}
