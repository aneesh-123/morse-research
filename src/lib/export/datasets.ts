import 'server-only';
import { q } from '../server/db';
import type { KnowledgeProfileResult } from '../estimator/rules';
import type { EvaluationResult } from '../estimator/evaluate';

/**
 * Research export datasets. Authentication data (emails, recovery codes, sessions, tokens) is never
 * exported. Display names are excluded unless `includeIdentifiers` is set explicitly.
 */

export const DATASETS = [
  'participants', 'sessions', 'consent_records', 'trial_schedule', 'trial_responses', 'behavioral_events',
  'knowledge_profiles', 'knowledge_profile_characters', 'evaluations', 'evaluation_characters', 'final_results', 'protocols',
] as const;
export type Dataset = (typeof DATASETS)[number];

export interface ExportOptions { includeIdentifiers?: boolean; includeTest?: boolean; participantId?: string }

type Row = Record<string, unknown>;

function scope(o: ExportOptions, alias = 'p'): { where: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  if (!o.includeTest) parts.push(`NOT ${alias}.is_test`);
  if (o.participantId) {
    params.push(o.participantId);
    parts.push(`${alias}.id = $${params.length}`);
  }
  return { where: parts.length ? parts.join(' AND ') : 'true', params };
}

export async function dataset(name: Dataset, o: ExportOptions = {}): Promise<Row[]> {
  const s = scope(o);
  switch (name) {
    case 'participants':
      return q(
        `SELECT p.id AS participant_id, p.public_code, ${o.includeIdentifiers ? 'p.display_name,' : ''} p.status, p.is_test, p.adult_confirmed,
                p.created_at, p.last_active_at
         FROM participants p WHERE ${s.where} ORDER BY p.created_at`, s.params,
      );
    case 'sessions':
      return q(
        `SELECT s.id AS session_id, s.participant_id, s.study_type, s.protocol_version, s.parent_session_id, s.seed, s.stage, s.status,
                s.created_at, s.consented_at, s.completed_at, s.last_activity_at,
                round(extract(epoch FROM s.completed_at - s.consented_at)::numeric, 3) AS duration_seconds,
                s.device_category, s.browser_family, s.os_family, s.client_info, s.baseline_status, s.prior_knowledge_rating,
                s.skipped_diagnostic, s.retention_answers, s.hours_since_parent, s.schedule_length, s.current_position, s.resume_count,
                s.end_reason, s.stage_history, p.is_test
         FROM experiment_sessions s JOIN participants p ON p.id = s.participant_id WHERE ${s.where} ORDER BY s.created_at`, s.params,
      );
    case 'consent_records':
      return q(
        `SELECT c.id AS consent_id, c.participant_id, c.session_id, c.consent_version, c.protocol_version, c.decision, c.consent_text_sha256,
                c.contact_snapshot, c.created_at
         FROM consent_records c JOIN participants p ON p.id = c.participant_id WHERE ${s.where} ORDER BY c.created_at`, s.params,
      );
    case 'trial_schedule':
      return q(
        `SELECT t.session_id, es.participant_id, t.position, t.trial_key, t.phase, t.phase_index, t.block, t.target, t.pattern, t.options,
                t.include_idk, t.feedback, t.replay_allowed, t.introduce_before, t.prior_target_presentations
         FROM trial_schedule t JOIN experiment_sessions es ON es.id = t.session_id JOIN participants p ON p.id = es.participant_id
         WHERE ${s.where} ORDER BY t.session_id, t.position`, s.params,
      );
    case 'trial_responses':
      return q(
        `SELECT r.id AS response_id, r.client_response_id, r.session_id, r.participant_id, r.protocol_version, r.position, r.trial_key, r.phase,
                r.phase_index, r.block, r.target, r.pattern, r.options, r.option_count, r.response, r.is_idk, r.is_correct, r.feedback_shown,
                r.hints_available, r.replay_allowed, r.replay_count, r.prior_target_presentations, r.cumulative_target_exposures,
                r.presentation_number, r.client_load_id, r.client_time_origin_epoch_ms, r.trial_shown_ms, r.playback_requested_ms,
                r.playback_start_est_ms, r.playback_end_expected_ms, r.playback_end_observed_ms, r.signal_duration_ms, r.answers_enabled_ms,
                r.response_ms, r.rt_ms, r.rt_from_last_playback_ms, r.audio_output_latency_ms, r.tab_hidden_during, r.hidden_duration_ms,
                r.window_blurred_during, r.blur_duration_ms, r.playback_interrupted, r.restarted, r.invalid_timing, r.interrupted,
                r.timing_flags, r.client_submitted_epoch_ms, r.received_at
         FROM trial_responses r JOIN participants p ON p.id = r.participant_id WHERE ${s.where} ORDER BY r.session_id, r.position`, s.params,
      );
    case 'behavioral_events':
      return q(
        `SELECT e.id AS event_id, e.session_id, e.participant_id, e.client_load_id, e.seq, e.type, e.client_ms, e.client_epoch_ms,
                e.trial_position, e.screen, e.payload, e.received_at
         FROM behavioral_events e JOIN participants p ON p.id = e.participant_id WHERE ${s.where}
         ORDER BY e.session_id, e.client_epoch_ms, e.client_load_id, e.seq`, s.params,
      );
    case 'knowledge_profiles':
      return q(
        `SELECT k.id AS profile_id, k.session_id, k.participant_id, k.protocol_version, k.estimator_version, k.input_cutoff_position,
                k.input_observations, k.input_sha256, k.created_at, k.profile, k.input_snapshot
         FROM knowledge_profiles k JOIN participants p ON p.id = k.participant_id WHERE ${s.where} ORDER BY k.created_at`, s.params,
      );
    case 'knowledge_profile_characters': {
      const rows = await dataset('knowledge_profiles', o);
      return rows.flatMap((r) => {
        const prof = r.profile as KnowledgeProfileResult;
        return prof.characters.map((c) => ({
          profile_id: r.profile_id, session_id: r.session_id, participant_id: r.participant_id, estimator_version: r.estimator_version,
          created_at: r.created_at, character: c.character, introduced_block: c.introducedBlock, category: c.category, rule: c.rule,
          learning_n: c.learning.n, learning_correct: c.learning.correct, learning_accuracy: c.learning.accuracy,
          wilson_lower: c.learning.wilson95?.lower ?? null, wilson_upper: c.learning.wilson95?.upper ?? null,
          recent_n: c.learning.recentN, recent_correct: c.learning.recentCorrect, recent_accuracy: c.learning.recentAccuracy,
          chance_rate: c.learning.chanceRate, chance_corrected_accuracy: c.learning.chanceCorrectedAccuracy,
          first_half_accuracy: c.learning.firstHalfAccuracy, second_half_accuracy: c.learning.secondHalfAccuracy, trend: c.learning.trend,
          replay_total: c.learning.replayTotal, replay_rate: c.learning.replayRate, median_rt_ms: c.learning.latencyAll?.medianMs ?? null,
          median_rt_correct_ms: c.learning.latencyCorrect?.medianMs ?? null, interrupted_trials: c.learning.interruptedTrials,
          top_confusion: c.learning.topConfusion?.character ?? null, top_confusion_count: c.learning.topConfusion?.count ?? null,
          confusions: c.learning.confusions, diagnostic_tested: c.diagnostic?.tested ?? false, diagnostic_n: c.diagnostic?.n ?? null,
          diagnostic_correct: c.diagnostic?.correct ?? null, diagnostic_idk: c.diagnostic?.idk ?? null,
          predicted_final_accuracy: c.predictedFinalAccuracy, explanation: c.explanation,
        }));
      });
    }
    case 'evaluations':
      return q(
        `SELECT e.id AS evaluation_id, e.session_id, es.participant_id, e.profile_id, e.kind, e.evaluation_version, e.created_at, e.result
         FROM evaluations e JOIN experiment_sessions es ON es.id = e.session_id JOIN participants p ON p.id = es.participant_id
         WHERE ${s.where} ORDER BY e.created_at`, s.params,
      );
    case 'evaluation_characters': {
      const rows = await dataset('evaluations', o);
      return rows.flatMap((r) => (r.result as EvaluationResult).characters.map((c) => ({
        evaluation_id: r.evaluation_id, session_id: r.session_id, participant_id: r.participant_id, profile_id: r.profile_id, kind: r.kind,
        character: c.character, category: c.category, predicted_accuracy: c.predictedAccuracy, observed_correct: c.observedCorrect,
        observed_n: c.observedN, observed_accuracy: c.observedAccuracy, observed_idk: c.observedIdk, absolute_error: c.absoluteError,
        brier: c.brier, observed_confusions: c.observedConfusions,
      })));
    }
    case 'final_results':
      return q(
        `SELECT r.session_id, r.participant_id, r.phase, r.target AS character, count(*) AS trials, count(*) FILTER (WHERE r.is_correct) AS correct,
                count(*) FILTER (WHERE r.is_idk) AS idk, count(*) FILTER (WHERE r.interrupted) AS interrupted,
                round(avg(r.is_correct::int)::numeric, 4) AS accuracy,
                percentile_cont(0.5) WITHIN GROUP (ORDER BY r.rt_ms) FILTER (WHERE NOT r.interrupted AND r.rt_ms IS NOT NULL) AS median_rt_ms
         FROM trial_responses r JOIN participants p ON p.id = r.participant_id
         WHERE r.phase IN ('final', 'retention') AND ${s.where} GROUP BY 1, 2, 3, 4 ORDER BY 1, 4`, s.params,
      );
    case 'protocols':
      return q(`SELECT version, study_type, definition_sha256, created_at, definition FROM protocols ORDER BY version`);
  }
}
