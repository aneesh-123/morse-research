import type { EvidenceCategory } from './config';
import type { KnowledgeProfileResult } from './rules';

/**
 * Compares a frozen profile with independent final-test (or retention-test) responses.
 * Runs only after the test is complete and is stored separately; it never modifies the profile.
 */

export interface TestResponse { target: string; response: string | null; idk: boolean; correct: boolean; interrupted: boolean }

export interface CharacterEvaluation {
  character: string;
  category: EvidenceCategory;
  predictedAccuracy: number | null;
  observedCorrect: number;
  observedN: number;
  observedAccuracy: number | null;
  observedIdk: number;
  absoluteError: number | null;
  /** Mean squared error of the predicted probability against each 0/1 outcome. */
  brier: number | null;
  observedConfusions: Record<string, number>;
}

export interface EvaluationResult {
  evaluationVersion: 'eval-v1';
  characters: CharacterEvaluation[];
  overall: {
    observedCorrect: number;
    observedN: number;
    observedAccuracy: number | null;
    meanAbsoluteError: number | null;
    brier: number | null;
    /** Spearman rank correlation between predicted and observed per-letter accuracy (6 letters: very imprecise). */
    spearman: number | null;
    byCategory: Record<string, { letters: number; observedCorrect: number; observedN: number; observedAccuracy: number | null }>;
    interruptedTrials: number;
  };
  caveats: string[];
}

function ranks(xs: number[]): number[] {
  const idx = xs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const r = new Array<number>(xs.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && (idx[j + 1] as { v: number }).v === (idx[i] as { v: number }).v) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[(idx[k] as { i: number }).i] = avg;
    i = j + 1;
  }
  return r;
}

export function spearman(a: number[], b: number[]): number | null {
  if (a.length !== b.length || a.length < 3) return null;
  const ra = ranks(a), rb = ranks(b);
  const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;
  const ma = mean(ra), mb = mean(rb);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < ra.length; i++) {
    const x = (ra[i] as number) - ma, y = (rb[i] as number) - mb;
    num += x * y; da += x * x; db += y * y;
  }
  if (da === 0 || db === 0) return null;
  return num / Math.sqrt(da * db);
}

export function evaluateProfile(profile: KnowledgeProfileResult, responses: readonly TestResponse[]): EvaluationResult {
  const characters: CharacterEvaluation[] = profile.characters.map((c) => {
    const rs = responses.filter((r) => r.target === c.character);
    const correct = rs.filter((r) => r.correct).length;
    const obsAcc = rs.length ? correct / rs.length : null;
    const p = c.predictedFinalAccuracy;
    const confusions: Record<string, number> = {};
    rs.filter((r) => !r.correct && !r.idk && r.response).forEach((r) => (confusions[r.response as string] = (confusions[r.response as string] ?? 0) + 1));
    return {
      character: c.character,
      category: c.category,
      predictedAccuracy: p,
      observedCorrect: correct,
      observedN: rs.length,
      observedAccuracy: obsAcc,
      observedIdk: rs.filter((r) => r.idk).length,
      absoluteError: p !== null && obsAcc !== null ? Math.abs(p - obsAcc) : null,
      brier: p !== null && rs.length ? rs.reduce((s, r) => s + (p - (r.correct ? 1 : 0)) ** 2, 0) / rs.length : null,
      observedConfusions: confusions,
    };
  });
  const withPred = characters.filter((c) => c.predictedAccuracy !== null && c.observedAccuracy !== null);
  const total = responses.length;
  const totalCorrect = responses.filter((r) => r.correct).length;
  const byCategory: EvaluationResult['overall']['byCategory'] = {};
  for (const c of characters) {
    const b = (byCategory[c.category] ??= { letters: 0, observedCorrect: 0, observedN: 0, observedAccuracy: null });
    b.letters++; b.observedCorrect += c.observedCorrect; b.observedN += c.observedN;
  }
  Object.values(byCategory).forEach((b) => (b.observedAccuracy = b.observedN ? b.observedCorrect / b.observedN : null));
  const brierTrials = characters.filter((c) => c.brier !== null);
  const brierN = brierTrials.reduce((s, c) => s + c.observedN, 0);
  return {
    evaluationVersion: 'eval-v1',
    characters,
    overall: {
      observedCorrect: totalCorrect,
      observedN: total,
      observedAccuracy: total ? totalCorrect / total : null,
      meanAbsoluteError: withPred.length ? withPred.reduce((s, c) => s + (c.absoluteError as number), 0) / withPred.length : null,
      brier: brierN ? brierTrials.reduce((s, c) => s + (c.brier as number) * c.observedN, 0) / brierN : null,
      spearman: spearman(withPred.map((c) => c.predictedAccuracy as number), withPred.map((c) => c.observedAccuracy as number)),
      byCategory,
      interruptedTrials: responses.filter((r) => r.interrupted).length,
    },
    caveats: [
      'Each letter has only a few test trials, so per-letter observed accuracy is imprecise. 4/4 is not proof of durable mastery and 0/4 is not proof of no knowledge.',
      'A single participant gives at most six letter-level comparisons; rank correlations from one person are very noisy.',
      'This comparison describes one pilot participant and is not a validated finding.',
    ],
  };
}
