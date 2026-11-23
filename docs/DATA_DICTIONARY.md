# Data dictionary

_Generated from `src/lib/export/dictionary.ts`. Do not edit by hand._

## Conventions

- Identifiers are UUIDs and are consistent across every file, so tables join on participant_id, session_id, profile_id, (session_id, position).
- NULL / empty CSV field means "not applicable or not measured". It never means zero or incorrect.
- Server timestamps (created_at, received_at, …) are ISO 8601 in UTC, set by the database clock.
- Client times named *_ms are milliseconds on the page's monotonic clock (performance.now()) for one page load (client_load_id). They are only comparable within the same client_load_id. Add client_time_origin_epoch_ms to convert to Unix epoch ms.
- Durations are milliseconds unless the name says seconds/minutes/hours.
- Booleans are true/false. Arrays/objects are JSON text in CSV and nested values in JSON exports.
- Exports never contain email addresses, recovery codes or session tokens. display_name appears only when "include identifiers" is chosen.
- Test participants (is_test = true) are excluded unless "include test participants" is chosen.

## participants

One row per learner profile (research identity; credentials are stored separately and never exported).

| Field | Type / unit | Meaning |
|---|---|---|
| `participant_id` | uuid | Immutable internal participant identifier. |
| `public_code` | text | Short pseudonymous code (P-XXXXXX) shown in the dashboard. |
| `display_name` | text | Nickname chosen by the participant. Only with include identifiers. Not unique. |
| `status` | text | active \| disabled. |
| `is_test` | boolean | Marked by a researcher as a test/pilot account. |
| `adult_confirmed` | boolean | Participant confirmed they are 18+ at sign-up. |
| `created_at` | timestamp (ISO 8601, UTC) | Profile creation. |
| `last_active_at` | timestamp (ISO 8601, UTC) | Last authenticated activity. |

## sessions

One row per study attempt (experiment_sessions). Delayed sessions link to their Day-1 session via parent_session_id.

| Field | Type / unit | Meaning |
|---|---|---|
| `session_id` | uuid | Study attempt identifier. |
| `participant_id` | uuid | Owner. |
| `study_type` | text | day1_learning \| delayed_retention. |
| `protocol_version` | text | Protocol definition used (see protocols). |
| `parent_session_id` | uuid | For delayed_retention: the Day-1 session being followed up. NULL otherwise. |
| `seed` | text | Randomisation seed (hex). With the protocol version it reproduces trial_schedule. |
| `stage` | text | State machine stage: consent_pending, audio_setup, baseline_screening, diagnostic, learning, profile_generation, final_assessment, retention_screening, retention_test, completed, declined, withdrawn, abandoned. |
| `status` | text | in_progress \| completed \| declined \| withdrawn \| abandoned (derived from stage). |
| `created_at / consented_at / completed_at` | timestamp (ISO 8601, UTC) | Session creation, consent given, completion. |
| `duration_seconds` | numeric, s | completed_at − consented_at. NULL until completed. |
| `device_category` | text | mobile \| tablet \| desktop \| unknown (coarse, from user agent + touch). |
| `browser_family / os_family` | text | Coarse families, e.g. Safari / iOS. |
| `client_info` | json | Touch support, viewport, pixel ratio, audio sample rate and latencies, reduced-motion preference. |
| `baseline_status` | text | tested (diagnostic taken) \| not_tested_self_reported_beginner (diagnostic skipped). NULL before screening. |
| `prior_knowledge_rating` | integer 1–10 | Self-rated Morse knowledge (1 = none, 10 = expert). Ticking "I don't know any Morse code" records 1. |
| `skipped_diagnostic` | boolean | Participant ticked the skip box. |
| `retention_answers` | json | delayed_retention only: {"practicedSince": "no" \| "a_little" \| "a_lot"}. |
| `hours_since_parent` | float, hours | delayed_retention only: time from Day-1 completion to session creation. |
| `schedule_length / current_position` | integer | Number of scheduled trials; next position awaiting an answer (NULL when finished). |
| `resume_count` | integer | Page loads that resumed this session. |
| `end_reason` | text | consent_declined, participant_withdrew, marked_abandoned_by_researcher, or NULL. |
| `stage_history` | json | Array of {from, to, at} transitions. |

## consent_records

Immutable record of each consent decision.

| Field | Type / unit | Meaning |
|---|---|---|
| `consent_id` | uuid |  |
| `participant_id` | uuid |  |
| `session_id` | uuid |  |
| `consent_version` | text | consent-v1 (Day 1) or consent-retention-v1. |
| `protocol_version` | text | Protocol the consent covered. |
| `decision` | text | agreed \| declined. |
| `consent_text_sha256` | hex | SHA-256 of the exact consent document shown (canonical JSON). |
| `contact_snapshot` | json | Contact/retention text in force when consent was given. |
| `created_at` | timestamp (ISO 8601, UTC) |  |

## trial_schedule

The complete schedule generated for a session at screening time. Never regenerated or modified.

| Field | Type / unit | Meaning |
|---|---|---|
| `session_id` | uuid |  |
| `participant_id` | uuid |  |
| `position` | integer | 1-based position in the session (diagnostic, then learning, then final). |
| `trial_key` | text | `${phase}-${phase_index}`; unique within a session. |
| `phase` | text | diagnostic \| learning \| final \| retention. |
| `phase_index` | integer | 1-based index within the phase. |
| `block` | integer | Learning block 1–6; NULL outside learning. |
| `target` | text | Correct letter. |
| `pattern` | text | Morse pattern of target ("." dot, "-" dash). |
| `options` | json array | Response letters shown, in display order (canonical E T A N I M order filtered to the active set). |
| `include_idk` | boolean | "I don't know" offered. |
| `feedback` | boolean | Corrective feedback shown after answering. |
| `replay_allowed` | boolean | Participant could replay the signal before answering. |
| `introduce_before` | json array | Letters introduced immediately before this trial. |
| `prior_target_presentations` | integer | Diagnostic + learning trials of the same target scheduled earlier in the session. |

## trial_responses

One row per answered trial (immutable). Timing is captured on the client and latency derived on the server.

| Field | Type / unit | Meaning |
|---|---|---|
| `response_id` | uuid |  |
| `client_response_id` | uuid | Idempotency key generated by the client. |
| `session_id / participant_id / protocol_version` |  | Links. |
| `position, trial_key, phase, phase_index, block, target, pattern, options` |  | Copied from trial_schedule. |
| `option_count` | integer | Number of letter options (excluding "I don't know"). Chance level = 1/option_count. |
| `response` | text | Chosen letter; NULL when "I don't know". |
| `is_idk` | boolean | "I don't know" chosen. |
| `is_correct` | boolean | response = target (computed on the server). |
| `feedback_shown / hints_available / replay_allowed` | boolean | Conditions in force (hints are never available in day1-v1). |
| `replay_count` | integer | Participant-initiated replays before answering (0 where not allowed). |
| `prior_target_presentations` | integer | See trial_schedule. |
| `cumulative_target_exposures` | integer | Diagnostic + learning presentations of the target up to and including this trial (final/retention: prior presentations only). |
| `presentation_number` | integer | 1 normally; >1 when the trial was restarted (page reloaded or sound interrupted before an answer). |
| `client_load_id` | uuid | Page load that produced the answer (clock domain for *_ms fields). |
| `client_time_origin_epoch_ms` | float, epoch ms | performance.timeOrigin of that page load. |
| `trial_shown_ms` | float, ms (client monotonic) | Trial displayed (latest presentation). |
| `playback_requested_ms` | float, ms (client monotonic) | First playback requested. |
| `playback_start_est_ms` | float, ms (client monotonic) | Estimated time the first element reached the audio output (AudioContext.getOutputTimestamp, else scheduler estimate). |
| `playback_end_expected_ms` | float, ms (client monotonic) | playback_start_est_ms + signal_duration_ms. |
| `playback_end_observed_ms` | float, ms (client monotonic) | Oscillator `ended` event of the first playback (main-thread observation). NULL if not observed. |
| `signal_duration_ms` | float, ms | First element onset to last element offset. |
| `answers_enabled_ms` | float, ms (client monotonic) | Answer buttons enabled (after the first playback). |
| `response_ms` | float, ms (client monotonic) | Answer tapped/clicked. |
| `rt_ms` | float, ms | Response latency = response_ms − (playback_end_observed_ms, or expected end if not observed). Measured from the end of the FIRST playback in every phase. |
| `rt_from_last_playback_ms` | float, ms | response_ms − end of the most recent playback (differs from rt_ms when replays occurred). |
| `audio_output_latency_ms` | float, ms | AudioContext.outputLatency when reported. |
| `tab_hidden_during / hidden_duration_ms` | boolean / ms | Page hidden at any time during the trial and total hidden time. |
| `window_blurred_during / blur_duration_ms` | boolean / ms | Window lost focus during the trial and total time unfocused. |
| `playback_interrupted` | boolean | The signal was cut off by the page being hidden (the trial was then restarted). |
| `restarted` | boolean | presentation_number > 1. |
| `invalid_timing` | boolean | Timing cannot be trusted: answer before signal end, answer before trial shown, or no playback end available. |
| `interrupted` | boolean | Any of: hidden, blurred, playback interrupted, restarted, invalid timing. Use to include/exclude trials. |
| `timing_flags` | json array | Which conditions applied: tab_hidden, window_blurred, playback_interrupted, restarted, response_before_signal_end, response_before_trial_shown, no_observed_playback_end. |
| `client_submitted_epoch_ms` | float, epoch ms | Client wall clock when the answer was sent (Date.now()). |
| `received_at` | timestamp (ISO 8601, UTC) | Server receipt time. |

## behavioral_events

Task-relevant interaction events (only after consent). Ordered within a page load by seq.

| Field | Type / unit | Meaning |
|---|---|---|
| `event_id` | uuid | Client-generated; inserts are idempotent. |
| `session_id / participant_id` | uuid |  |
| `client_load_id` | uuid | Page load; seq restarts at 1 for each load. |
| `seq` | integer | Sequence number within the page load. |
| `type` | text | Event type (see list below). |
| `client_ms` | float, ms (client monotonic) | Event time on the page clock. |
| `client_epoch_ms` | float, epoch ms | timeOrigin + client_ms (approximate wall clock). |
| `trial_position` | integer | Schedule position the event belongs to, when applicable. |
| `screen` | text | Screen name (e.g. learning_trial, feedback, introduction, final_trial, audio_setup). |
| `payload` | json | Event-specific fields (flat; numbers, short strings, booleans). |
| `received_at` | timestamp (ISO 8601, UTC) |  |

## knowledge_profiles

Frozen pre-test knowledge profile, one per Day-1 session, created before the first final-test trial and immutable.

| Field | Type / unit | Meaning |
|---|---|---|
| `profile_id` | uuid |  |
| `session_id / participant_id` | uuid |  |
| `protocol_version / estimator_version` | text | e.g. day1-v1 / rules-v1. |
| `input_cutoff_position` | integer | Highest session position included (last learning trial). |
| `input_observations` | integer | Diagnostic + learning observations in the snapshot. |
| `input_sha256` | hex | SHA-256 of the canonical JSON input snapshot (audit). |
| `created_at` | timestamp (ISO 8601, UTC) | Freeze time (always earlier than the first final-test response). |
| `profile` | json | Estimator output: per-character metrics, category, rule, explanation, predicted final accuracy; summary. |
| `input_snapshot` | json | Exact estimator input (diagnostic + learning observations only). |

## knowledge_profile_characters

Flattened profile: one row per (profile, character). Derived from knowledge_profiles.profile.

| Field | Type / unit | Meaning |
|---|---|---|
| `category` | text | strong_evidence \| some_evidence \| uncertain_inconsistent \| little_evidence \| insufficient_evidence. |
| `rule` | text | Rule that fired (audit). |
| `learning_n / learning_correct / learning_accuracy` | int / int / 0–1 | Learning presentations, correct, correct/n (NULL if n = 0). |
| `wilson_lower / wilson_upper` | 0–1 | 95% Wilson score interval for learning accuracy. |
| `recent_n / recent_correct / recent_accuracy` |  | Last 3 learning observations (or fewer). |
| `chance_rate` | 0–1 | Mean of 1/option_count over the character's learning trials. |
| `chance_corrected_accuracy` | −∞–1 | (accuracy − chance_rate) / (1 − chance_rate). |
| `first_half_accuracy / second_half_accuracy / trend` |  | Halves of the character's learning trials (n ≥ 4); trend = improving/declining if they differ by ≥ 0.25. |
| `replay_total / replay_rate` |  | Replays before answering; replays per learning trial. |
| `median_rt_ms / median_rt_correct_ms` | ms | Median latency over non-interrupted trials (needs ≥ 2). |
| `top_confusion / top_confusion_count / confusions` |  | Most frequent wrong answer; all wrong answers by letter. |
| `diagnostic_*` |  | No-feedback diagnostic evidence; NULL when the diagnostic was skipped (never treated as wrong). |
| `predicted_final_accuracy` | 0–1 | Provisional prediction (see docs/ESTIMATOR.md). |
| `explanation` | text | Plain-language explanation generated from the metrics. |

## evaluations / evaluation_characters

Comparison of a frozen profile with the independent test (kind final_assessment) or a delayed test (kind retention). Stored separately; never modifies the profile.

| Field | Type / unit | Meaning |
|---|---|---|
| `predicted_accuracy` | 0–1 | From the frozen profile. |
| `observed_correct / observed_n / observed_accuracy / observed_idk` |  | Measured on the test (4 trials per letter in day1-v1). |
| `absolute_error` | 0–1 | \|predicted − observed accuracy\|. |
| `brier` | 0–1 | Mean (predicted − outcome)² over the letter's test trials. |
| `result.overall.spearman` | −1–1 | Rank correlation across letters for one participant (very imprecise; NULL with ties). |

## final_results

Per session × phase (final/retention) × character summary of measured test performance.

| Field | Type / unit | Meaning |
|---|---|---|
| `trials / correct / idk / interrupted / accuracy / median_rt_ms` |  | Counts and accuracy; median latency over non-interrupted trials. |

## protocols

Every protocol definition used, with its content hash. A version is never reused for different content.

| Field | Type / unit | Meaning |
|---|---|---|
| `definition` | json | Characters, audio parameters, diagnostic/learning/final settings, balancing and randomisation rules, timing policy, estimator version. |

## Event types

| Type | Definition |
|---|---|
| `experiment_started` | Telemetry began in this session for the first time (after consent). |
| `screen_enter` | A screen was shown. screen = its name. |
| `screen_exit` | A screen was left. payload: durationMs, mouseMoves (mouse pointer only), taps (touch/pen), clicks (mouse), taskClicks (on study controls), keyPresses (on study controls; key not recorded), idleMs, hiddenMs, eventsDroppedSoFar. |
| `audio_unlocked` | Audio was enabled by a tap/click. |
| `audio_test_played` | Sound-check sample (letter S, not a study letter) played. |
| `intro_shown` | Character introduction displayed. payload.characters. |
| `intro_played` | A character demonstration played. payload: character, automatic. |
| `trial_presented` | A trial was shown. payload.presentationNumber. |
| `trial_restarted` | A trial was shown again after an interruption or reload. |
| `audio_played` | First playback of the trial finished. payload: durationMs, scheduleToStartMs, endLagMs. |
| `audio_replayed` | Participant replayed the signal before answering. payload.replayNumber. |
| `playback_interrupted` | Playback stopped because the page was hidden. payload.during. |
| `answer_selected` | An answer was tapped. payload: response (letter or idk), replayCount. |
| `feedback_displayed` | Corrective feedback shown (learning). payload.correct. |
| `feedback_replayed` | Participant replayed the correct letter on the feedback screen. |
| `next_trial_requested` | Participant pressed Next after feedback. |
| `visibility_hidden` | Page became hidden (tab switch, screen lock, app switch). |
| `visibility_visible` | Page visible again. payload.hiddenMs. |
| `window_focus` | Window gained focus. |
| `window_blur` | Window lost focus. |
| `idle_start` | No pointer/touch/key/scroll activity for the idle threshold (15 s). payload.thresholdMs. |
| `idle_end` | Activity resumed. payload.idleMs (includes the threshold). |
| `session_paused` | Participant chose Exit / leave for now. |
| `session_resumed` | A page load resumed an in-progress session after consent. |
| `session_completed` | Completion screen reached. |
| `network_offline` | Browser reported offline. |
| `network_online` | Browser reported online. |
| `save_retry` | An answer could not be saved at first and is being retried. |
| `page_unload` | Page is being unloaded (pagehide). |

## Derived metric formulas

- Learning accuracy = correct / n over learning trials of a letter.
- Wilson 95% interval: centre = (p + z²/2n)/(1 + z²/n), half-width = z·√(p(1−p)/n + z²/4n²)/(1 + z²/n), z = 1.96.
- Chance rate = mean(1 / option_count) over the trials considered.
- Chance-corrected accuracy = (accuracy − chance) / (1 − chance).
- Predicted final accuracy (rules-v1) = k + (1 − k)/6, where k = clamp((p − c)/(1 − c), 0, 1), p = (correct + 1)/(n + 2) over the last 4 learning trials, c = their mean chance rate.
- rt_ms = response_ms − playback_end_observed_ms (fallback: playback_end_expected_ms).
- Brier = mean over test trials of (predicted − outcome)².
