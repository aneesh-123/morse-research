/**
 * Rule-based estimator configuration.
 *
 * PROVISIONAL: these thresholds are a first-pass, hand-chosen configuration. They have NOT been
 * empirically validated. Changing any value requires a new ESTIMATOR_VERSION so that frozen
 * profiles always identify the exact rules that produced them.
 */

export const ESTIMATOR_VERSION = 'rules-v1';

export const EVIDENCE_CATEGORIES = [
  'strong_evidence',
  'some_evidence',
  'uncertain_inconsistent',
  'little_evidence',
  'insufficient_evidence',
] as const;

export type EvidenceCategory = (typeof EVIDENCE_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<EvidenceCategory, string> = {
  strong_evidence: 'Strong evidence of recognition',
  some_evidence: 'Some evidence of recognition',
  uncertain_inconsistent: 'Uncertain or inconsistent evidence',
  little_evidence: 'Little evidence of recognition',
  insufficient_evidence: 'Insufficient evidence',
};

export interface EstimatorConfig {
  version: string;
  /** Number of most recent learning observations used for "recent accuracy". */
  recentWindow: number;
  /** Observations used for the predicted final-test accuracy. */
  predictionWindow: number;
  /** z for the Wilson score interval (1.96 = 95%). */
  wilsonZ: number;
  /** Fewer learning observations than this is always insufficient evidence. */
  minObservations: number;
  /** Below this many observations, mixed results are reported as insufficient rather than inconsistent. */
  minObservationsForInconsistent: number;
  strong: { minN: number; minAccuracy: number; minRecentAccuracy: number; requireLowerBoundAboveChance: boolean };
  some: { minN: number; minAccuracy: number; minRecentAccuracy: number; requireLowerBoundAboveChance: boolean };
  little: { minN: number; maxWilsonUpper: number };
  /** Assumed guessing rate on the 6-option final test for a character that is not recognised. */
  finalGuessRate: number;
  /** Minimum non-interrupted latencies needed to report a latency distribution. */
  minLatencySamples: number;
}

export const RULES_V1: EstimatorConfig = {
  version: ESTIMATOR_VERSION,
  recentWindow: 3,
  predictionWindow: 4,
  wilsonZ: 1.96,
  minObservations: 3,
  minObservationsForInconsistent: 5,
  strong: { minN: 5, minAccuracy: 0.8, minRecentAccuracy: 1, requireLowerBoundAboveChance: true },
  some: { minN: 3, minAccuracy: 0.6, minRecentAccuracy: 2 / 3, requireLowerBoundAboveChance: true },
  little: { minN: 4, maxWilsonUpper: 0.6 },
  finalGuessRate: 1 / 6,
  minLatencySamples: 2,
};
