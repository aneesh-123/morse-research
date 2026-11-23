import type { Day1Protocol, Protocol, RetentionProtocol } from './types';
import { RNG_ALGORITHM } from './rng';
import { ESTIMATOR_VERSION } from '../estimator/config';

/**
 * Versioned protocol definitions. A version string must never be reused for a different
 * definition: the database stores each definition with a content hash and refuses a mismatch.
 * To change anything below, add a new version and switch the active protocol in the dashboard.
 */

const AUDIO_V1 = { wpm: 15, frequencyHz: 600, gain: 0.5, rampMs: 5, leadInMs: 250 } as const;

const TIMING_V1 = {
  answersEnabledAfterSignalEnd: true,
  latencyReference: 'end_of_first_playback',
  hiddenDuringPlayback: 'restart_trial',
  hiddenAfterPlayback: 'accept_and_flag',
  reloadBeforeAnswer: 'restart_trial_and_flag',
  idleThresholdMs: 15000,
} as const;

const RANDOMIZATION_V1 = { algorithm: RNG_ALGORITHM, maxRunLength: 2, maxAttempts: 2000 } as const;

const CHARS = ['E', 'T', 'A', 'N', 'I', 'M'];

export const DAY1_V1: Day1Protocol = {
  version: 'day1-v1',
  studyType: 'day1_learning',
  title: 'Learning six Morse code letters',
  description:
    'Optional 12-trial diagnostic, 48 feedback-supported learning trials in six fixed blocks, a frozen knowledge profile, and a 24-trial independent recognition test.',
  consentVersion: 'consent-v1',
  characters: CHARS,
  audio: { ...AUDIO_V1 },
  randomization: { ...RANDOMIZATION_V1 },
  timing: { ...TIMING_V1 },
  targetDurationMinutes: [15, 20],
  diagnostic: {
    optional: true,
    characters: CHARS,
    repetitionsPerCharacter: 2,
    includeIdk: true,
    feedback: false,
    replayAllowed: false,
    hintsAvailable: false,
  },
  learning: {
    blocks: [
      { block: 1, trials: 8, introduce: ['E', 'T'] },
      { block: 2, trials: 8, introduce: ['A'] },
      { block: 3, trials: 8, introduce: ['N'] },
      { block: 4, trials: 8, introduce: ['I'] },
      { block: 5, trials: 8, introduce: ['M'] },
      { block: 6, trials: 8, introduce: [] },
    ],
    balancing: 'fewest_scheduled_exposures_then_newest',
    includeIdk: false,
    feedback: true,
    replayAllowed: true,
    feedbackReplayAllowed: true,
    hintsAvailable: false,
    adaptive: false,
  },
  final: {
    characters: CHARS,
    repetitionsPerCharacter: 4,
    includeIdk: true,
    feedback: false,
    replayAllowed: false,
    hintsAvailable: false,
  },
  estimatorVersion: ESTIMATOR_VERSION,
};

export const RETENTION_V1: RetentionProtocol = {
  version: 'retention-v1',
  studyType: 'delayed_retention',
  title: 'Delayed recognition check',
  description:
    'A no-feedback 24-trial recognition test of the six Day-1 letters, given before any review, at least 20 hours after a completed Day-1 session.',
  consentVersion: 'consent-retention-v1',
  characters: CHARS,
  audio: { ...AUDIO_V1 },
  randomization: { ...RANDOMIZATION_V1 },
  timing: { ...TIMING_V1 },
  targetDurationMinutes: [3, 5],
  parentProtocolVersion: 'day1-v1',
  minHoursAfterParent: 20,
  test: {
    characters: CHARS,
    repetitionsPerCharacter: 4,
    includeIdk: true,
    feedback: false,
    replayAllowed: false,
    hintsAvailable: false,
  },
};

export const PROTOCOLS: Readonly<Record<string, Protocol>> = Object.freeze({
  [DAY1_V1.version]: DAY1_V1,
  [RETENTION_V1.version]: RETENTION_V1,
});

export function getProtocol(version: string): Protocol {
  const p = PROTOCOLS[version];
  if (!p) throw new Error(`Unknown protocol version ${version}`);
  return p;
}

export function getDay1Protocol(version: string): Day1Protocol {
  const p = getProtocol(version);
  if (p.studyType !== 'day1_learning') throw new Error(`${version} is not a Day-1 protocol`);
  return p;
}

/** Characters active (already introduced) during each learning block. */
export function activeCharactersByBlock(p: Day1Protocol): Map<number, string[]> {
  const out = new Map<number, string[]>();
  const active: string[] = [];
  for (const b of p.learning.blocks) {
    active.push(...b.introduce);
    out.set(b.block, active.slice());
  }
  return out;
}

/** Block in which each character was introduced. */
export function introductionBlock(p: Day1Protocol): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of p.learning.blocks) for (const c of b.introduce) out[c] = b.block;
  return out;
}
