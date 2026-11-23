import { describe, expect, it } from 'vitest';
import { buildEstimatorSnapshot, canonicalJson, SnapshotLeakError, type SnapshotSourceRow } from '@/lib/estimator/snapshot';
import { estimateKnowledge, latencySummary, wilsonInterval } from '@/lib/estimator/rules';
import { evaluateProfile, spearman } from '@/lib/estimator/evaluate';
import { DAY1_V1, introductionBlock } from '@/lib/protocol/protocols';
import { generateDay1Schedule } from '@/lib/protocol/schedule';
import { RULES_V1 } from '@/lib/estimator/config';

type Answer = (target: string, options: string[], i: number) => string | null;

function rowsFor(answer: Answer, includeDiagnostic = false, seed = 'seed'): SnapshotSourceRow[] {
  return generateDay1Schedule(DAY1_V1, seed, includeDiagnostic)
    .filter((t) => t.phase !== 'final')
    .map((t, i) => {
      const r = answer(t.target, t.options, i);
      return {
        phase: t.phase, position: t.position, phase_index: t.phaseIndex, block: t.block, target: t.target,
        response: r, is_idk: r === null, is_correct: r === t.target, option_count: t.options.length,
        rt_ms: 600 + i, replay_count: 0, interrupted: false,
      };
    });
}

function snap(rows: SnapshotSourceRow[], tested = false) {
  return buildEstimatorSnapshot({
    protocolVersion: DAY1_V1.version, estimatorVersion: RULES_V1.version, characters: DAY1_V1.characters,
    introductionBlock: introductionBlock(DAY1_V1), baselineStatus: tested ? 'tested' : 'not_tested_self_reported_beginner',
    priorKnowledgeRating: 1, rows,
  });
}

const perfect: Answer = (t) => t;
const alwaysWrong: Answer = (t, opts) => opts.find((o) => o !== t) ?? null;

describe('Statistics helpers', () => {
  it('wilson interval', () => {
    expect(wilsonInterval(0, 0)).toBeNull();
    const w = wilsonInterval(5, 8)!;
    expect(w.lower).toBeCloseTo(0.3057, 3);
    expect(w.upper).toBeCloseTo(0.8632, 3);
  });
  it('latency summary requires minimum samples and ignores non-finite', () => {
    expect(latencySummary([100], 2)).toBeNull();
    expect(latencySummary([100, 300, 200, NaN], 2)).toMatchObject({ n: 3, medianMs: 200, minMs: 100, maxMs: 300 });
  });
  it('spearman', () => {
    expect(spearman([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
    expect(spearman([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1);
    expect(spearman([1, 1, 1], [1, 2, 3])).toBeNull();
  });
});

describe('Snapshot boundary (leakage prevention)', () => {
  it('refuses final-test or retention rows', () => {
    const rows = rowsFor(perfect);
    expect(() => snap([...rows, { ...rows[0]!, phase: 'final' }])).toThrow(SnapshotLeakError);
    expect(() => snap([...rows, { ...rows[0]!, phase: 'retention' }])).toThrow(SnapshotLeakError);
  });
  it('refuses diagnostic rows when the diagnostic was recorded as skipped', () => {
    expect(() => snap(rowsFor(perfect, true), false)).toThrow();
  });
  it('canonical JSON is key-order independent', () => {
    expect(canonicalJson({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe(canonicalJson({ a: [1, { c: 3, d: 2 }], b: 1 }));
  });
  it('estimation is deterministic for identical snapshots', () => {
    const s = snap(rowsFor(perfect));
    expect(estimateKnowledge(s)).toEqual(estimateKnowledge(JSON.parse(JSON.stringify(s))));
  });
});

describe('Evidence classification (rules-v1)', () => {
  it('perfect learner: strong for well-exposed letters, never invented evidence', () => {
    const p = estimateKnowledge(snap(rowsFor(perfect)));
    const by = Object.fromEntries(p.characters.map((c) => [c.character, c]));
    expect(by.E!.category).toBe('strong_evidence');
    expect(by.T!.category).toBe('strong_evidence');
    expect(by.A!.category).toBe('strong_evidence');
    // M has only 4 learning trials: cannot be "strong" (needs 5)
    expect(by.M!.learning.n).toBe(4);
    expect(by.M!.category).not.toBe('strong_evidence');
    expect(by.E!.explanation).toContain('Correct on 11 of 11');
    expect(by.E!.explanation).toContain('No errors were made');
    expect(p.summary.notes.join(' ')).toContain('not assumed to be zero');
  });
  it('always-wrong learner: little evidence, not insufficient; confusions reported', () => {
    const p = estimateKnowledge(snap(rowsFor(alwaysWrong)));
    for (const c of p.characters) {
      expect(c.category).toBe('little_evidence');
      expect(c.learning.correct).toBe(0);
      expect(c.learning.topConfusion).not.toBeNull();
    }
    const e = p.characters.find((c) => c.character === 'E')!;
    expect(e.explanation).toMatch(/All errors \(11 of 11\) chose [A-Z] instead of E/);
  });
  it('separates insufficient evidence from poor performance', () => {
    // Only two observations of M, both wrong -> insufficient, not little evidence
    const rows = rowsFor(perfect);
    const mIdx = rows.map((r, i) => (r.target === 'M' ? i : -1)).filter((i) => i >= 0);
    const trimmed = rows.filter((_, i) => !mIdx.slice(2).includes(i)).map((r) => (r.target === 'M' ? { ...r, response: 'I', is_correct: false } : r));
    const m = estimateKnowledge(snap(trimmed)).characters.find((c) => c.character === 'M')!;
    expect(m.learning.n).toBe(2);
    expect(m.category).toBe('insufficient_evidence');
    expect(m.explanation).toContain('Only 2 observations were available');
  });
  it('mixed results with many observations are uncertain/inconsistent', () => {
    let k = 0;
    const p = estimateKnowledge(snap(rowsFor((t, opts) => (t === 'T' ? (k++ % 2 === 0 ? t : opts.find((o) => o !== t)!) : t))));
    const t = p.characters.find((c) => c.character === 'T')!;
    expect(t.learning.n).toBe(12);
    expect(t.category).toBe('uncertain_inconsistent');
  });
  it('a letter never presented is insufficient with no prediction', () => {
    const rows = rowsFor(perfect).filter((r) => r.target !== 'M');
    const m = estimateKnowledge(snap(rows)).characters.find((c) => c.character === 'M')!;
    expect(m.category).toBe('insufficient_evidence');
    expect(m.predictedFinalAccuracy).toBeNull();
    expect(m.learning.accuracy).toBeNull();
  });
  it('uses diagnostic evidence only as reported context', () => {
    const p = estimateKnowledge(snap(rowsFor(perfect, true), true));
    const e = p.characters.find((c) => c.character === 'E')!;
    expect(e.diagnostic).toMatchObject({ tested: true, n: 2, correct: 2 });
    expect(e.explanation).toContain('diagnostic had 2 of 2 correct');
    expect(p.summary.diagnosticTrials).toBe(12);
  });
  it('missing data stays null, not zero', () => {
    const rows = rowsFor(perfect).map((r) => ({ ...r, rt_ms: null }));
    const p = estimateKnowledge(snap(rows));
    expect(p.characters[0]!.learning.latencyAll).toBeNull();
    expect(p.summary.diagnosticCorrect).toBeNull();
  });
  it('interrupted trials are excluded from latency but counted', () => {
    const rows = rowsFor(perfect).map((r, i) => ({ ...r, interrupted: i === 0, rt_ms: i === 0 ? 99999 : r.rt_ms }));
    const p = estimateKnowledge(snap(rows));
    const first = p.characters.find((c) => c.character === rows[0]!.target)!;
    expect(first.learning.interruptedTrials).toBe(1);
    expect(first.learning.latencyAll!.maxMs).toBeLessThan(99999);
  });
});

describe('Evaluation against final test', () => {
  it('compares predictions to observed results without modifying the profile', () => {
    const profile = estimateKnowledge(snap(rowsFor(perfect)));
    const frozen = JSON.stringify(profile);
    const final = generateDay1Schedule(DAY1_V1, 'seed', false).filter((t) => t.phase === 'final')
      .map((t) => ({ target: t.target, response: t.target === 'M' ? 'I' : t.target, idk: false, correct: t.target !== 'M', interrupted: false }));
    const ev = evaluateProfile(profile, final);
    expect(JSON.stringify(profile)).toBe(frozen);
    expect(ev.overall.observedN).toBe(24);
    expect(ev.overall.observedCorrect).toBe(20);
    const m = ev.characters.find((c) => c.character === 'M')!;
    expect(m.observedAccuracy).toBe(0);
    expect(m.observedConfusions).toEqual({ I: 4 });
    expect(ev.caveats.length).toBeGreaterThan(0);
  });
});
