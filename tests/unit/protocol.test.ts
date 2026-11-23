import { describe, expect, it } from 'vitest';
import { MORSE_LETTERS, patternFor, signalSegments, unitMs, displayPattern } from '@/lib/protocol/morse';
import { DAY1_V1, RETENTION_V1, activeCharactersByBlock, introductionBlock } from '@/lib/protocol/protocols';
import { blockCounts, constrainedShuffle, generateDay1Schedule, generateRetentionSchedule, maxRun } from '@/lib/protocol/schedule';
import { createRng } from '@/lib/protocol/rng';
import { assertTransition, canTransition, telemetryAllowed } from '@/lib/protocol/state-machine';

describe('Morse mapping', () => {
  it('maps the six study letters correctly', () => {
    expect(patternFor('E')).toBe('.');
    expect(patternFor('T')).toBe('-');
    expect(patternFor('A')).toBe('.-');
    expect(patternFor('N')).toBe('-.');
    expect(patternFor('I')).toBe('..');
    expect(patternFor('m')).toBe('--');
    expect(Object.keys(MORSE_LETTERS)).toHaveLength(26);
    expect(new Set(Object.values(MORSE_LETTERS)).size).toBe(26);
    expect(displayPattern('.-')).toBe('·−');
  });
  it('throws for unknown characters', () => {
    expect(() => patternFor('?')).toThrow();
  });
});

describe('Audio timing', () => {
  it('uses the PARIS unit and 1/3/1 element timing', () => {
    expect(unitMs(15)).toBe(80);
    expect(unitMs(20)).toBe(60);
    const a = signalSegments('.-', 15);
    expect(a.segments).toEqual([
      { startMs: 0, durationMs: 80, kind: 'dot' },
      { startMs: 160, durationMs: 240, kind: 'dash' },
    ]);
    expect(a.durationMs).toBe(400);
    expect(signalSegments('.', 15).durationMs).toBe(80);
    expect(signalSegments('--', 15).durationMs).toBe(560);
    expect(() => signalSegments('.x', 15)).toThrow();
    expect(() => unitMs(0)).toThrow();
  });
});

describe('Randomization', () => {
  it('is reproducible for the same seed and differs across seeds', () => {
    const a = generateDay1Schedule(DAY1_V1, 'seed-1', true);
    const b = generateDay1Schedule(DAY1_V1, 'seed-1', true);
    const c = generateDay1Schedule(DAY1_V1, 'seed-2', true);
    expect(a).toEqual(b);
    expect(a.map((t) => t.target).join('')).not.toBe(c.map((t) => t.target).join(''));
  });
  it('learning and final orders do not depend on taking the diagnostic', () => {
    const withD = generateDay1Schedule(DAY1_V1, 's', true).filter((t) => t.phase !== 'diagnostic');
    const without = generateDay1Schedule(DAY1_V1, 's', false);
    expect(withD.map((t) => t.target)).toEqual(without.map((t) => t.target));
  });
  it('constrained shuffle keeps the multiset and the run limit', () => {
    const rng = createRng('x');
    const items = ['E', 'E', 'E', 'E', 'T', 'T', 'T', 'T'];
    for (let i = 0; i < 50; i++) {
      const s = constrainedShuffle(items, rng, 2, 2000);
      expect([...s].sort()).toEqual([...items].sort());
      expect(maxRun(s)).toBeLessThanOrEqual(2);
    }
  });
  it('repair pass still satisfies the limit when sampling is disabled', () => {
    const s = constrainedShuffle(['A', 'A', 'A', 'B', 'B', 'B'], createRng('r'), 1, 0);
    expect(maxRun(s)).toBe(1);
  });
});

describe('Day-1 schedule (protocol day1-v1)', () => {
  const seeds = Array.from({ length: 200 }, (_, i) => `seed-${i}`);
  it('diagnostic has exactly 12 trials, each letter twice, no feedback/replay, with IDK', () => {
    for (const seed of seeds) {
      const d = generateDay1Schedule(DAY1_V1, seed, true).filter((t) => t.phase === 'diagnostic');
      expect(d).toHaveLength(12);
      for (const ch of DAY1_V1.characters) expect(d.filter((t) => t.target === ch)).toHaveLength(2);
      expect(d.every((t) => !t.feedback && !t.replayAllowed && t.includeIdk && t.options.length === 6)).toBe(true);
    }
  });
  it('skipping the diagnostic yields no diagnostic trials', () => {
    expect(generateDay1Schedule(DAY1_V1, 's', false).some((t) => t.phase === 'diagnostic')).toBe(false);
  });
  it('learning has 48 trials in 6 blocks of 8 with fixed introductions', () => {
    const active = activeCharactersByBlock(DAY1_V1);
    for (const seed of seeds) {
      const l = generateDay1Schedule(DAY1_V1, seed, false).filter((t) => t.phase === 'learning');
      expect(l).toHaveLength(48);
      for (let b = 1; b <= 6; b++) {
        const bt = l.filter((t) => t.block === b);
        expect(bt).toHaveLength(8);
        expect(bt.every((t) => (active.get(b) ?? []).includes(t.target))).toBe(true);
        expect(bt.every((t) => JSON.stringify(t.options) === JSON.stringify(active.get(b)))).toBe(true);
        expect(bt[0]?.introduceBefore).toEqual(DAY1_V1.learning.blocks[b - 1]?.introduce);
        expect(bt.slice(1).every((t) => t.introduceBefore.length === 0)).toBe(true);
        // every active letter appears in each block
        for (const ch of active.get(b) ?? []) expect(bt.some((t) => t.target === ch)).toBe(true);
      }
      expect(maxRun(l.map((t) => t.target))).toBeLessThanOrEqual(2);
      expect(l.every((t) => t.feedback && t.replayAllowed && !t.includeIdk)).toBe(true);
    }
  });
  it('no letter appears before its introduction', () => {
    const intro = introductionBlock(DAY1_V1);
    for (const seed of seeds) {
      for (const t of generateDay1Schedule(DAY1_V1, seed, true).filter((x) => x.phase === 'learning')) {
        expect(t.block).toBeGreaterThanOrEqual(intro[t.target] as number);
      }
    }
  });
  it('per-block exposure counts are identical for every participant', () => {
    const counts = (seed: string) => {
      const out: Record<string, number> = {};
      generateDay1Schedule(DAY1_V1, seed, false).filter((t) => t.phase === 'learning').forEach((t) => (out[`${t.block}${t.target}`] = (out[`${t.block}${t.target}`] ?? 0) + 1));
      return out;
    };
    const ref = counts('a');
    for (const seed of seeds) expect(counts(seed)).toEqual(ref);
    // documented totals: E11 T12 A9 N6 I6 M4
    const totals: Record<string, number> = {};
    Object.entries(ref).forEach(([k, v]) => (totals[k.slice(1)] = (totals[k.slice(1)] ?? 0) + v));
    expect(totals).toEqual({ E: 11, T: 12, A: 9, N: 6, I: 6, M: 4 });
  });
  it('balancing rule gives extra trials to fewest-exposed then newest letters', () => {
    expect(blockCounts(['E', 'T', 'A'], 8, { E: 4, T: 4 })).toEqual({ E: 2, T: 3, A: 3 });
    expect(blockCounts(['E', 'T'], 8, {})).toEqual({ E: 4, T: 4 });
  });
  it('final test has 24 trials, each letter four times, no feedback or replay', () => {
    for (const seed of seeds) {
      const f = generateDay1Schedule(DAY1_V1, seed, true).filter((t) => t.phase === 'final');
      expect(f).toHaveLength(24);
      for (const ch of DAY1_V1.characters) expect(f.filter((t) => t.target === ch)).toHaveLength(4);
      expect(f.every((t) => !t.feedback && !t.replayAllowed && t.includeIdk && t.options.length === 6)).toBe(true);
    }
  });
  it('positions are contiguous, keys unique, and prior exposure counts cumulative', () => {
    const s = generateDay1Schedule(DAY1_V1, 'p', true);
    expect(s.map((t) => t.position)).toEqual(s.map((_, i) => i + 1));
    expect(new Set(s.map((t) => t.trialKey)).size).toBe(s.length);
    const seen: Record<string, number> = {};
    for (const t of s) {
      expect(t.priorTargetPresentations).toBe(seen[t.target] ?? 0);
      if (t.phase !== 'final') seen[t.target] = (seen[t.target] ?? 0) + 1;
    }
  });
  it('retention schedule has 24 trials, four per letter', () => {
    const r = generateRetentionSchedule(RETENTION_V1, 'z');
    expect(r).toHaveLength(24);
    for (const ch of RETENTION_V1.characters) expect(r.filter((t) => t.target === ch)).toHaveLength(4);
  });
});

describe('State machine', () => {
  it('allows the Day-1 path and rejects shortcuts', () => {
    const path = ['consent_pending', 'audio_setup', 'baseline_screening', 'diagnostic', 'learning', 'profile_generation', 'final_assessment', 'completed'] as const;
    for (let i = 0; i < path.length - 1; i++) expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
    expect(canTransition('baseline_screening', 'learning')).toBe(true);
    expect(() => assertTransition('consent_pending', 'learning')).toThrow();
    expect(() => assertTransition('learning', 'final_assessment')).toThrow();
    expect(() => assertTransition('final_assessment', 'learning')).toThrow();
    expect(() => assertTransition('completed', 'learning')).toThrow();
    expect(canTransition('consent_pending', 'declined')).toBe(true);
    expect(telemetryAllowed('consent_pending')).toBe(false);
    expect(telemetryAllowed('learning')).toBe(true);
  });
});
