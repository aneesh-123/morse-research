# Knowledge estimator (rules-v1)

Code: `src/lib/estimator/` (`config.ts` thresholds, `snapshot.ts` input boundary, `rules.ts` estimator,
`evaluate.ts` comparison with the test). Pure functions, no I/O; unit-tested in `tests/unit/estimator.test.ts`.

> **Status: provisional.** The thresholds below are a first, hand-chosen configuration. They have **not** been
> validated against data. The categories describe the **evidence** collected during learning, not a validated
> mastery state. The pilot is meant to produce the data needed to judge and revise them.

## When it runs and what it may see

1. After the 48th learning response the session moves to `profile_generation`.
2. `freezeProfile` (server, one transaction) selects the session's `diagnostic` and `learning` rows **only**,
   checks there are exactly 48 learning responses, and builds an `EstimatorSnapshot`. `buildEstimatorSnapshot`
   throws `SnapshotLeakError` if any other phase is passed in.
3. It stores, immutably, in `knowledge_profiles`: the snapshot itself, `input_sha256` (SHA-256 of the canonical
   JSON of the snapshot), the cutoff position, the number of observations, the estimator version and the profile.
4. Only then can the session enter `final_assessment`. The database refuses a final-test response for a session
   without a profile, and refuses a profile for a session that already has final-test responses. Profiles can never
   be updated.
5. After the final test, `evaluateSession` compares the profile with the test and writes a separate `evaluations`
   row. The profile is not changed. If that step was missed, researchers can compute the missing evaluation from
   the session page.

Anyone can recompute a profile from the stored snapshot and check it against `input_sha256`.

## Per-letter features (learning trials of that letter)

| Feature | Definition |
|---|---|
| `n`, `correct`, `accuracy` | count, correct count, correct / n |
| `wilson95` | Wilson score 95 % interval for accuracy (z = 1.96) |
| `recentAccuracy` | accuracy over the last 3 learning trials of the letter |
| `chanceRate` | mean of 1 / option count over the letter's trials (block 1 has 2 options → 50 %; block 5–6 → 16.7 %) |
| `chanceCorrectedAccuracy` | (accuracy − chance) / (1 − chance) |
| `firstHalfAccuracy`, `secondHalfAccuracy`, `trend` | split of the letter's trials in order; `improving`/`declining` when the halves differ by ≥ 25 points, `not_enough_data` below 4 trials |
| `replayTotal`, `trialsWithReplay`, `replayRate` | replays before answering |
| `latencyAll`, `latencyCorrect` | median / quartiles / range of `rt_ms` on non-interrupted trials (≥ 2 values, else null) |
| `interruptedTrials` | trials with any interruption flag |
| `confusions`, `topConfusion`, `errors` | wrong answers by the letter chosen |
| `diagnostic` | n, correct, IDK and confusions from the diagnostic, or `null` / `tested: false` if skipped |

Replays, latency and the diagnostic are **reported** and appear in explanations, but in rules-v1 they do not change
the category; only learning accuracy, recency and the interval do. This keeps the rules simple to audit and leaves
H2 (behavioural signals beyond correctness) to analysis.

## Categories (first matching rule wins)

| Category | Rule (rules-v1) |
|---|---|
| `insufficient_evidence` | n < 3 |
| `strong_evidence` | n ≥ 5, accuracy ≥ 80 %, last 3 all correct, Wilson lower bound > chance |
| `some_evidence` | n ≥ 3, accuracy ≥ 60 %, last 3 ≥ 2 correct, Wilson lower bound > chance |
| `little_evidence` | n ≥ 4 and (Wilson upper bound < 60 % or accuracy ≤ chance) |
| `insufficient_evidence` | otherwise, if n < 5 (mixed and too few) |
| `uncertain_inconsistent` | otherwise (mixed evidence with n ≥ 5) |

`insufficient_evidence` is kept distinct from `little_evidence`: "we did not see enough" is not "we saw poor
performance". Every profile stores which rule fired (`rule`) for auditing.

With the fixed day1-v1 schedule M gets 4 learning trials and N and I get 6, so M can never reach
`strong_evidence` (needs n ≥ 5). This is intended: the estimator should say when the evidence is thin.

## Explanations

Generated only from the features above, e.g.:

> Correct on 5 of 6 learning presentations (83%), including 3 of the last 3. Guessing alone would average about 19%
> on these trials, because fewer letters were available early on. All errors (1 of 1) chose A instead of N. Accuracy
> is high, the most recent answers were all correct, and the result is clearly above guessing.

A session summary sentence lists letters with strong or some evidence and how many had insufficient or mixed
evidence. Participants are not shown estimator wording; they see their measured test results.

## Predicted final-test accuracy (provisional)

For each letter: take the last 4 learning trials (`k`, `c` correct), Laplace-smooth `p = (c + 1) / (k + 2)`,
correct for guessing at the options available then (`known = (p − chance) / (1 − chance)`, clamped to 0–1), and
re-expand for the 6-option test: `predicted = known + (1 − known) × 1/6`. IDK on the test counts as incorrect. The
basis is stored in plain words (`predictionBasis`).

## Evaluation (`eval-v1`, stored separately)

Per letter: observed correct / n on the test, IDK count, absolute error |predicted − observed|, Brier score of the
predicted probability against each 0/1 outcome, observed confusions. Overall: accuracy, mean absolute error, Brier,
Spearman correlation between predicted and observed per-letter accuracy (6 letters, so very imprecise), accuracy
grouped by category, interrupted test trials, and caveats (e.g. interrupted trials, small n).

## Changing the estimator

Change thresholds only by adding a new config and a new `ESTIMATOR_VERSION` (e.g. `rules-v2`) and referencing it
from a new protocol version. Profiles already frozen keep the version and config they were built with (the config is
stored inside each profile). Offline re-analysis with alternative rules can be run on the exported snapshots
without touching the frozen profiles; the `analysis_results` table is reserved for storing such results.
