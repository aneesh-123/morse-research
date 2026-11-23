/**
 * The estimator's input boundary.
 *
 * The estimator never sees a participant record, an event stream or a database handle. It only
 * receives an `EstimatorSnapshot`, built here from explicitly listed diagnostic and learning
 * observations. `buildEstimatorSnapshot` throws if any other phase is passed in, so final-test
 * answers cannot leak into a profile even by mistake; tests cover this.
 */

export type BaselineStatus = 'tested' | 'not_tested_self_reported_beginner';

export interface EstimatorObservation {
  phase: 'diagnostic' | 'learning';
  position: number;
  phaseIndex: number;
  block: number | null;
  target: string;
  /** Selected letter, or null when the participant chose "I don't know". */
  response: string | null;
  idk: boolean;
  correct: boolean;
  optionCount: number;
  /** Latency from end of first playback, ms. Null when not measurable. */
  rtMs: number | null;
  replayCount: number;
  /** Any interruption flag on the trial (hidden/blurred/restarted/playback interrupted). */
  interrupted: boolean;
}

export interface EstimatorSnapshot {
  schema: 'estimator-snapshot-v1';
  protocolVersion: string;
  estimatorVersion: string;
  characters: string[];
  introductionBlock: Record<string, number>;
  baselineStatus: BaselineStatus;
  /** Self-reported prior knowledge, 1..10. */
  priorKnowledgeRating: number | null;
  observations: EstimatorObservation[];
  /** Highest session position included in the snapshot (the input-data cutoff). */
  cutoffPosition: number;
}

/** Shape of a stored response row the snapshot builder accepts (a subset of trial_responses). */
export interface SnapshotSourceRow {
  phase: string;
  position: number;
  phase_index: number;
  block: number | null;
  target: string;
  response: string | null;
  is_idk: boolean;
  is_correct: boolean;
  option_count: number;
  rt_ms: number | null;
  replay_count: number;
  interrupted: boolean;
}

export class SnapshotLeakError extends Error {
  constructor(phase: string) {
    super(`Estimator snapshot refused a "${phase}" observation: only diagnostic and learning data may be used`);
    this.name = 'SnapshotLeakError';
  }
}

export function buildEstimatorSnapshot(args: {
  protocolVersion: string;
  estimatorVersion: string;
  characters: string[];
  introductionBlock: Record<string, number>;
  baselineStatus: BaselineStatus;
  priorKnowledgeRating: number | null;
  rows: readonly SnapshotSourceRow[];
}): EstimatorSnapshot {
  const observations: EstimatorObservation[] = args.rows
    .map((r) => {
      if (r.phase !== 'diagnostic' && r.phase !== 'learning') throw new SnapshotLeakError(r.phase);
      return {
        phase: r.phase,
        position: r.position,
        phaseIndex: r.phase_index,
        block: r.block,
        target: r.target,
        response: r.response,
        idk: r.is_idk,
        correct: r.is_correct,
        optionCount: r.option_count,
        rtMs: r.rt_ms === null ? null : Number(r.rt_ms),
        replayCount: r.replay_count,
        interrupted: r.interrupted,
      } satisfies EstimatorObservation;
    })
    .sort((a, b) => a.position - b.position);
  if (args.baselineStatus === 'not_tested_self_reported_beginner' && observations.some((o) => o.phase === 'diagnostic')) {
    throw new Error('Snapshot has diagnostic observations but baseline status says the diagnostic was skipped');
  }
  return {
    schema: 'estimator-snapshot-v1',
    protocolVersion: args.protocolVersion,
    estimatorVersion: args.estimatorVersion,
    characters: args.characters.slice(),
    introductionBlock: { ...args.introductionBlock },
    baselineStatus: args.baselineStatus,
    priorKnowledgeRating: args.priorKnowledgeRating,
    observations,
    cutoffPosition: observations.reduce((m, o) => Math.max(m, o.position), 0),
  };
}

/** Deterministic JSON (sorted keys) used for hashing snapshots. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(',')}}`;
}
