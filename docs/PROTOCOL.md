# Experiment protocol

The protocol is defined in code (`src/lib/protocol/protocols.ts`) and registered in the `protocols` table with a
SHA-256 content hash. A version string can never be reused for a different definition: `npm run db:migrate` (and
server start-up) refuses a mismatch. Every session stores the protocol version it started with and keeps it.

## day1-v1 — Learning six Morse code letters

| Stage | What happens | Recorded |
|---|---|---|
| Consent | Full consent text (`consent-v1`) with the configured researcher contact. Accept or decline. Nothing else is recorded before acceptance; declining stores only the decision. | `consent_records` (text hash, version, contact snapshot, decision, time) |
| Audio setup | "Enable audio" button unlocks the `AudioContext`; participant plays a test sound (letter **S**, `...`, not a study letter) and confirms they heard it, or reports a problem. | device class, browser, audio sample rate / base latency, test plays |
| Baseline | Slider 1–10 "How well do you already know Morse code?" (must be moved) **or** tick "I don't know any Morse code — skip the diagnostic". | `prior_knowledge_rating` (null if skipped), `baseline_status` = `tested` / `not_tested_self_reported_beginner` |
| Diagnostic (optional) | 12 trials: E T A N I M × 2, constrained random order, 6 options + "I don't know", **no feedback, no replay**. | trial rows, phase `diagnostic` |
| Learning | 48 trials in 6 blocks of 8 (below). Each new letter is introduced (pattern shown and playable) before the block. Replay before answering and replay on the feedback screen are allowed and counted. Corrective feedback after every answer. No IDK. **No adaptivity**: the schedule is fixed before trial 1. | trial rows, phase `learning` |
| Profile | The server freezes the knowledge profile from diagnostic + learning rows only (see ESTIMATOR.md). | `knowledge_profiles` |
| Final test | 24 trials: each letter × 4, constrained random order, 6 options + IDK, **no feedback, no replay, no reference chart**. | trial rows, phase `final` |
| Completion | Final score per letter is shown to the participant (measured results only, no estimator wording). Evaluation of profile vs test is stored separately. | `evaluations` |

A skipped diagnostic is **not** treated as zero knowledge: the profile records `not_tested_self_reported_beginner`
and the estimator uses no diagnostic evidence for that session.

### Learning blocks

| Block | Introduces | Options available | Trials |
|---|---|---|---|
| 1 | E, T | E T | 8 |
| 2 | A | E T A | 8 |
| 3 | N | E T A N | 8 |
| 4 | I | E T A N I | 8 |
| 5 | M | E T A N I M | 8 |
| 6 | — (consolidation) | E T A N I M | 8 |

Per-block counts: each active letter gets `floor(8 / k)`; remaining trials go one each to the active letters with
the fewest *scheduled* learning exposures so far, ties to the most recently introduced letter
(`fewest_scheduled_exposures_then_newest`). Diagnostic trials are excluded from this rule, so every participant gets
the same counts. Resulting totals: **E 11, T 12, A 9, N 6, I 6, M 4** (verified by unit test). These are unequal by
design (early letters are practised longer); analyses should account for exposure (`cumulative_target_exposures`).

Option buttons keep the canonical order E T A N I M so a letter's button never moves.

### Randomisation

* Algorithm `cyrb128-sfc32-fisher-yates-v1`: the session seed (128 random bits, stored) is hashed with cyrb128 into
  an sfc32 generator; Fisher–Yates shuffle.
* Each phase uses its own sub-generator (`<seed>:diagnostic`, `<seed>:learning`, `<seed>:final`), so the learning and
  final orders do not depend on whether the diagnostic was taken.
* Constraint: no letter more than **2 times in a row**, including across block boundaries. Rejection sampling (up to
  2000 attempts), then a deterministic greedy repair.
* The full schedule is generated once, when the baseline screen is submitted (whether the diagnostic is included
  depends on that answer), and stored in `trial_schedule`. It is never
  regenerated: reloads, resumes and new devices read the stored rows. The same `(protocol, seed, diagnostic choice)`
  always reproduces the same schedule (unit-tested).

### Audio and timing

| Parameter | day1-v1 |
|---|---|
| Speed | 15 WPM (unit = 1200 / 15 = 80 ms): dot 80 ms, dash 240 ms, intra-character gap 80 ms |
| Tone | 600 Hz sine, gain 0.5, 5 ms linear attack/release ramps |
| Lead-in | 250 ms between scheduling and the first tone |
| Answers | disabled until the oscillator's `ended` event (end of the signal) |
| Reaction time | `rt_ms` = response time − end of the **first** playback; `rt_from_last_playback_ms` also stored |
| Idle | 15 s without input starts an `idle_start` event |

All client times are `performance.now()` on the page's monotonic clock; wall-clock time is only used for
`client_submitted_epoch_ms` and server `received_at`. Signal durations: E 80, T 240, I 240, A 400, N 400, M 560 ms.

### Interruptions

| Situation | Handling | Flags |
|---|---|---|
| Page hidden during playback | stop audio, pause screen, restart the trial on return | `playback_interrupted`, `tab_hidden_during`, `presentation_number` + 1, `restarted` |
| Page hidden after playback, before answer | answer accepted | `tab_hidden_during`, `hidden_duration_ms` |
| Window blur (no hide) | answer accepted | `window_blurred_during`, `blur_duration_ms` |
| Reload or new device before answering | "Welcome back" gate, same trial replayed | `restarted`, `presentation_number` |
| Offline when answering | answer held locally and re-sent; inserted once | `save_retry` events |
| Implausible timing (e.g. answer before signal end) | answer stored | `invalid_timing`, `timing_flags` |

`interrupted` is true when any of these flags is set, so analyses can exclude or model those trials.

## retention-v1 — Delayed recognition check (off by default)

Offered only when switched on in Study configuration, to participants with a completed `day1-v1` session at least
20 hours earlier. Separate consent (`consent-retention-v1`), audio check, two screening questions (practice since
Day 1, and how), then 24 no-feedback trials (each letter × 4, IDK allowed). The evaluation compares the Day-1 frozen
profile with this test. It is tested in integration tests but has not been piloted.

## Changing the protocol

Never edit `DAY1_V1`. Add `DAY1_V2` with a new `version`, add it to `PROTOCOLS`, deploy, run `npm run db:migrate`,
and select it in Study configuration. Existing sessions keep `day1-v1`. If the estimator thresholds change, bump
`ESTIMATOR_VERSION` too (see ESTIMATOR.md). If the consent text changes, bump `consentVersion`.
