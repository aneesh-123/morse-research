import { CATEGORY_LABELS, RULES_V1, type EstimatorConfig, type EvidenceCategory } from './config';
import type { EstimatorObservation, EstimatorSnapshot } from './snapshot';

/**
 * Transparent rule-based knowledge estimator (rules-v1).
 *
 * Input: an EstimatorSnapshot (diagnostic + learning observations only).
 * Output: per-character metrics, an evidence category, a plain-language explanation built only
 * from the metrics, and a provisional predicted accuracy for the final recognition test.
 * The categories describe the *evidence*, not a validated mastery state.
 */

export interface Interval { lower: number; upper: number }

export interface LatencySummary { n: number; medianMs: number; q1Ms: number; q3Ms: number; minMs: number; maxMs: number }

export interface CharacterEstimate {
  character: string;
  introducedBlock: number | null;
  learning: {
    n: number;
    correct: number;
    accuracy: number | null;
    wilson95: Interval | null;
    recentN: number;
    recentCorrect: number;
    recentAccuracy: number | null;
    /** Mean of 1/optionCount over this character's learning trials: accuracy expected from pure guessing. */
    chanceRate: number | null;
    /** (accuracy - chance) / (1 - chance); null when undefined. */
    chanceCorrectedAccuracy: number | null;
    firstHalfAccuracy: number | null;
    secondHalfAccuracy: number | null;
    trend: 'improving' | 'declining' | 'stable' | 'not_enough_data';
    replayTotal: number;
    trialsWithReplay: number;
    replayRate: number | null;
    latencyAll: LatencySummary | null;
    latencyCorrect: LatencySummary | null;
    interruptedTrials: number;
    /** Wrong answers by chosen letter. */
    confusions: Record<string, number>;
    topConfusion: { character: string; count: number } | null;
    errors: number;
  };
  diagnostic: { tested: boolean; n: number; correct: number; idk: number; confusions: Record<string, number> } | null;
  category: EvidenceCategory;
  categoryLabel: string;
  /** Which rule fired, for auditing. */
  rule: string;
  explanation: string;
  /** Provisional prediction of the share of final-test trials answered correctly. */
  predictedFinalAccuracy: number | null;
  predictionBasis: string;
}

export interface KnowledgeProfileResult {
  estimatorVersion: string;
  config: EstimatorConfig;
  characters: CharacterEstimate[];
  summary: {
    baselineStatus: string;
    priorKnowledgeRating: number | null;
    learningTrials: number;
    learningCorrect: number;
    learningAccuracy: number | null;
    diagnosticTrials: number;
    diagnosticCorrect: number | null;
    interruptedLearningTrials: number;
    categoryCounts: Record<EvidenceCategory, number>;
    notes: string[];
    text: string;
  };
}

export function wilsonInterval(successes: number, n: number, z = 1.96): Interval | null {
  if (n <= 0) return null;
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { lower: Math.max(0, centre - half), upper: Math.min(1, centre + half) };
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return (sorted[lo] as number) + ((sorted[hi] as number) - (sorted[lo] as number)) * (pos - lo);
}

export function latencySummary(values: number[], minN: number): LatencySummary | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length < minN || v.length === 0) return null;
  return {
    n: v.length,
    medianMs: Math.round(quantile(v, 0.5)),
    q1Ms: Math.round(quantile(v, 0.25)),
    q3Ms: Math.round(quantile(v, 0.75)),
    minMs: Math.round(v[0] as number),
    maxMs: Math.round(v[v.length - 1] as number),
  };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const acc = (c: number, n: number) => (n > 0 ? c / n : null);

function countBy<T>(xs: T[], key: (x: T) => string | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of xs) {
    const k = key(x);
    if (k !== null) out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

function classify(m: CharacterEstimate['learning'], cfg: EstimatorConfig): { category: EvidenceCategory; rule: string } {
  const n = m.n;
  const chance = m.chanceRate ?? 0;
  if (n < cfg.minObservations) return { category: 'insufficient_evidence', rule: `n<${cfg.minObservations}` };
  const a = m.accuracy ?? 0;
  const r = m.recentAccuracy ?? 0;
  const lb = m.wilson95?.lower ?? 0;
  const ub = m.wilson95?.upper ?? 1;
  const s = cfg.strong;
  if (n >= s.minN && a >= s.minAccuracy && r >= s.minRecentAccuracy - 1e-9 && (!s.requireLowerBoundAboveChance || lb > chance)) {
    return { category: 'strong_evidence', rule: 'strong' };
  }
  const so = cfg.some;
  if (n >= so.minN && a >= so.minAccuracy && r >= so.minRecentAccuracy - 1e-9 && (!so.requireLowerBoundAboveChance || lb > chance)) {
    return { category: 'some_evidence', rule: 'some' };
  }
  if (n >= cfg.little.minN && (ub < cfg.little.maxWilsonUpper || a <= chance)) {
    return { category: 'little_evidence', rule: ub < cfg.little.maxWilsonUpper ? 'little:upper_bound' : 'little:at_or_below_chance' };
  }
  if (n < cfg.minObservationsForInconsistent) return { category: 'insufficient_evidence', rule: `mixed_and_n<${cfg.minObservationsForInconsistent}` };
  return { category: 'uncertain_inconsistent', rule: 'fallthrough_inconsistent' };
}

function explain(ch: string, m: CharacterEstimate['learning'], d: CharacterEstimate['diagnostic'], category: EvidenceCategory, rule: string, cfg: EstimatorConfig): string {
  const parts: string[] = [];
  if (m.n === 0) {
    parts.push(`${ch} was not presented during learning, so there are no learning observations.`);
  } else {
    let s = `Correct on ${m.correct} of ${m.n} learning presentation${m.n === 1 ? '' : 's'} (${pct(m.accuracy ?? 0)})`;
    if (m.n > m.recentN) s += `, including ${m.recentCorrect} of the last ${m.recentN}`;
    s += '.';
    parts.push(s);
    if (m.chanceRate !== null) parts.push(`Guessing alone would average about ${pct(m.chanceRate)} on these trials, because fewer letters were available early on.`);
    if (m.topConfusion && m.errors > 0) {
      parts.push(`${m.topConfusion.count === m.errors ? 'All' : 'Most'} errors (${m.topConfusion.count} of ${m.errors}) chose ${m.topConfusion.character} instead of ${ch}.`);
    } else if (m.errors === 0) {
      parts.push('No errors were made.');
    }
    if (m.trend === 'improving' && m.firstHalfAccuracy !== null && m.secondHalfAccuracy !== null) {
      parts.push(`Accuracy rose from ${pct(m.firstHalfAccuracy)} in the first half of its trials to ${pct(m.secondHalfAccuracy)} in the second half.`);
    } else if (m.trend === 'declining' && m.firstHalfAccuracy !== null && m.secondHalfAccuracy !== null) {
      parts.push(`Accuracy fell from ${pct(m.firstHalfAccuracy)} in the first half of its trials to ${pct(m.secondHalfAccuracy)} in the second half.`);
    }
    if (m.interruptedTrials > 0) parts.push(`${m.interruptedTrials} of these trials were interrupted (page hidden, focus lost or restarted).`);
  }
  if (d?.tested) {
    parts.push(`Before learning, the no-feedback diagnostic had ${d.correct} of ${d.n} correct${d.idk ? ` and ${d.idk} "I don't know"` : ''}.`);
  }
  switch (category) {
    case 'strong_evidence':
      parts.push('Accuracy is high, the most recent answers were all correct, and the result is clearly above guessing.');
      break;
    case 'some_evidence':
      parts.push('Accuracy is above guessing and recent answers are mostly correct, but the evidence is not yet consistent enough to be called strong.');
      break;
    case 'little_evidence':
      parts.push('With this many observations, the accuracy range stays low, so there is little evidence that this letter was recognised during learning.');
      break;
    case 'uncertain_inconsistent':
      parts.push('Results are mixed, so the evidence does not point clearly either way.');
      break;
    case 'insufficient_evidence':
      parts.push(
        rule.startsWith('n<')
          ? `Only ${m.n} observation${m.n === 1 ? ' was' : 's were'} available, fewer than the ${cfg.minObservations} required for any classification.`
          : `Only ${m.n} observations were available and they were mixed, which is not enough for a reliable classification.`,
      );
      break;
  }
  return parts.join(' ');
}

function estimateCharacter(ch: string, obs: EstimatorObservation[], snap: EstimatorSnapshot, cfg: EstimatorConfig): CharacterEstimate {
  const learning = obs.filter((o) => o.phase === 'learning' && o.target === ch);
  const diag = obs.filter((o) => o.phase === 'diagnostic' && o.target === ch);
  const n = learning.length;
  const correct = learning.filter((o) => o.correct).length;
  const recent = learning.slice(-cfg.recentWindow);
  const recentCorrect = recent.filter((o) => o.correct).length;
  const chanceRate = n ? learning.reduce((s, o) => s + 1 / o.optionCount, 0) / n : null;
  const accuracy = acc(correct, n);
  const half = Math.floor(n / 2);
  const firstHalf = n >= 4 ? learning.slice(0, half) : [];
  const secondHalf = n >= 4 ? learning.slice(n - half) : [];
  const fh = firstHalf.length ? acc(firstHalf.filter((o) => o.correct).length, firstHalf.length) : null;
  const sh = secondHalf.length ? acc(secondHalf.filter((o) => o.correct).length, secondHalf.length) : null;
  let trend: CharacterEstimate['learning']['trend'] = 'not_enough_data';
  if (fh !== null && sh !== null) trend = sh - fh >= 0.25 ? 'improving' : fh - sh >= 0.25 ? 'declining' : 'stable';
  const wrong = learning.filter((o) => !o.correct);
  const confusions = countBy(wrong, (o) => o.response);
  const top = Object.entries(confusions).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const valid = learning.filter((o) => !o.interrupted && o.rtMs !== null);

  const m: CharacterEstimate['learning'] = {
    n,
    correct,
    accuracy,
    wilson95: wilsonInterval(correct, n, cfg.wilsonZ),
    recentN: recent.length,
    recentCorrect,
    recentAccuracy: acc(recentCorrect, recent.length),
    chanceRate,
    chanceCorrectedAccuracy: accuracy !== null && chanceRate !== null && chanceRate < 1 ? (accuracy - chanceRate) / (1 - chanceRate) : null,
    firstHalfAccuracy: fh,
    secondHalfAccuracy: sh,
    trend,
    replayTotal: learning.reduce((s, o) => s + o.replayCount, 0),
    trialsWithReplay: learning.filter((o) => o.replayCount > 0).length,
    replayRate: n ? learning.reduce((s, o) => s + o.replayCount, 0) / n : null,
    latencyAll: latencySummary(valid.map((o) => o.rtMs as number), cfg.minLatencySamples),
    latencyCorrect: latencySummary(valid.filter((o) => o.correct).map((o) => o.rtMs as number), cfg.minLatencySamples),
    interruptedTrials: learning.filter((o) => o.interrupted).length,
    confusions,
    topConfusion: top ? { character: top[0], count: top[1] } : null,
    errors: wrong.length,
  };

  const d: CharacterEstimate['diagnostic'] =
    snap.baselineStatus === 'tested'
      ? {
          tested: true,
          n: diag.length,
          correct: diag.filter((o) => o.correct).length,
          idk: diag.filter((o) => o.idk).length,
          confusions: countBy(diag.filter((o) => !o.correct && !o.idk), (o) => o.response),
        }
      : null;

  const { category, rule } = classify(m, cfg);

  // Provisional prediction: Laplace-smoothed accuracy over the last `predictionWindow` learning
  // trials, corrected for guessing at the options available then, then re-expanded for 6 options.
  let predicted: number | null = null;
  let basis = 'No learning observations; no prediction.';
  if (n > 0) {
    const w = learning.slice(-cfg.predictionWindow);
    const k = w.length;
    const c = w.filter((o) => o.correct).length;
    const p = (c + 1) / (k + 2);
    const chanceW = w.reduce((s, o) => s + 1 / o.optionCount, 0) / k;
    const known = chanceW < 1 ? Math.min(1, Math.max(0, (p - chanceW) / (1 - chanceW))) : 0;
    predicted = known + (1 - known) * cfg.finalGuessRate;
    basis = `Last ${k} learning trials: ${c}/${k} correct, smoothed to ${pct(p)}, guess-corrected for ${pct(chanceW)} chance, re-expanded with a ${pct(cfg.finalGuessRate)} guess rate.`;
  }

  return {
    character: ch,
    introducedBlock: snap.introductionBlock[ch] ?? null,
    learning: m,
    diagnostic: d,
    category,
    categoryLabel: CATEGORY_LABELS[category],
    rule,
    explanation: explain(ch, m, d, category, rule, cfg),
    predictedFinalAccuracy: predicted,
    predictionBasis: basis,
  };
}

export function estimateKnowledge(snap: EstimatorSnapshot, cfg: EstimatorConfig = RULES_V1): KnowledgeProfileResult {
  const obs = snap.observations;
  const characters = snap.characters.map((ch) => estimateCharacter(ch, obs, snap, cfg));
  const learning = obs.filter((o) => o.phase === 'learning');
  const diag = obs.filter((o) => o.phase === 'diagnostic');
  const categoryCounts = Object.fromEntries(Object.keys(CATEGORY_LABELS).map((k) => [k, 0])) as Record<EvidenceCategory, number>;
  characters.forEach((c) => categoryCounts[c.category]++);
  const notes: string[] = [];
  if (snap.baselineStatus === 'not_tested_self_reported_beginner') {
    notes.push('The diagnostic was skipped after the participant reported knowing no Morse code. Prior knowledge was not measured and is not assumed to be zero.');
  }
  const later = characters.filter((c) => (c.introducedBlock ?? 0) >= 4).map((c) => c.character);
  if (later.length) notes.push(`Letters introduced later (${later.join(', ')}) had fewer learning trials by design; compare letters with their exposure counts in mind.`);
  const interrupted = learning.filter((o) => o.interrupted).length;
  if (interrupted) notes.push(`${interrupted} learning trial(s) were interrupted; their latencies are excluded from latency summaries.`);
  notes.push('Evidence categories come from provisional rule thresholds (rules-v1) that have not been empirically validated.');

  const strongSome = characters.filter((c) => c.category === 'strong_evidence' || c.category === 'some_evidence').map((c) => c.character);
  const learningCorrect = learning.filter((o) => o.correct).length;
  const text =
    `${learningCorrect} of ${learning.length} learning trials correct. ` +
    (strongSome.length ? `Evidence of recognition for ${strongSome.join(', ')}. ` : 'No letter reached the threshold for evidence of recognition. ') +
    (categoryCounts.insufficient_evidence ? `${categoryCounts.insufficient_evidence} letter(s) had insufficient evidence. ` : '') +
    (categoryCounts.uncertain_inconsistent ? `${categoryCounts.uncertain_inconsistent} letter(s) had mixed evidence.` : '');

  return {
    estimatorVersion: cfg.version,
    config: cfg,
    characters,
    summary: {
      baselineStatus: snap.baselineStatus,
      priorKnowledgeRating: snap.priorKnowledgeRating,
      learningTrials: learning.length,
      learningCorrect,
      learningAccuracy: acc(learningCorrect, learning.length),
      diagnosticTrials: diag.length,
      diagnosticCorrect: snap.baselineStatus === 'tested' ? diag.filter((o) => o.correct).length : null,
      interruptedLearningTrials: interrupted,
      categoryCounts,
      notes,
      text: text.trim(),
    },
  };
}
