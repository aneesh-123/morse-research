import 'server-only';
import { q, q1 } from './db';
import type { KnowledgeProfileResult } from '../estimator/rules';
import type { EvaluationResult } from '../estimator/evaluate';

/** Read-only queries for the researcher dashboard. Callers must check researcher auth first. */

export interface OverviewStats {
  participants: number;
  sessions: number;
  completed: number;
  incomplete: number;
  declined: number;
  withdrawnOrAbandoned: number;
  day1Started: number;
  diagnosticSkipped: number;
  diagnosticTaken: number;
  avgCompletionMinutes: number | null;
  medianCompletionMinutes: number | null;
  finalCorrect: number;
  finalTotal: number;
  devices: { device: string; sessions: number; completed: number }[];
  protocols: { protocol: string; sessions: number; completed: number }[];
}

const TEST_FILTER = (includeTest: boolean, alias = 'p') => (includeTest ? 'true' : `NOT ${alias}.is_test`);

export async function overview(includeTest = false): Promise<OverviewStats> {
  const f = TEST_FILTER(includeTest);
  const base = await q1<Record<string, string | null>>(
    `SELECT
       (SELECT count(*) FROM participants p WHERE ${f})::text AS participants,
       count(s.*)::text AS sessions,
       count(*) FILTER (WHERE s.status = 'completed')::text AS completed,
       count(*) FILTER (WHERE s.status = 'in_progress')::text AS incomplete,
       count(*) FILTER (WHERE s.status = 'declined')::text AS declined,
       count(*) FILTER (WHERE s.status IN ('withdrawn','abandoned'))::text AS withdrawn,
       count(*) FILTER (WHERE s.study_type = 'day1_learning' AND s.baseline_status IS NOT NULL)::text AS day1_started,
       count(*) FILTER (WHERE s.baseline_status = 'not_tested_self_reported_beginner')::text AS skipped,
       count(*) FILTER (WHERE s.baseline_status = 'tested')::text AS taken,
       avg(extract(epoch FROM s.completed_at - s.consented_at) / 60) FILTER (WHERE s.status = 'completed' AND s.study_type = 'day1_learning')::text AS avg_min,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM s.completed_at - s.consented_at) / 60) FILTER (WHERE s.status = 'completed' AND s.study_type = 'day1_learning')::text AS med_min
     FROM experiment_sessions s JOIN participants p ON p.id = s.participant_id WHERE ${f}`,
  );
  const fin = await q1<{ c: string; n: string }>(
    `SELECT count(*) FILTER (WHERE r.is_correct)::text AS c, count(*)::text AS n
     FROM trial_responses r JOIN participants p ON p.id = r.participant_id WHERE r.phase = 'final' AND ${f}`,
  );
  const devices = await q<{ device: string; sessions: string; completed: string }>(
    `SELECT coalesce(s.device_category, 'not recorded') AS device, count(*)::text AS sessions, count(*) FILTER (WHERE s.status = 'completed')::text AS completed
     FROM experiment_sessions s JOIN participants p ON p.id = s.participant_id WHERE ${f} GROUP BY 1 ORDER BY 2 DESC`,
  );
  const protocols = await q<{ protocol: string; sessions: string; completed: string }>(
    `SELECT s.protocol_version AS protocol, count(*)::text AS sessions, count(*) FILTER (WHERE s.status = 'completed')::text AS completed
     FROM experiment_sessions s JOIN participants p ON p.id = s.participant_id WHERE ${f} GROUP BY 1 ORDER BY 1`,
  );
  const n = (k: string) => Number(base?.[k] ?? 0);
  const num = (k: string) => (base?.[k] == null ? null : Number(base[k]));
  return {
    participants: n('participants'),
    sessions: n('sessions'),
    completed: n('completed'),
    incomplete: n('incomplete'),
    declined: n('declined'),
    withdrawnOrAbandoned: n('withdrawn'),
    day1Started: n('day1_started'),
    diagnosticSkipped: n('skipped'),
    diagnosticTaken: n('taken'),
    avgCompletionMinutes: num('avg_min'),
    medianCompletionMinutes: num('med_min'),
    finalCorrect: Number(fin?.c ?? 0),
    finalTotal: Number(fin?.n ?? 0),
    devices: devices.map((d) => ({ device: d.device, sessions: Number(d.sessions), completed: Number(d.completed) })),
    protocols: protocols.map((d) => ({ protocol: d.protocol, sessions: Number(d.sessions), completed: Number(d.completed) })),
  };
}

export interface ParticipantListRow {
  id: string;
  public_code: string;
  display_name: string;
  is_test: boolean;
  created_at: Date;
  last_active_at: Date;
  sessions: number;
  completed: number;
  in_progress: number;
  last_participation: Date | null;
  prior_rating: number | null;
  baseline_status: string | null;
  final_correct: number | null;
  final_total: number | null;
  devices: string | null;
}

export async function listParticipants(filters: { search?: string; status?: string; device?: string; includeTest?: boolean }): Promise<ParticipantListRow[]> {
  const where: string[] = [TEST_FILTER(Boolean(filters.includeTest))];
  const params: unknown[] = [];
  if (filters.search) {
    params.push(`%${filters.search.toLowerCase()}%`);
    where.push(`(lower(p.public_code) LIKE $${params.length} OR lower(p.display_name) LIKE $${params.length} OR p.id::text LIKE $${params.length})`);
  }
  const rows = await q<ParticipantListRow & { sessions: string; completed: string; in_progress: string; final_correct: string | null; final_total: string | null }>(
    `SELECT p.id, p.public_code, p.display_name, p.is_test, p.created_at, p.last_active_at,
            count(s.id)::text AS sessions,
            count(s.id) FILTER (WHERE s.status = 'completed')::text AS completed,
            count(s.id) FILTER (WHERE s.status = 'in_progress')::text AS in_progress,
            max(s.last_activity_at) FILTER (WHERE s.consented_at IS NOT NULL) AS last_participation,
            (array_agg(s.prior_knowledge_rating ORDER BY s.created_at) FILTER (WHERE s.prior_knowledge_rating IS NOT NULL))[1] AS prior_rating,
            (array_agg(s.baseline_status ORDER BY s.created_at) FILTER (WHERE s.baseline_status IS NOT NULL))[1] AS baseline_status,
            (SELECT count(*) FILTER (WHERE r.is_correct) FROM trial_responses r WHERE r.participant_id = p.id AND r.phase = 'final')::text AS final_correct,
            (SELECT count(*) FROM trial_responses r WHERE r.participant_id = p.id AND r.phase = 'final')::text AS final_total,
            string_agg(DISTINCT s.device_category, ', ') AS devices
     FROM participants p LEFT JOIN experiment_sessions s ON s.participant_id = p.id
     WHERE ${where.join(' AND ')}
     GROUP BY p.id ORDER BY p.last_active_at DESC LIMIT 500`,
    params,
  );
  let out = rows.map((r) => ({
    ...r,
    sessions: Number(r.sessions),
    completed: Number(r.completed),
    in_progress: Number(r.in_progress),
    final_correct: r.final_total && Number(r.final_total) > 0 ? Number(r.final_correct) : null,
    final_total: r.final_total && Number(r.final_total) > 0 ? Number(r.final_total) : null,
  }));
  if (filters.status === 'completed') out = out.filter((r) => r.completed > 0);
  if (filters.status === 'in_progress') out = out.filter((r) => r.in_progress > 0);
  if (filters.status === 'no_session') out = out.filter((r) => r.sessions === 0);
  if (filters.device) out = out.filter((r) => (r.devices ?? '').includes(filters.device as string));
  return out;
}

export interface SessionRowFull {
  id: string; participant_id: string; study_type: string; protocol_version: string; parent_session_id: string | null; seed: string;
  stage: string; status: string; created_at: Date; consented_at: Date | null; completed_at: Date | null; last_activity_at: Date;
  device_category: string | null; browser_family: string | null; os_family: string | null; client_info: Record<string, unknown> | null;
  baseline_status: string | null; prior_knowledge_rating: number | null; skipped_diagnostic: boolean | null;
  retention_answers: Record<string, unknown> | null; hours_since_parent: number | null; schedule_length: number | null;
  current_position: number | null; resume_count: number; stage_history: { from: string; to: string; at: string }[]; end_reason: string | null;
}

export async function participantDetail(id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const p = await q1<{ id: string; public_code: string; display_name: string; status: string; is_test: boolean; created_at: Date; last_active_at: Date; has_email: boolean; email_verified: boolean }>(
    `SELECT p.*, (a.email IS NOT NULL) AS has_email, (a.email_verified_at IS NOT NULL) AS email_verified
     FROM participants p LEFT JOIN auth_identities a ON a.participant_id = p.id WHERE p.id = $1`,
    [id],
  );
  if (!p) return null;
  const sessions = await q<SessionRowFull>(`SELECT * FROM experiment_sessions WHERE participant_id = $1 ORDER BY created_at`, [id]);
  const consents = await q<{ session_id: string; consent_version: string; decision: string; created_at: Date }>(
    `SELECT session_id, consent_version, decision, created_at FROM consent_records WHERE participant_id = $1 ORDER BY created_at`, [id],
  );
  const summaries = await q<{ session_id: string; phase: string; c: string; n: string }>(
    `SELECT session_id, phase, count(*) FILTER (WHERE is_correct)::text AS c, count(*)::text AS n FROM trial_responses WHERE participant_id = $1 GROUP BY 1, 2`, [id],
  );
  return { participant: p, sessions, consents, summaries: summaries.map((s) => ({ ...s, c: Number(s.c), n: Number(s.n) })) };
}

export interface ResponseRow {
  position: number; trial_key: string; phase: string; phase_index: number; block: number | null; target: string; pattern: string;
  options: string[]; option_count: number; response: string | null; is_idk: boolean; is_correct: boolean; replay_count: number;
  rt_ms: number | null; rt_from_last_playback_ms: number | null; interrupted: boolean; invalid_timing: boolean; restarted: boolean;
  tab_hidden_during: boolean; window_blurred_during: boolean; playback_interrupted: boolean; hidden_duration_ms: number | null;
  cumulative_target_exposures: number; prior_target_presentations: number; presentation_number: number; timing_flags: string[];
  received_at: Date; signal_duration_ms: number; playback_end_observed_ms: number | null; playback_end_expected_ms: number | null;
}

export async function sessionDetail(id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const s = await q1<SessionRowFull & { public_code: string; display_name: string }>(
    `SELECT s.*, p.public_code, p.display_name FROM experiment_sessions s JOIN participants p ON p.id = s.participant_id WHERE s.id = $1`, [id],
  );
  if (!s) return null;
  const schedule = await q<{ position: number; trial_key: string; phase: string; block: number | null; target: string; introduce_before: string[]; options: string[] }>(
    `SELECT position, trial_key, phase, block, target, introduce_before, options FROM trial_schedule WHERE session_id = $1 ORDER BY position`, [id],
  );
  const responses = await q<ResponseRow>(
    `SELECT * FROM trial_responses WHERE session_id = $1 ORDER BY position`, [id],
  );
  const events = await q<{ id: string; seq: number; type: string; client_epoch_ms: number; client_ms: number; trial_position: number | null; screen: string | null; payload: Record<string, unknown>; client_load_id: string; received_at: Date }>(
    `SELECT id, seq, type, client_epoch_ms, client_ms, trial_position, screen, payload, client_load_id, received_at FROM behavioral_events WHERE session_id = $1 ORDER BY client_epoch_ms, seq`, [id],
  );
  const profileSession = s.study_type === 'day1_learning' ? s.id : s.parent_session_id;
  const profile = profileSession
    ? await q1<{ id: string; session_id: string; created_at: Date; estimator_version: string; protocol_version: string; input_cutoff_position: number; input_observations: number; input_sha256: string; profile: KnowledgeProfileResult }>(
        `SELECT id, session_id, created_at, estimator_version, protocol_version, input_cutoff_position, input_observations, input_sha256, profile FROM knowledge_profiles WHERE session_id = $1`, [profileSession],
      )
    : null;
  const evaluations = await q<{ id: string; kind: string; evaluation_version: string; created_at: Date; result: EvaluationResult }>(
    `SELECT id, kind, evaluation_version, created_at, result FROM evaluations WHERE session_id = $1 ORDER BY created_at`, [id],
  );
  const consent = await q1<{ consent_version: string; decision: string; created_at: Date; consent_text_sha256: string }>(
    `SELECT consent_version, decision, created_at, consent_text_sha256 FROM consent_records WHERE session_id = $1`, [id],
  );
  const children = await q<{ id: string; protocol_version: string; status: string; completed_at: Date | null }>(
    `SELECT id, protocol_version, status, completed_at FROM experiment_sessions WHERE parent_session_id = $1 ORDER BY created_at`, [id],
  );
  return { session: s, schedule, responses, events, profile, evaluations, consent, children };
}

export async function aggregate(includeTest = false) {
  const f = TEST_FILTER(includeTest);
  const confusion = await q<{ phase: string; target: string; response: string | null; n: string }>(
    `SELECT r.phase, r.target, CASE WHEN r.is_idk THEN '?' ELSE r.response END AS response, count(*)::text AS n
     FROM trial_responses r JOIN participants p ON p.id = r.participant_id WHERE ${f} GROUP BY 1, 2, 3`,
  );
  const byChar = await q<{ target: string; phase: string; c: string; n: string; median_rt: number | null; replays: string }>(
    `SELECT r.target, r.phase, count(*) FILTER (WHERE r.is_correct)::text AS c, count(*)::text AS n,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY r.rt_ms) FILTER (WHERE NOT r.interrupted AND r.rt_ms IS NOT NULL) AS median_rt,
            sum(r.replay_count)::text AS replays
     FROM trial_responses r JOIN participants p ON p.id = r.participant_id WHERE ${f} GROUP BY 1, 2`,
  );
  const byDevice = await q<{ device: string; phase: string; c: string; n: string; median_rt: number | null; interrupted: string }>(
    `SELECT coalesce(s.device_category, 'not recorded') AS device, r.phase, count(*) FILTER (WHERE r.is_correct)::text AS c, count(*)::text AS n,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY r.rt_ms) FILTER (WHERE NOT r.interrupted AND r.rt_ms IS NOT NULL) AS median_rt,
            count(*) FILTER (WHERE r.interrupted)::text AS interrupted
     FROM trial_responses r JOIN experiment_sessions s ON s.id = r.session_id JOIN participants p ON p.id = r.participant_id WHERE ${f} GROUP BY 1, 2 ORDER BY 1, 2`,
  );
  const learningCurve = await q<{ phase_index: number; c: string; n: string }>(
    `SELECT r.phase_index, count(*) FILTER (WHERE r.is_correct)::text AS c, count(*)::text AS n
     FROM trial_responses r JOIN participants p ON p.id = r.participant_id WHERE r.phase = 'learning' AND ${f} GROUP BY 1 ORDER BY 1`,
  );
  const evals = await q<{ session_id: string; protocol_version: string; kind: string; result: EvaluationResult; estimator_version: string; device: string | null }>(
    `SELECT e.session_id, s.protocol_version, e.kind, e.result, k.estimator_version, s.device_category AS device
     FROM evaluations e JOIN experiment_sessions s ON s.id = e.session_id JOIN knowledge_profiles k ON k.id = e.profile_id
     JOIN participants p ON p.id = s.participant_id WHERE ${f} ORDER BY e.created_at`,
  );
  const behaviour = await q<{ type: string; n: string; sessions: string }>(
    `SELECT e.type, count(*)::text AS n, count(DISTINCT e.session_id)::text AS sessions
     FROM behavioral_events e JOIN participants p ON p.id = e.participant_id WHERE ${f} GROUP BY 1 ORDER BY 2 DESC`,
  );
  const prior = await q<{ rating: number; baseline: string; sessions: string; final_c: string; final_n: string; learn_c: string; learn_n: string }>(
    `SELECT s.prior_knowledge_rating AS rating, s.baseline_status AS baseline, count(DISTINCT s.id)::text AS sessions,
            count(r.*) FILTER (WHERE r.phase = 'final' AND r.is_correct)::text AS final_c, count(r.*) FILTER (WHERE r.phase = 'final')::text AS final_n,
            count(r.*) FILTER (WHERE r.phase = 'learning' AND r.is_correct)::text AS learn_c, count(r.*) FILTER (WHERE r.phase = 'learning')::text AS learn_n
     FROM experiment_sessions s JOIN participants p ON p.id = s.participant_id LEFT JOIN trial_responses r ON r.session_id = s.id
     WHERE s.prior_knowledge_rating IS NOT NULL AND ${f} GROUP BY 1, 2 ORDER BY 1, 2`,
  );
  const readiness = await q1<{ completed: string; participants: string; profiled: string; evaluated: string; with_diagnostic: string; skipped_diagnostic: string; with_events: string; clean_final: string; devices: string }>(
    `SELECT count(*)::text AS completed,
            count(DISTINCT s.participant_id)::text AS participants,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM knowledge_profiles k WHERE k.session_id = s.id))::text AS profiled,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM evaluations e WHERE e.session_id = s.id))::text AS evaluated,
            count(*) FILTER (WHERE s.baseline_status = 'tested')::text AS with_diagnostic,
            count(*) FILTER (WHERE s.baseline_status = 'not_tested_self_reported_beginner')::text AS skipped_diagnostic,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM behavioral_events b WHERE b.session_id = s.id))::text AS with_events,
            count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM trial_responses r WHERE r.session_id = s.id AND r.phase = 'final' AND r.interrupted))::text AS clean_final,
            count(DISTINCT s.device_category)::text AS devices
     FROM experiment_sessions s JOIN participants p ON p.id = s.participant_id
     WHERE s.study_type = 'day1_learning' AND s.stage = 'completed' AND ${f}`,
  );
  return { confusion, byChar, byDevice, learningCurve, evals, behaviour, prior, readiness };
}
