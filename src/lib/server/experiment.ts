import 'server-only';
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { q, q1, tx, pool, type Db } from './db';
import { AppError, touchParticipant } from './participants';
import { generateSeed, sha256 } from './crypto';
import { getSettings } from './settings';
import { log } from './log';
import { env } from './env';
import { ensureProtocols } from '../protocol/registry';
import { getDay1Protocol, getProtocol, introductionBlock } from '../protocol/protocols';
import { generateDay1Schedule, generateRetentionSchedule } from '../protocol/schedule';
import { assertTransition, isTerminal, PHASE_STAGE, telemetryAllowed, type Stage } from '../protocol/state-machine';
import { consentFor, contactConfigured } from '../protocol/consent';
import type { Phase, Protocol, ScheduledTrial, StudyType } from '../protocol/types';
import type {
  ClientTrial, CompletionSummary, LearningFeedback, ParticipantOverview, ParticipantSessionSummary, SessionState, SubmitResult,
} from '../protocol/api-types';
import { buildEstimatorSnapshot, canonicalJson, type SnapshotSourceRow } from '../estimator/snapshot';
import { estimateKnowledge, type KnowledgeProfileResult } from '../estimator/rules';
import { evaluateProfile } from '../estimator/evaluate';
import { RULES_V1 } from '../estimator/config';
import { EVENT_TYPES } from '../protocol/events';

// ------------------------------------------------------------------------------------------ types

interface SessionRow {
  id: string;
  participant_id: string;
  study_type: StudyType;
  protocol_version: string;
  parent_session_id: string | null;
  seed: string;
  stage: Stage;
  status: string;
  created_at: Date;
  consented_at: Date | null;
  completed_at: Date | null;
  last_activity_at: Date;
  baseline_status: string | null;
  prior_knowledge_rating: number | null;
  skipped_diagnostic: boolean | null;
  hours_since_parent: number | null;
  current_position: number | null;
  schedule_length: number | null;
}

interface ScheduleRow {
  session_id: string;
  position: number;
  trial_key: string;
  phase: Phase;
  phase_index: number;
  block: number | null;
  target: string;
  pattern: string;
  options: string[];
  include_idk: boolean;
  feedback: boolean;
  replay_allowed: boolean;
  introduce_before: string[];
  prior_target_presentations: number;
}

let protocolsReady = false;
async function ready(): Promise<void> {
  if (protocolsReady) return;
  await ensureProtocols(pool());
  protocolsReady = true;
}

// ------------------------------------------------------------------------------------------ helpers

async function loadOwnedSession(db: Db, participantId: string, sessionId: string, forUpdate = false): Promise<SessionRow> {
  if (!z.string().uuid().safeParse(sessionId).success) throw new AppError(404, 'not_found', 'Session not found');
  const s = await q1<SessionRow>(
    `SELECT * FROM experiment_sessions WHERE id = $1 AND participant_id = $2 ${forUpdate ? 'FOR UPDATE' : ''}`,
    [sessionId, participantId],
    db,
  );
  // Same response whether the session does not exist or belongs to someone else.
  if (!s) throw new AppError(404, 'not_found', 'Session not found');
  return s;
}

async function transition(db: Db, s: SessionRow, to: Stage, reason?: string): Promise<void> {
  assertTransition(s.stage, to);
  await db.query(
    `UPDATE experiment_sessions
       SET stage = $2,
           completed_at = CASE WHEN $2 = 'completed' THEN now() ELSE completed_at END,
           end_reason = coalesce($3, end_reason),
           last_activity_at = now(),
           stage_history = stage_history || jsonb_build_array(jsonb_build_object('from', $4::text, 'to', $2::text, 'at', now()))
     WHERE id = $1`,
    [s.id, to, reason ?? null, s.stage],
  );
  s.stage = to;
}

function requireStage(s: SessionRow, ...stages: Stage[]): void {
  if (!stages.includes(s.stage)) {
    throw new AppError(409, 'wrong_stage', `This step is not available now (session is at "${s.stage}").`);
  }
}

async function scheduleRows(db: Db, sessionId: string): Promise<ScheduleRow[]> {
  return q<ScheduleRow>(`SELECT * FROM trial_schedule WHERE session_id = $1 ORDER BY position`, [sessionId], db);
}

async function insertSchedule(db: Db, sessionId: string, trials: ScheduledTrial[]): Promise<void> {
  await db.query(
    `INSERT INTO trial_schedule (session_id, position, trial_key, phase, phase_index, block, target, pattern, options,
                                 include_idk, feedback, replay_allowed, introduce_before, prior_target_presentations)
     SELECT $1, x.position, x.trial_key, x.phase, x.phase_index, x.block, x.target, x.pattern, x.options,
            x.include_idk, x.feedback, x.replay_allowed, x.introduce_before, x.prior_target_presentations
     FROM jsonb_to_recordset($2::jsonb) AS x(position int, trial_key text, phase text, phase_index int, block int, target text,
          pattern text, options jsonb, include_idk boolean, feedback boolean, replay_allowed boolean, introduce_before jsonb,
          prior_target_presentations int)`,
    [
      sessionId,
      JSON.stringify(
        trials.map((t) => ({
          position: t.position, trial_key: t.trialKey, phase: t.phase, phase_index: t.phaseIndex, block: t.block, target: t.target,
          pattern: t.pattern, options: t.options, include_idk: t.includeIdk, feedback: t.feedback, replay_allowed: t.replayAllowed,
          introduce_before: t.introduceBefore, prior_target_presentations: t.priorTargetPresentations,
        })),
      ),
    ],
  );
  await db.query(`UPDATE experiment_sessions SET schedule_length = $2, current_position = 1 WHERE id = $1`, [sessionId, trials.length]);
}

function toClientTrial(row: ScheduleRow, all: ScheduleRow[], p: Protocol): ClientTrial {
  const samePhase = all.filter((r) => r.phase === row.phase);
  const blocks = row.phase === 'learning' && p.studyType === 'day1_learning' ? p.learning.blocks.length : null;
  return {
    position: row.position,
    trialKey: row.trial_key,
    phase: row.phase,
    phaseIndex: row.phase_index,
    phaseTotal: samePhase.length,
    block: row.block,
    blockCount: blocks,
    pattern: row.pattern,
    options: row.options,
    includeIdk: row.include_idk,
    feedback: row.feedback,
    replayAllowed: row.replay_allowed,
    introduce: row.introduce_before.map((c) => ({ character: c, pattern: all.find((r) => r.target === c)?.pattern ?? '' })),
  };
}

async function completionSummary(db: Db, s: SessionRow): Promise<CompletionSummary> {
  const rows = await q<{ phase: Phase; target: string; is_correct: boolean }>(
    `SELECT phase, target, is_correct FROM trial_responses WHERE session_id = $1`, [s.id], db,
  );
  const testPhase: Phase = s.study_type === 'day1_learning' ? 'final' : 'retention';
  const p = getProtocol(s.protocol_version);
  const learning = rows.filter((r) => r.phase === 'learning');
  const test = rows.filter((r) => r.phase === testPhase);
  const dur = s.consented_at && s.completed_at ? (new Date(s.completed_at).getTime() - new Date(s.consented_at).getTime()) / 60000 : null;
  return {
    studyType: s.study_type,
    learning: s.study_type === 'day1_learning' ? { correct: learning.filter((r) => r.is_correct).length, total: learning.length } : null,
    test: {
      correct: test.filter((r) => r.is_correct).length,
      total: test.length,
      perCharacter: p.characters.map((c) => ({
        character: c,
        correct: test.filter((r) => r.target === c && r.is_correct).length,
        total: test.filter((r) => r.target === c).length,
      })),
    },
    durationMinutes: dur === null ? null : Math.round(dur * 10) / 10,
  };
}

// ------------------------------------------------------------------------------------------ overview / start

function summarize(r: SessionRow): ParticipantSessionSummary {
  return {
    sessionId: r.id,
    studyType: r.study_type,
    protocolVersion: r.protocol_version,
    stage: r.stage,
    status: r.status,
    createdAt: new Date(r.created_at).toISOString(),
    completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : null,
    lastActivityAt: new Date(r.last_activity_at).toISOString(),
  };
}

export async function participantOverview(participantId: string): Promise<ParticipantOverview> {
  const p = await q1<{ display_name: string; public_code: string; email: string | null; email_verified_at: Date | null }>(
    `SELECT p.display_name, p.public_code, a.email, a.email_verified_at
     FROM participants p LEFT JOIN auth_identities a ON a.participant_id = p.id WHERE p.id = $1`,
    [participantId],
  );
  if (!p) throw new AppError(404, 'not_found', 'Participant not found');
  const sessions = await q<SessionRow>(`SELECT * FROM experiment_sessions WHERE participant_id = $1 ORDER BY created_at DESC`, [participantId]);
  const settings = await getSettings();
  const elig = await eligibility(participantId, sessions, settings);
  const incomplete = sessions.find((s) => !isTerminal(s.stage));
  const participated = sessions.filter((s) => s.consented_at).map((s) => new Date(s.last_activity_at).getTime());
  return {
    displayName: p.display_name,
    publicCode: p.public_code,
    email: p.email,
    emailVerified: Boolean(p.email_verified_at),
    emailAvailable: env.emailEnabled,
    sessions: sessions.map(summarize),
    lastParticipation: participated.length ? new Date(Math.max(...participated)).toISOString() : null,
    incompleteSession: incomplete ? summarize(incomplete) : null,
    available: elig.available,
    upcoming: elig.upcoming,
    enrollmentMessage: elig.message,
  };
}

type Settings = Awaited<ReturnType<typeof getSettings>>;

async function eligibility(participantId: string, sessions: SessionRow[], settings: Settings) {
  const available: ParticipantOverview['available'] = [];
  const upcoming: ParticipantOverview['upcoming'] = [];
  let message: string | null = null;
  const open = settings.enrollmentOpen && (contactConfigured(settings.contact) || !env.isProduction);
  if (!open) message = 'The study is not accepting new sessions right now. Please check back later.';
  const hasActive = sessions.some((s) => !isTerminal(s.stage));
  const completedDay1 = sessions.filter((s) => s.study_type === 'day1_learning' && s.stage === 'completed');
  if (open && !hasActive && completedDay1.length === 0) {
    const d1 = getProtocol(settings.activeDay1Protocol);
    available.push({ studyType: 'day1_learning', protocolVersion: d1.version, title: d1.title, minutes: d1.targetDurationMinutes });
  }
  if (open && settings.retentionEnabled) {
    const rp = getProtocol(settings.activeRetentionProtocol);
    if (rp.studyType === 'delayed_retention') {
      for (const parent of completedDay1.filter((s) => s.protocol_version === rp.parentProtocolVersion)) {
        const done = sessions.some((s) => s.parent_session_id === parent.id && s.protocol_version === rp.version && ['completed', 'in_progress'].includes(s.status));
        if (done || !parent.completed_at) continue;
        const at = new Date(new Date(parent.completed_at).getTime() + rp.minHoursAfterParent * 3600_000);
        if (at.getTime() <= Date.now()) {
          if (!hasActive) available.push({ studyType: 'delayed_retention', protocolVersion: rp.version, title: rp.title, minutes: rp.targetDurationMinutes });
        } else upcoming.push({ studyType: 'delayed_retention', title: rp.title, availableAt: at.toISOString() });
      }
    }
  }
  return { available, upcoming, message };
}

/** Returns the participant's in-progress session of this type, or creates one if eligible. Idempotent. */
export async function startSession(participantId: string, studyType: StudyType): Promise<{ sessionId: string; created: boolean }> {
  await ready();
  const existing = await q1<{ id: string }>(
    `SELECT id FROM experiment_sessions WHERE participant_id = $1 AND study_type = $2 AND status = 'in_progress'`,
    [participantId, studyType],
  );
  if (existing) return { sessionId: existing.id, created: false };
  const settings = await getSettings();
  const sessions = await q<SessionRow>(`SELECT * FROM experiment_sessions WHERE participant_id = $1`, [participantId]);
  const elig = await eligibility(participantId, sessions, settings);
  const offer = elig.available.find((a) => a.studyType === studyType);
  if (!offer) throw new AppError(409, 'not_eligible', elig.message ?? 'This session is not available for your profile right now.');
  let parentId: string | null = null;
  let hoursSince: number | null = null;
  if (studyType === 'delayed_retention') {
    const rp = getProtocol(offer.protocolVersion);
    if (rp.studyType !== 'delayed_retention') throw new Error('bad retention protocol');
    const parent = sessions
      .filter((s) => s.study_type === 'day1_learning' && s.stage === 'completed' && s.protocol_version === rp.parentProtocolVersion)
      .sort((a, b) => new Date(b.completed_at as Date).getTime() - new Date(a.completed_at as Date).getTime())[0];
    if (!parent) throw new AppError(409, 'not_eligible', 'No completed first session found.');
    parentId = parent.id;
    hoursSince = (Date.now() - new Date(parent.completed_at as Date).getTime()) / 3600_000;
  }
  try {
    const row = await q1<{ id: string }>(
      `INSERT INTO experiment_sessions (participant_id, study_type, protocol_version, parent_session_id, seed, stage, hours_since_parent, stage_history)
       VALUES ($1, $2, $3, $4, $5, 'consent_pending', $6, jsonb_build_array(jsonb_build_object('from', 'created', 'to', 'consent_pending', 'at', now())))
       RETURNING id`,
      [participantId, studyType, offer.protocolVersion, parentId, generateSeed(), hoursSince],
    );
    await touchParticipant(participantId);
    return { sessionId: (row as { id: string }).id, created: true };
  } catch (e) {
    // Unique index on one active session per type: a concurrent double-click lands here.
    if ((e as { code?: string }).code === '23505') {
      const again = await q1<{ id: string }>(
        `SELECT id FROM experiment_sessions WHERE participant_id = $1 AND study_type = $2 AND status = 'in_progress'`,
        [participantId, studyType],
      );
      if (again) return { sessionId: again.id, created: false };
    }
    throw e;
  }
}

// ------------------------------------------------------------------------------------------ state

export async function sessionState(participantId: string, sessionId: string, db: Db = pool()): Promise<SessionState> {
  const s = await loadOwnedSession(db, participantId, sessionId);
  return buildState(db, s);
}

async function buildState(db: Db, s: SessionRow): Promise<SessionState> {
  const p = getProtocol(s.protocol_version);
  const schedule = s.schedule_length ? await scheduleRows(db, s.id) : [];
  let consent: SessionState['consent'] = null;
  if (s.stage === 'consent_pending') {
    const settings = await getSettings(db);
    const doc = consentFor(p.consentVersion, settings.contact);
    consent = { ...doc, sha256: sha256(canonicalJson(doc)) };
  }
  let trial: ClientTrial | null = null;
  const trialStages: Stage[] = ['diagnostic', 'learning', 'final_assessment', 'retention_test'];
  if (trialStages.includes(s.stage) && s.current_position) {
    const row = schedule.find((r) => r.position === s.current_position);
    if (row && PHASE_STAGE[row.phase] === s.stage) trial = toClientTrial(row, schedule, p);
  }
  const progress: SessionState['progress'] = {};
  for (const ph of ['diagnostic', 'learning', 'final', 'retention'] as Phase[]) {
    const rows = schedule.filter((r) => r.phase === ph);
    if (!rows.length) continue;
    const done = rows.filter((r) => s.current_position === null || r.position < s.current_position).length;
    progress[ph] = { done, total: rows.length };
  }
  return {
    sessionId: s.id,
    studyType: s.study_type,
    stage: s.stage,
    protocolVersion: s.protocol_version,
    audio: p.audio,
    characters: p.characters,
    consent,
    trial,
    progress,
    completion: s.stage === 'completed' ? await completionSummary(db, s) : null,
    hoursSinceParent: s.hours_since_parent,
    idleThresholdMs: p.timing.idleThresholdMs,
  };
}

// ------------------------------------------------------------------------------------------ consent, audio, screening

export async function recordConsent(participantId: string, sessionId: string, input: { decision: 'agreed' | 'declined'; consentSha256: string }): Promise<SessionState> {
  return tx(async (c) => {
    const s = await loadOwnedSession(c, participantId, sessionId, true);
    requireStage(s, 'consent_pending');
    const p = getProtocol(s.protocol_version);
    const settings = await getSettings(c);
    if (env.isProduction && !contactConfigured(settings.contact)) {
      throw new AppError(409, 'study_closed', 'The study contact details are not configured, so consent cannot be recorded yet.');
    }
    const doc = consentFor(p.consentVersion, settings.contact);
    const hash = sha256(canonicalJson(doc));
    if (hash !== input.consentSha256) {
      throw new AppError(409, 'consent_changed', 'The consent information was updated. Please read it again.');
    }
    await c.query(
      `INSERT INTO consent_records (participant_id, session_id, consent_version, protocol_version, decision, consent_text_sha256, contact_snapshot)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [participantId, s.id, p.consentVersion, p.version, input.decision, hash, JSON.stringify(settings.contact)],
    );
    if (input.decision === 'agreed') {
      await c.query(`UPDATE experiment_sessions SET consented_at = now() WHERE id = $1`, [s.id]);
      await transition(c, s, 'audio_setup');
    } else {
      await transition(c, s, 'declined', 'consent_declined');
    }
    return buildState(c, s);
  });
}

export const ClientInfoSchema = z.object({
  deviceCategory: z.enum(['mobile', 'tablet', 'desktop', 'unknown']),
  browserFamily: z.string().max(40),
  osFamily: z.string().max(40),
  touch: z.boolean(),
  maxTouchPoints: z.number().int().min(0).max(64),
  viewportWidth: z.number().int().min(0).max(20000),
  viewportHeight: z.number().int().min(0).max(20000),
  devicePixelRatio: z.number().min(0).max(10),
  audioSampleRate: z.number().nullable(),
  audioBaseLatencyMs: z.number().nullable(),
  audioOutputLatencyMs: z.number().nullable(),
  hasGetOutputTimestamp: z.boolean(),
  prefersReducedMotion: z.boolean(),
  /** Version of the participant interface, so sessions run under different designs can be told apart. */
  uiVersion: z.string().max(20).optional(),
});

export async function completeAudioSetup(participantId: string, sessionId: string, info: z.infer<typeof ClientInfoSchema>): Promise<SessionState> {
  const ci = ClientInfoSchema.parse(info);
  return tx(async (c) => {
    const s = await loadOwnedSession(c, participantId, sessionId, true);
    requireStage(s, 'audio_setup');
    await c.query(
      `UPDATE experiment_sessions SET device_category = $2, browser_family = $3, os_family = $4, client_info = $5 WHERE id = $1`,
      [s.id, ci.deviceCategory, ci.browserFamily, ci.osFamily, JSON.stringify(ci)],
    );
    await transition(c, s, s.study_type === 'day1_learning' ? 'baseline_screening' : 'retention_screening');
    return buildState(c, s);
  });
}

export const ScreeningSchema = z.object({
  priorKnowledgeRating: z.number().int().min(1).max(10),
  skipDiagnostic: z.boolean(),
});

export async function submitScreening(participantId: string, sessionId: string, input: z.infer<typeof ScreeningSchema>): Promise<SessionState> {
  const v = ScreeningSchema.parse(input);
  return tx(async (c) => {
    const s = await loadOwnedSession(c, participantId, sessionId, true);
    requireStage(s, 'baseline_screening');
    const p = getDay1Protocol(s.protocol_version);
    const includeDiagnostic = !v.skipDiagnostic;
    await insertSchedule(c, s.id, generateDay1Schedule(p, s.seed, includeDiagnostic));
    await c.query(
      `UPDATE experiment_sessions SET prior_knowledge_rating = $2, skipped_diagnostic = $3, baseline_status = $4, current_position = 1 WHERE id = $1`,
      [s.id, v.priorKnowledgeRating, v.skipDiagnostic, includeDiagnostic ? 'tested' : 'not_tested_self_reported_beginner'],
    );
    s.current_position = 1;
    s.schedule_length = 1; // non-null marker so buildState loads the schedule
    await transition(c, s, includeDiagnostic ? 'diagnostic' : 'learning');
    return buildState(c, s);
  });
}

export const RetentionScreeningSchema = z.object({
  practicedSince: z.enum(['no', 'a_little', 'a_lot']),
});

export async function submitRetentionScreening(participantId: string, sessionId: string, input: z.infer<typeof RetentionScreeningSchema>): Promise<SessionState> {
  const v = RetentionScreeningSchema.parse(input);
  return tx(async (c) => {
    const s = await loadOwnedSession(c, participantId, sessionId, true);
    requireStage(s, 'retention_screening');
    const p = getProtocol(s.protocol_version);
    if (p.studyType !== 'delayed_retention') throw new Error('not a retention protocol');
    await insertSchedule(c, s.id, generateRetentionSchedule(p, s.seed));
    await c.query(`UPDATE experiment_sessions SET retention_answers = $2, current_position = 1 WHERE id = $1`, [s.id, JSON.stringify(v)]);
    s.current_position = 1;
    s.schedule_length = 1;
    await transition(c, s, 'retention_test');
    return buildState(c, s);
  });
}

// ------------------------------------------------------------------------------------------ responses

const ms = z.number().finite().min(0).max(1e10);
export const ResponseSchema = z.object({
  clientResponseId: z.string().uuid(),
  position: z.number().int().min(1),
  response: z.string().max(2).nullable(),
  presentationNumber: z.number().int().min(1).max(1000),
  replayCount: z.number().int().min(0).max(1000),
  clientLoadId: z.string().uuid(),
  clientTimeOriginEpochMs: z.number().finite(),
  trialShownMs: ms.nullable(),
  playbackRequestedMs: ms.nullable(),
  playbackStartEstMs: ms.nullable(),
  playbackEndExpectedMs: ms.nullable(),
  playbackEndObservedMs: ms.nullable(),
  lastPlaybackEndMs: ms.nullable(),
  answersEnabledMs: ms.nullable(),
  responseMs: ms,
  signalDurationMs: ms,
  audioOutputLatencyMs: z.number().finite().nullable(),
  tabHiddenDuring: z.boolean(),
  hiddenDurationMs: ms.nullable(),
  windowBlurredDuring: z.boolean(),
  blurDurationMs: ms.nullable(),
  playbackInterrupted: z.boolean(),
  clientSubmittedEpochMs: z.number().finite().nullable(),
});
export type ResponseInput = z.infer<typeof ResponseSchema>;

/** Server-side timing derivation: one definition of latency for every phase. */
export function deriveTiming(r: ResponseInput) {
  const flags: string[] = [];
  const firstEnd = r.playbackEndObservedMs ?? r.playbackEndExpectedMs;
  if (r.playbackEndObservedMs === null) flags.push('no_observed_playback_end');
  const rt: number | null = firstEnd === null ? null : r.responseMs - firstEnd;
  // Kept as measured even when negative; such trials are flagged invalid_timing.
  if (rt !== null && rt < 0) flags.push('response_before_signal_end');
  if (r.trialShownMs !== null && r.responseMs < r.trialShownMs) flags.push('response_before_trial_shown');
  const rtLast = r.lastPlaybackEndMs === null ? null : r.responseMs - r.lastPlaybackEndMs;
  const invalid = flags.includes('response_before_signal_end') || flags.includes('response_before_trial_shown') || firstEnd === null;
  return { rtMs: rt, rtFromLastMs: rtLast, invalid, flags };
}

export async function submitResponse(participantId: string, sessionId: string, input: ResponseInput): Promise<SubmitResult> {
  const r = ResponseSchema.parse(input);
  const outcome = await tx(async (c) => {
    const s = await loadOwnedSession(c, participantId, sessionId, true);

    // Idempotency: the same client response id returns the stored result.
    const prior = await q1<{ session_id: string; position: number; phase: Phase; is_correct: boolean; response: string | null; target: string; pattern: string; feedback_shown: boolean }>(
      `SELECT session_id, position, phase, is_correct, response, target, pattern, feedback_shown FROM trial_responses WHERE client_response_id = $1`,
      [r.clientResponseId],
      c,
    );
    if (prior) {
      if (prior.session_id !== s.id || prior.position !== r.position) throw new AppError(409, 'id_conflict', 'Response id already used for a different trial.');
      const fb: LearningFeedback | null = prior.feedback_shown
        ? { correct: prior.is_correct, correctCharacter: prior.target, correctPattern: prior.pattern, response: prior.response }
        : null;
      return { duplicate: true, feedback: fb, s, freeze: false, evaluate: false };
    }

    if (s.current_position === null) throw new AppError(409, 'no_trial', 'There is no trial waiting for an answer.');
    if (r.position < s.current_position) throw new AppError(409, 'already_answered', 'This trial was already answered.');
    if (r.position > s.current_position) throw new AppError(409, 'out_of_order', 'Trials must be answered in order.');
    const row = await q1<ScheduleRow>(`SELECT * FROM trial_schedule WHERE session_id = $1 AND position = $2`, [s.id, r.position], c);
    if (!row) throw new AppError(409, 'no_trial', 'Trial not found in schedule.');
    requireStage(s, PHASE_STAGE[row.phase]);

    const idk = r.response === null;
    if (idk && !row.include_idk) throw new AppError(400, 'invalid_response', '"I don\'t know" is not an option on this trial.');
    if (!idk && !row.options.includes(r.response as string)) throw new AppError(400, 'invalid_response', 'Response is not one of the options.');
    if (!row.replay_allowed && r.replayCount > 0) throw new AppError(400, 'replay_not_allowed', 'Replays are not allowed on this trial.');

    const t = deriveTiming(r);
    const correct = !idk && r.response === row.target;
    const restarted = r.presentationNumber > 1;
    const interrupted = r.tabHiddenDuring || r.windowBlurredDuring || r.playbackInterrupted || restarted || t.invalid;
    const flags = [...t.flags];
    if (restarted) flags.push('restarted');
    if (r.tabHiddenDuring) flags.push('tab_hidden');
    if (r.windowBlurredDuring) flags.push('window_blurred');
    if (r.playbackInterrupted) flags.push('playback_interrupted');
    const cumulative = row.phase === 'diagnostic' || row.phase === 'learning' ? row.prior_target_presentations + 1 : row.prior_target_presentations;

    await c.query(
      `INSERT INTO trial_responses (
         client_response_id, session_id, participant_id, protocol_version, position, trial_key, phase, phase_index, block, target, pattern,
         options, option_count, response, is_idk, is_correct, feedback_shown, hints_available, replay_allowed, replay_count,
         prior_target_presentations, cumulative_target_exposures, presentation_number, client_load_id, client_time_origin_epoch_ms,
         trial_shown_ms, playback_requested_ms, playback_start_est_ms, playback_end_expected_ms, playback_end_observed_ms,
         signal_duration_ms, answers_enabled_ms, response_ms, rt_ms, rt_from_last_playback_ms, audio_output_latency_ms,
         tab_hidden_during, hidden_duration_ms, window_blurred_during, blur_duration_ms, playback_interrupted, restarted,
         invalid_timing, interrupted, timing_flags, client_submitted_epoch_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,false,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,
               $30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45)`,
      [
        r.clientResponseId, s.id, participantId, s.protocol_version, row.position, row.trial_key, row.phase, row.phase_index, row.block,
        row.target, row.pattern, JSON.stringify(row.options), row.options.length, r.response, idk, correct, row.feedback,
        row.replay_allowed, r.replayCount, row.prior_target_presentations, cumulative, r.presentationNumber, r.clientLoadId,
        r.clientTimeOriginEpochMs, r.trialShownMs, r.playbackRequestedMs, r.playbackStartEstMs, r.playbackEndExpectedMs,
        r.playbackEndObservedMs, r.signalDurationMs, r.answersEnabledMs, r.responseMs, t.rtMs, t.rtFromLastMs, r.audioOutputLatencyMs,
        r.tabHiddenDuring, r.hiddenDurationMs, r.windowBlurredDuring, r.blurDurationMs, r.playbackInterrupted, restarted,
        t.invalid, interrupted, JSON.stringify(flags), r.clientSubmittedEpochMs,
      ],
    );

    const next = await q1<ScheduleRow>(`SELECT * FROM trial_schedule WHERE session_id = $1 AND position = $2`, [s.id, row.position + 1], c);
    await c.query(`UPDATE experiment_sessions SET current_position = $2, last_activity_at = now() WHERE id = $1`, [s.id, next ? next.position : null]);
    s.current_position = next ? next.position : null;

    let freeze = false, evaluate = false;
    if (!next || next.phase !== row.phase) {
      if (row.phase === 'diagnostic') await transition(c, s, 'learning');
      else if (row.phase === 'learning') { await transition(c, s, 'profile_generation'); freeze = true; }
      else if (row.phase === 'final' || row.phase === 'retention') { await transition(c, s, 'completed'); evaluate = true; }
    }
    const feedback: LearningFeedback | null = row.feedback
      ? { correct, correctCharacter: row.target, correctPattern: row.pattern, response: r.response }
      : null;
    return { duplicate: false, feedback, s, freeze, evaluate };
  });

  if (outcome.freeze) {
    try {
      await freezeProfile(participantId, sessionId);
    } catch (e) {
      log('error', 'profile freeze failed; participant can retry', { sessionId, error: (e as Error).message });
    }
  }
  if (outcome.evaluate) {
    try {
      await evaluateSession(sessionId);
    } catch (e) {
      log('error', 'evaluation failed; can be recomputed from the dashboard', { sessionId, error: (e as Error).message });
    }
  }
  await touchParticipant(participantId);
  return { saved: true, duplicate: outcome.duplicate, feedback: outcome.feedback, state: await sessionState(participantId, sessionId) };
}

// ------------------------------------------------------------------------------------------ profile + evaluation

/**
 * Builds the estimator snapshot from diagnostic + learning rows ONLY and freezes the profile.
 * Idempotent: if a profile already exists the stage is simply advanced.
 */
export async function freezeProfile(participantId: string, sessionId: string): Promise<SessionState> {
  return tx(async (c) => {
    const s = await loadOwnedSession(c, participantId, sessionId, true);
    requireStage(s, 'profile_generation');
    const existing = await q1(`SELECT id FROM knowledge_profiles WHERE session_id = $1`, [s.id], c);
    if (!existing) {
      const p = getDay1Protocol(s.protocol_version);
      const rows = await q<SnapshotSourceRow>(
        `SELECT phase, position, phase_index, block, target, response, is_idk, is_correct, option_count, rt_ms, replay_count, interrupted
         FROM trial_responses WHERE session_id = $1 AND phase IN ('diagnostic', 'learning') ORDER BY position`,
        [s.id],
        c,
      );
      const learningCount = rows.filter((r) => r.phase === 'learning').length;
      const expected = p.learning.blocks.reduce((n, b) => n + b.trials, 0);
      if (learningCount !== expected) throw new AppError(409, 'incomplete_learning', `Expected ${expected} learning responses, found ${learningCount}.`);
      const snapshot = buildEstimatorSnapshot({
        protocolVersion: p.version,
        estimatorVersion: RULES_V1.version,
        characters: p.characters,
        introductionBlock: introductionBlock(p),
        baselineStatus: s.baseline_status === 'tested' ? 'tested' : 'not_tested_self_reported_beginner',
        priorKnowledgeRating: s.prior_knowledge_rating,
        rows,
      });
      const profile = estimateKnowledge(snapshot, RULES_V1);
      await c.query(
        `INSERT INTO knowledge_profiles (session_id, participant_id, protocol_version, estimator_version, input_cutoff_position,
                                         input_observations, input_snapshot, input_sha256, profile)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [s.id, participantId, p.version, profile.estimatorVersion, snapshot.cutoffPosition, snapshot.observations.length,
          JSON.stringify(snapshot), sha256(canonicalJson(snapshot)), JSON.stringify(profile)],
      );
    }
    await transition(c, s, 'final_assessment');
    return buildState(c, s);
  });
}

/** Compares the frozen profile with the completed test and stores the result separately. Idempotent. */
export async function evaluateSession(sessionId: string, db: Db = pool()): Promise<void> {
  const s = await q1<SessionRow>(`SELECT * FROM experiment_sessions WHERE id = $1`, [sessionId], db);
  if (!s || s.stage !== 'completed') return;
  const profileSession = s.study_type === 'day1_learning' ? s.id : s.parent_session_id;
  if (!profileSession) return;
  const prof = await q1<{ id: string; profile: KnowledgeProfileResult }>(`SELECT id, profile FROM knowledge_profiles WHERE session_id = $1`, [profileSession], db);
  if (!prof) return;
  const phase: Phase = s.study_type === 'day1_learning' ? 'final' : 'retention';
  const rows = await q<{ target: string; response: string | null; is_idk: boolean; is_correct: boolean; interrupted: boolean }>(
    `SELECT target, response, is_idk, is_correct, interrupted FROM trial_responses WHERE session_id = $1 AND phase = $2 ORDER BY position`,
    [s.id, phase],
    db,
  );
  const result = evaluateProfile(prof.profile, rows.map((r) => ({ target: r.target, response: r.response, idk: r.is_idk, correct: r.is_correct, interrupted: r.interrupted })));
  await db.query(
    `INSERT INTO evaluations (session_id, profile_id, kind, evaluation_version, result) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (session_id, profile_id, kind, evaluation_version) DO NOTHING`,
    [s.id, prof.id, s.study_type === 'day1_learning' ? 'final_assessment' : 'retention', result.evaluationVersion, JSON.stringify(result)],
  );
}

// ------------------------------------------------------------------------------------------ resume / withdraw

export async function markResumed(participantId: string, sessionId: string): Promise<SessionState> {
  const s = await loadOwnedSession(pool(), participantId, sessionId);
  if (!isTerminal(s.stage)) {
    await q(`UPDATE experiment_sessions SET resume_count = resume_count + 1, last_activity_at = now() WHERE id = $1`, [s.id]);
  }
  return buildState(pool(), s);
}

export async function withdrawSession(participantId: string, sessionId: string): Promise<SessionState> {
  return tx(async (c) => {
    const s = await loadOwnedSession(c, participantId, sessionId, true);
    if (isTerminal(s.stage)) throw new AppError(409, 'wrong_stage', 'This session has already ended.');
    await transition(c, s, 'withdrawn', 'participant_withdrew');
    return buildState(c, s);
  });
}

// ------------------------------------------------------------------------------------------ telemetry

const EventSchema = z.object({
  id: z.string().uuid(),
  seq: z.number().int().min(1).max(1_000_000),
  type: z.enum(EVENT_TYPES),
  clientLoadId: z.string().uuid(),
  clientMs: z.number().finite().min(0),
  clientEpochMs: z.number().finite(),
  trialPosition: z.number().int().min(1).nullable(),
  screen: z.string().max(40).nullable(),
  payload: z.record(z.string(), z.union([z.string().max(200), z.number().finite(), z.boolean(), z.null()])).refine((p) => Object.keys(p).length <= 40, 'payload too large'),
});
export const EventBatchSchema = z.object({ events: z.array(EventSchema).min(1).max(200) });
export type ClientEvent = z.infer<typeof EventSchema>;

export async function recordEvents(participantId: string, sessionId: string, events: ClientEvent[]): Promise<{ accepted: string[]; duplicates: string[] }> {
  const batch = EventBatchSchema.parse({ events }).events;
  const s = await loadOwnedSession(pool(), participantId, sessionId);
  if (!telemetryAllowed(s.stage)) throw new AppError(409, 'telemetry_not_allowed', 'Telemetry is only recorded after consent.');
  const inserted = await q<{ id: string }>(
    `INSERT INTO behavioral_events (id, session_id, participant_id, client_load_id, seq, type, client_ms, client_epoch_ms, trial_position, screen, payload)
     SELECT x.id, $1, $2, x.client_load_id, x.seq, x.type, x.client_ms, x.client_epoch_ms, x.trial_position, x.screen, x.payload
     FROM jsonb_to_recordset($3::jsonb) AS x(id uuid, client_load_id uuid, seq int, type text, client_ms float8, client_epoch_ms float8,
                                             trial_position int, screen text, payload jsonb)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      s.id,
      participantId,
      JSON.stringify(batch.map((e) => ({
        id: e.id, client_load_id: e.clientLoadId, seq: e.seq, type: e.type, client_ms: e.clientMs, client_epoch_ms: e.clientEpochMs,
        trial_position: e.trialPosition, screen: e.screen, payload: e.payload,
      }))),
    ],
  );
  const ok = new Set(inserted.map((r) => r.id));
  await q(`UPDATE experiment_sessions SET last_activity_at = now() WHERE id = $1`, [s.id]);
  return { accepted: batch.filter((e) => ok.has(e.id)).map((e) => e.id), duplicates: batch.filter((e) => !ok.has(e.id)).map((e) => e.id) };
}

export type { PoolClient };
