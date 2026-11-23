import { createRng, shuffle, type Rng } from './rng';
import { patternFor } from './morse';
import { activeCharactersByBlock } from './protocols';
import type { Day1Protocol, Phase, RecognitionTestSpec, RetentionProtocol, ScheduledTrial } from './types';

/**
 * Deterministic schedule generation. Given (protocol, seed, includeDiagnostic) the output is
 * always identical. Each phase draws from its own sub-generator (`${seed}:${phase}`), so the
 * learning and final schedules do not depend on whether the diagnostic was taken.
 * Performance never enters this module: the schedule is fixed before the first trial.
 */

function longestTrailingRun<T>(seq: readonly T[]): number {
  if (seq.length === 0) return 0;
  const last = seq[seq.length - 1];
  let n = 0;
  for (let i = seq.length - 1; i >= 0 && seq[i] === last; i--) n++;
  return n;
}

export function maxRun<T>(seq: readonly T[]): number {
  let best = 0, cur = 0;
  for (let i = 0; i < seq.length; i++) {
    cur = i > 0 && seq[i] === seq[i - 1] ? cur + 1 : 1;
    best = Math.max(best, cur);
  }
  return best;
}

function violates<T>(prefix: readonly T[], seq: readonly T[], limit: number): boolean {
  return maxRun([...prefix.slice(-limit), ...seq]) > limit;
}

/**
 * Shuffle `items` so that no value repeats more than `limit` times in a row (taking the last
 * `limit` items of `prefix` into account). Rejection sampling first; if every attempt fails,
 * a deterministic greedy repair builds a sequence that satisfies the limit where possible.
 */
export function constrainedShuffle<T>(
  items: readonly T[],
  rng: Rng,
  limit: number,
  maxAttempts: number,
  prefix: readonly T[] = [],
): T[] {
  for (let a = 0; a < maxAttempts; a++) {
    const s = shuffle(items, rng);
    if (!violates(prefix, s, limit)) return s;
  }
  const pool = shuffle(items, rng);
  const out: T[] = [];
  while (pool.length) {
    const ctx = [...prefix, ...out];
    const tail = ctx[ctx.length - 1];
    const runOk = (v: T) => !(v === tail && longestTrailingRun(ctx) >= limit);
    // Prefer the most frequent remaining value that keeps the run limit (avoids dead ends).
    const counts = new Map<T, number>();
    pool.forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1));
    let idx = -1, bestCount = -1;
    pool.forEach((v, i) => {
      const c = counts.get(v) ?? 0;
      if (runOk(v) && c > bestCount) { bestCount = c; idx = i; }
    });
    if (idx < 0) idx = 0; // unavoidable violation
    out.push(pool.splice(idx, 1)[0] as T);
  }
  return out;
}

/**
 * Trial counts per character for one learning block.
 * Each active character gets floor(trials / k). The remaining trials go one each to the active
 * characters with the fewest *scheduled* exposures so far in the session (diagnostic excluded,
 * so the rule is identical for every participant); ties go to the most recently introduced.
 */
export function blockCounts(
  active: readonly string[],
  trials: number,
  scheduledSoFar: Readonly<Record<string, number>>,
): Record<string, number> {
  const k = active.length;
  if (k === 0) throw new Error('Block has no active characters');
  const base = Math.floor(trials / k);
  let rem = trials - base * k;
  const counts: Record<string, number> = {};
  active.forEach((c) => (counts[c] = base));
  const order = active
    .map((c, introIdx) => ({ c, introIdx, prior: scheduledSoFar[c] ?? 0 }))
    .sort((x, y) => x.prior - y.prior || y.introIdx - x.introIdx);
  for (const { c } of order) {
    if (rem <= 0) break;
    counts[c] = (counts[c] ?? 0) + 1;
    rem--;
  }
  return counts;
}

function repeatEach(chars: readonly string[], n: number): string[] {
  return chars.flatMap((c) => Array.from({ length: n }, () => c));
}

/** Response options keep the protocol's canonical character order so button positions stay fixed. */
function orderedOptions(canonical: readonly string[], active: readonly string[]): string[] {
  return canonical.filter((c) => active.includes(c));
}

function recognitionTrials(
  spec: RecognitionTestSpec,
  phase: Phase,
  canonical: readonly string[],
  rng: Rng,
  limit: number,
  attempts: number,
): Omit<ScheduledTrial, 'position' | 'trialKey' | 'priorTargetPresentations'>[] {
  const order = constrainedShuffle(repeatEach(spec.characters, spec.repetitionsPerCharacter), rng, limit, attempts);
  return order.map((target, i) => ({
    phase,
    phaseIndex: i + 1,
    block: null,
    target,
    pattern: patternFor(target),
    options: orderedOptions(canonical, spec.characters),
    includeIdk: spec.includeIdk,
    feedback: false,
    replayAllowed: false,
    introduceBefore: [],
  }));
}

function finalize(rows: Omit<ScheduledTrial, 'position' | 'trialKey' | 'priorTargetPresentations'>[]): ScheduledTrial[] {
  const seen: Record<string, number> = {};
  return rows.map((r, i) => {
    const prior = seen[r.target] ?? 0;
    if (r.phase === 'diagnostic' || r.phase === 'learning') seen[r.target] = prior + 1;
    return { ...r, position: i + 1, trialKey: `${r.phase}-${r.phaseIndex}`, priorTargetPresentations: prior };
  });
}

export function generateDay1Schedule(p: Day1Protocol, seed: string, includeDiagnostic: boolean): ScheduledTrial[] {
  const { maxRunLength: limit, maxAttempts } = p.randomization;
  const rows: Omit<ScheduledTrial, 'position' | 'trialKey' | 'priorTargetPresentations'>[] = [];

  if (includeDiagnostic) {
    rows.push(...recognitionTrials(p.diagnostic, 'diagnostic', p.characters, createRng(`${seed}:diagnostic`), limit, maxAttempts));
  }

  const lrng = createRng(`${seed}:learning`);
  const activeBy = activeCharactersByBlock(p);
  const scheduled: Record<string, number> = {};
  const learningSeq: string[] = [];
  let phaseIndex = 0;
  for (const b of p.learning.blocks) {
    const active = activeBy.get(b.block) ?? [];
    const counts = blockCounts(active, b.trials, scheduled);
    const items = active.flatMap((c) => repeatEach([c], counts[c] ?? 0));
    const order = constrainedShuffle(items, lrng, limit, maxAttempts, learningSeq);
    order.forEach((target, i) => {
      phaseIndex++;
      learningSeq.push(target);
      scheduled[target] = (scheduled[target] ?? 0) + 1;
      rows.push({
        phase: 'learning',
        phaseIndex,
        block: b.block,
        target,
        pattern: patternFor(target),
        options: orderedOptions(p.characters, active),
        includeIdk: false,
        feedback: true,
        replayAllowed: true,
        introduceBefore: i === 0 ? b.introduce.slice() : [],
      });
    });
  }

  rows.push(...recognitionTrials(p.final, 'final', p.characters, createRng(`${seed}:final`), limit, maxAttempts));
  return finalize(rows);
}

export function generateRetentionSchedule(p: RetentionProtocol, seed: string): ScheduledTrial[] {
  const { maxRunLength: limit, maxAttempts } = p.randomization;
  return finalize(recognitionTrials(p.test, 'retention', p.characters, createRng(`${seed}:retention`), limit, maxAttempts));
}
