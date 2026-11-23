import { beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { resetTestDatabase } from '../support/db';
import {
  answerWhile, CLIENT_INFO, countRows, newParticipant, perfect, responseFor, startDay1, startRetention, targetAt, wrong,
} from '../support/flow';
import { pool, q, q1 } from '@/lib/server/db';
import {
  completeAudioSetup, evaluateSession, freezeProfile, markResumed, participantOverview, recordConsent, recordEvents, sessionState,
  startSession, submitResponse, submitScreening, withdrawSession,
} from '@/lib/server/experiment';
import { deleteParticipantCompletely, signInWithEmailCode, signInWithEmailLink, signInWithRecoveryCode, requestEmailSignIn, createParticipant, participantFromSessionToken, AppError } from '@/lib/server/participants';
import { devOutbox } from '@/lib/server/mailer';
import { saveSettings, getSettings } from '@/lib/server/settings';
import { DAY1_V1 } from '@/lib/protocol/protocols';
import type { KnowledgeProfileResult } from '@/lib/estimator/rules';

beforeAll(async () => {
  await resetTestDatabase();
});

async function expectAppError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof AppError && e.code === code);
}

describe('accounts and authentication', () => {
  it('creates a profile with a recovery code and signs back in with it', async () => {
    const a = await newParticipant('Same Name');
    const b = await newParticipant('Same Name'); // duplicate display names are allowed
    expect(a.participantId).not.toBe(b.participantId);
    expect(a.recoveryCode).toMatch(/^[0-9A-Z]{5}(-[0-9A-Z]{5}){3}-[0-9A-Z]{6}$/);
    const raw = await q1<{ recovery_code_hash: string }>(`SELECT recovery_code_hash FROM auth_identities WHERE participant_id = $1`, [a.participantId]);
    expect(raw!.recovery_code_hash).not.toContain(a.recoveryCode.replace(/-/g, ''));
    const s = await signInWithRecoveryCode(a.recoveryCode.toLowerCase().replace(/-/g, ' '));
    expect(s?.participantId).toBe(a.participantId);
    expect(await signInWithRecoveryCode('AAAAA-BBBBB-CCCCC-DDDDD-EEEEEE')).toBeNull();
    expect((await participantFromSessionToken(s!.sessionToken))?.id).toBe(a.participantId);
    expect(await participantFromSessionToken('not-a-token')).toBeNull();
  });

  it('rejects minors and names-only authentication', async () => {
    await expectAppError(createParticipant({ displayName: 'Kid', adultConfirmed: false }), 'adult_required');
    await expect(createParticipant({ displayName: '', adultConfirmed: true })).rejects.toThrow();
  });

  it('supports passwordless email: verification, code sign-in and link sign-in', async () => {
    const p = await createParticipant({ displayName: 'Mailer', email: 'Person@Example.org', adultConfirmed: true });
    expect(p.emailPending).toBe(true);
    const verify = devOutbox.at(-1)!;
    expect(verify.to).toBe('person@example.org');
    expect(verify.purpose).toBe('verify_email');
    await expectAppError(createParticipant({ displayName: 'Dup', email: 'person@example.org', adultConfirmed: true }), 'email_in_use');

    await requestEmailSignIn('person@example.org');
    const m = devOutbox.at(-1)!;
    expect(m.purpose).toBe('sign_in');
    expect(await signInWithEmailCode('person@example.org', '000000' === m.code ? '111111' : '000000')).toBeNull();
    const viaCode = await signInWithEmailCode('person@example.org', m.code);
    expect(viaCode?.participantId).toBe(p.participantId);
    expect(await signInWithEmailCode('person@example.org', m.code)).toBeNull(); // single use

    await requestEmailSignIn('person@example.org');
    const link = new URL(devOutbox.at(-1)!.link).searchParams.get('token')!;
    expect((await signInWithEmailLink(link))?.participantId).toBe(p.participantId);
    expect(await signInWithEmailLink(link)).toBeNull();
    const v = await q1<{ email_verified_at: Date | null }>(`SELECT email_verified_at FROM auth_identities WHERE participant_id = $1`, [p.participantId]);
    expect(v!.email_verified_at).not.toBeNull();

    const before = devOutbox.length;
    await requestEmailSignIn('nobody@example.org'); // no enumeration: resolves silently, sends nothing
    expect(devOutbox.length).toBe(before);
  });

  it('locks a code after too many wrong attempts', async () => {
    await createParticipant({ displayName: 'Brute', email: 'brute@example.org', adultConfirmed: true });
    await requestEmailSignIn('brute@example.org');
    const good = devOutbox.at(-1)!.code;
    const bad = good === '123456' ? '654321' : '123456';
    for (let i = 0; i < 5; i++) expect(await signInWithEmailCode('brute@example.org', bad)).toBeNull();
    expect(await signInWithEmailCode('brute@example.org', good)).toBeNull();
  });
});

describe('consent and state machine', () => {
  it('requires consent before anything else and records it', async () => {
    const p = await newParticipant();
    const { sessionId } = await startSession(p.participantId, 'day1_learning');
    const st = await sessionState(p.participantId, sessionId);
    expect(st.stage).toBe('consent_pending');
    expect(st.consent?.sections.length).toBeGreaterThan(3);
    expect(JSON.stringify(st.consent)).toContain('researcher@example.org');
    await expectAppError(submitScreening(p.participantId, sessionId, { priorKnowledgeRating: 1, skipDiagnostic: true }), 'wrong_stage');
    await expectAppError(completeAudioSetup(p.participantId, sessionId, CLIENT_INFO), 'wrong_stage');
    await expectAppError(recordEvents(p.participantId, sessionId, [ev(1)]), 'telemetry_not_allowed');
    await expectAppError(recordConsent(p.participantId, sessionId, { decision: 'agreed', consentSha256: 'f'.repeat(64) }), 'consent_changed');
    const after = await recordConsent(p.participantId, sessionId, { decision: 'agreed', consentSha256: st.consent!.sha256 });
    expect(after.stage).toBe('audio_setup');
    const c = await q1<{ decision: string; consent_version: string; protocol_version: string }>(`SELECT * FROM consent_records WHERE session_id = $1`, [sessionId]);
    expect(c).toMatchObject({ decision: 'agreed', consent_version: 'consent-v1', protocol_version: 'day1-v1' });
    await expect(q(`UPDATE consent_records SET decision = 'declined' WHERE session_id = $1`, [sessionId])).rejects.toThrow(/immutable/);
  });

  it('declining consent ends the session without telemetry', async () => {
    const p = await newParticipant();
    const { sessionId } = await startSession(p.participantId, 'day1_learning');
    const st = await sessionState(p.participantId, sessionId);
    const d = await recordConsent(p.participantId, sessionId, { decision: 'declined', consentSha256: st.consent!.sha256 });
    expect(d.stage).toBe('declined');
    await expectAppError(recordEvents(p.participantId, sessionId, [ev(1)]), 'telemetry_not_allowed');
    await expectAppError(completeAudioSetup(p.participantId, sessionId, CLIENT_INFO), 'wrong_stage');
  });

  it('does not create duplicate sessions on repeated clicks', async () => {
    const p = await newParticipant();
    const rs = await Promise.all([1, 2, 3, 4].map(() => startSession(p.participantId, 'day1_learning')));
    expect(new Set(rs.map((r) => r.sessionId)).size).toBe(1);
  });
});

function ev(seq: number, type = 'screen_enter') {
  return {
    id: randomUUID(), seq, type: type as 'screen_enter', clientLoadId: '00000000-0000-4000-8000-000000000002',
    clientMs: seq * 100, clientEpochMs: 1_760_000_000_000 + seq * 100, trialPosition: null, screen: 'learning', payload: { a: 1 },
  };
}

describe('Day-1 experiment, diagnostic skipped, accurate learner', () => {
  let pid: string, sid: string;
  it('runs the full protocol and freezes the profile before the final test', async () => {
    const p = await newParticipant('Skipper');
    pid = p.participantId;
    let st = await startDay1(pid, { skipDiagnostic: true });
    sid = st.sessionId;
    expect(st.stage).toBe('learning');
    expect(st.progress.diagnostic).toBeUndefined();
    expect(st.trial?.phase).toBe('learning');
    expect(st.trial?.introduce.map((i) => i.character)).toEqual(['E', 'T']);
    expect(st.trial?.replayAllowed).toBe(true);
    expect(JSON.stringify(st.trial)).not.toMatch(/"target"/); // the answer key is never sent

    const sess = await q1<{ baseline_status: string; skipped_diagnostic: boolean; prior_knowledge_rating: number }>(`SELECT * FROM experiment_sessions WHERE id = $1`, [sid]);
    expect(sess).toMatchObject({ baseline_status: 'not_tested_self_reported_beginner', skipped_diagnostic: true, prior_knowledge_rating: 1 });

    const learn = await answerWhile(pid, st, ['learning'], perfect);
    expect(learn.results).toHaveLength(48);
    expect(learn.results.every((r) => r.feedback?.correct === true)).toBe(true);
    expect(learn.results[0]!.feedback).toMatchObject({ correctCharacter: expect.any(String), correctPattern: expect.any(String) });
    st = learn.state;
    expect(st.stage).toBe('final_assessment');
    expect(await countRows('trial_responses', sid)).toBe(48);

    const prof = await q1<{ created_at: Date; input_snapshot: { observations: { phase: string }[] }; input_cutoff_position: number; estimator_version: string; profile: KnowledgeProfileResult; input_sha256: string }>(
      `SELECT * FROM knowledge_profiles WHERE session_id = $1`, [sid],
    );
    expect(prof).not.toBeNull();
    expect(prof!.estimator_version).toBe('rules-v1');
    expect(prof!.input_cutoff_position).toBe(48);
    expect(prof!.input_snapshot.observations.every((o) => o.phase === 'learning')).toBe(true);
    expect(prof!.profile.summary.baselineStatus).toBe('not_tested_self_reported_beginner');
    expect(prof!.input_sha256).toMatch(/^[0-9a-f]{64}$/);

    expect(st.trial?.phase).toBe('final');
    expect(st.trial?.replayAllowed).toBe(false);
    expect(st.trial?.feedback).toBe(false);
    expect(st.trial?.includeIdk).toBe(true);
    expect(st.trial?.options).toHaveLength(6);

    const fin = await answerWhile(pid, st, ['final_assessment'], (t) => (t === 'M' ? null : t));
    expect(fin.results).toHaveLength(24);
    expect(fin.results.every((r) => r.feedback === null)).toBe(true);
    st = fin.state;
    expect(st.stage).toBe('completed');
    expect(st.completion?.test).toMatchObject({ correct: 20, total: 24 });

    const after = await q1<{ created_at: Date; profile: unknown }>(`SELECT created_at, profile FROM knowledge_profiles WHERE session_id = $1`, [sid]);
    expect(after!.created_at.getTime()).toBe(prof!.created_at.getTime());
    expect(after!.profile).toEqual(prof!.profile);
    const firstFinal = await q1<{ received_at: Date }>(`SELECT min(received_at) AS received_at FROM trial_responses WHERE session_id = $1 AND phase = 'final'`, [sid]);
    expect(prof!.created_at.getTime()).toBeLessThanOrEqual(firstFinal!.received_at.getTime());

    const ev1 = await q1<{ kind: string; result: { overall: { observedCorrect: number; observedN: number } } }>(`SELECT * FROM evaluations WHERE session_id = $1`, [sid]);
    expect(ev1!.kind).toBe('final_assessment');
    expect(ev1!.result.overall).toMatchObject({ observedCorrect: 20, observedN: 24 });
  });

  it('cannot modify the frozen profile, responses or schedule', async () => {
    await expect(q(`UPDATE knowledge_profiles SET profile = '{}' WHERE session_id = $1`, [sid])).rejects.toThrow(/immutable/);
    await expect(q(`DELETE FROM knowledge_profiles WHERE session_id = $1`, [sid])).rejects.toThrow(/withdrawal/);
    await expect(q(`UPDATE trial_responses SET is_correct = true WHERE session_id = $1`, [sid])).rejects.toThrow(/immutable/);
    await expect(q(`UPDATE trial_schedule SET target = 'E' WHERE session_id = $1`, [sid])).rejects.toThrow(/immutable/);
    // Re-running evaluation is idempotent and does not touch the profile.
    await evaluateSession(sid);
    expect(await countRows('evaluations', sid)).toBe(1);
  });

  it('rejects changes after completion and a second Day-1 session', async () => {
    const st = await sessionState(pid, sid);
    expect(st.trial).toBeNull();
    await expectAppError(submitResponse(pid, sid, { ...responseFor({ ...st, trial: { position: 60 } } as never, 'E') }), 'no_trial');
    await expectAppError(withdrawSession(pid, sid), 'wrong_stage');
    await expectAppError(startSession(pid, 'day1_learning'), 'not_eligible');
    const ov = await participantOverview(pid);
    expect(ov.sessions).toHaveLength(1);
    expect(ov.incompleteSession).toBeNull();
    expect(ov.lastParticipation).not.toBeNull();
    expect(ov.available).toHaveLength(0);
  });
});

describe('Day-1 experiment, with diagnostic, struggling learner', () => {
  it('reaches all six letters on the fixed schedule and completes', async () => {
    const p = await newParticipant('Struggler');
    let st = await startDay1(p.participantId, { skipDiagnostic: false, rating: 4 });
    expect(st.stage).toBe('diagnostic');
    expect(st.trial).toMatchObject({ phase: 'diagnostic', includeIdk: true, replayAllowed: false, feedback: false });
    expect(st.trial?.options).toEqual(['E', 'T', 'A', 'N', 'I', 'M']);
    const diag = await answerWhile(p.participantId, st, ['diagnostic'], () => null);
    expect(diag.results).toHaveLength(12);
    expect(diag.results.every((r) => r.feedback === null)).toBe(true);
    st = diag.state;
    expect(st.stage).toBe('learning');

    const introduced: string[] = [];
    const blocks = new Set<number>();
    let s2 = st;
    const results = [];
    while (s2.stage === 'learning' && s2.trial) {
      introduced.push(...s2.trial.introduce.map((i) => i.character));
      blocks.add(s2.trial.block!);
      const target = await targetAt(s2.sessionId, s2.trial.position);
      const r = await submitResponse(p.participantId, s2.sessionId, responseFor(s2, wrong(target, s2.trial.options, s2)));
      results.push(r);
      s2 = r.state;
    }
    expect(results).toHaveLength(48);
    expect(results.every((r) => r.feedback?.correct === false)).toBe(true);
    expect(introduced).toEqual(['E', 'T', 'A', 'N', 'I', 'M']);
    expect([...blocks]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(s2.stage).toBe('final_assessment');

    const prof = await q1<{ profile: KnowledgeProfileResult; input_snapshot: { observations: { phase: string }[] } }>(`SELECT * FROM knowledge_profiles WHERE session_id = $1`, [st.sessionId]);
    expect(prof!.input_snapshot.observations.filter((o) => o.phase === 'diagnostic')).toHaveLength(12);
    expect(prof!.profile.characters.every((c) => c.category === 'little_evidence')).toBe(true);

    // Learning schedule matches the protocol counts exactly, regardless of accuracy.
    const counts = await q<{ block: number; n: string }>(`SELECT block, count(*)::text AS n FROM trial_schedule WHERE session_id = $1 AND phase = 'learning' GROUP BY block ORDER BY block`, [st.sessionId]);
    expect(counts.map((c) => Number(c.n))).toEqual(DAY1_V1.learning.blocks.map((b) => b.trials));

    const fin = await answerWhile(p.participantId, s2, ['final_assessment'], wrong);
    expect(fin.state.stage).toBe('completed');
    expect(fin.state.completion?.test.correct).toBe(0);
  });
});

describe('integrity attacks', () => {
  it('blocks final-test data before the profile exists, replays and out-of-order answers', async () => {
    const p = await newParticipant('Attacker');
    let st = await startDay1(p.participantId, { skipDiagnostic: true });
    const sid = st.sessionId;

    // A final-test row cannot be inserted before the profile exists (database trigger).
    const finalRow = await q1<{ position: number }>(`SELECT position FROM trial_schedule WHERE session_id = $1 AND phase = 'final' ORDER BY position LIMIT 1`, [sid]);
    const forged = responseFor({ ...st, trial: { ...st.trial!, position: finalRow!.position } }, 'E');
    await expectAppError(submitResponse(p.participantId, sid, forged), 'out_of_order');
    await expect(pool().query(
      `INSERT INTO trial_responses (client_response_id, session_id, participant_id, protocol_version, position, trial_key, phase, phase_index, target, pattern, options, option_count, response, is_idk, is_correct, feedback_shown, hints_available, replay_allowed, replay_count, prior_target_presentations, cumulative_target_exposures, presentation_number, client_load_id, client_time_origin_epoch_ms, signal_duration_ms, response_ms, tab_hidden_during, window_blurred_during, playback_interrupted, restarted, invalid_timing, interrupted)
       VALUES (gen_random_uuid(), $1, $2, 'day1-v1', $3, 'final-1', 'final', 1, 'E', '.', '[]', 6, 'E', false, true, false, false, false, 0, 0, 0, 1, gen_random_uuid(), 0, 80, 1, false, false, false, false, false, false)`,
      [sid, p.participantId, finalRow!.position],
    )).rejects.toThrow(/no frozen knowledge profile/);

    // Answer the first trial, then try to answer it again with a new id (improving results).
    const first = responseFor(st, 'E');
    const r1 = await submitResponse(p.participantId, sid, first);
    const dup = await submitResponse(p.participantId, sid, first); // network retry: idempotent
    expect(dup.duplicate).toBe(true);
    expect(dup.feedback).toEqual(r1.feedback);
    expect(await countRows('trial_responses', sid)).toBe(1);
    await expectAppError(submitResponse(p.participantId, sid, { ...first, clientResponseId: randomUUID(), response: 'T' }), 'already_answered');
    await expectAppError(submitResponse(p.participantId, sid, { ...first, clientResponseId: randomUUID(), position: 5 }), 'out_of_order');
    st = r1.state;

    // Invalid options, IDK in learning, replay in no-replay phases.
    await expectAppError(submitResponse(p.participantId, sid, responseFor(st, 'Z')), 'invalid_response');
    await expectAppError(submitResponse(p.participantId, sid, responseFor(st, null)), 'invalid_response');

    // Cannot freeze a profile during learning, nor jump stages.
    await expectAppError(freezeProfile(p.participantId, sid), 'wrong_stage');
    await expectAppError(submitScreening(p.participantId, sid, { priorKnowledgeRating: 1, skipDiagnostic: false }), 'wrong_stage');

    // Finish learning; then replays in the final test are refused.
    st = (await answerWhile(p.participantId, st, ['learning'], perfect)).state;
    expect(st.stage).toBe('final_assessment');
    await expectAppError(submitResponse(p.participantId, sid, responseFor(st, 'E', { replayCount: 1 })), 'replay_not_allowed');
    // A profile cannot be frozen twice or after final answers exist.
    await expectAppError(freezeProfile(p.participantId, sid), 'wrong_stage');
    const fr = await submitResponse(p.participantId, sid, responseFor(st, 'E'));
    expect(fr.feedback).toBeNull();
    await expect(pool().query(
      `INSERT INTO knowledge_profiles (session_id, participant_id, protocol_version, estimator_version, input_cutoff_position, input_observations, input_snapshot, input_sha256, profile)
       SELECT session_id, participant_id, protocol_version, 'x', 0, 0, '{}', 'x', '{}' FROM knowledge_profiles WHERE session_id = $1`, [sid],
    )).rejects.toThrow();
  });

  it('isolates participants from each other', async () => {
    const a = await newParticipant('Alice');
    const b = await newParticipant('Bob');
    const st = await startDay1(a.participantId, { skipDiagnostic: true });
    await expectAppError(sessionState(b.participantId, st.sessionId), 'not_found');
    await expectAppError(submitResponse(b.participantId, st.sessionId, responseFor(st, 'E')), 'not_found');
    await expectAppError(recordEvents(b.participantId, st.sessionId, [ev(1)]), 'not_found');
    await expectAppError(withdrawSession(b.participantId, st.sessionId), 'not_found');
    await expectAppError(sessionState(b.participantId, 'not-a-uuid'), 'not_found');
  });
});

describe('refresh, resume, interruptions and telemetry', () => {
  it('resumes on the stored schedule without regenerating it and flags restarted trials', async () => {
    const p = await newParticipant('Resumer');
    let st = await startDay1(p.participantId, { skipDiagnostic: false });
    const before = await q(`SELECT * FROM trial_schedule WHERE session_id = $1 ORDER BY position`, [st.sessionId]);
    st = (await submitResponse(p.participantId, st.sessionId, responseFor(st, 'E'))).state;
    const resumed = await markResumed(p.participantId, st.sessionId);
    expect(resumed.trial?.position).toBe(st.trial?.position);
    const after = await q(`SELECT * FROM trial_schedule WHERE session_id = $1 ORDER BY position`, [st.sessionId]);
    expect(after).toEqual(before);
    const r = await submitResponse(p.participantId, st.sessionId, responseFor(st, 'T', { presentationNumber: 2, tabHiddenDuring: true, hiddenDurationMs: 4000 }));
    expect(r.saved).toBe(true);
    const row = await q1<{ restarted: boolean; interrupted: boolean; timing_flags: string[]; rt_ms: number; hidden_duration_ms: number }>(
      `SELECT * FROM trial_responses WHERE session_id = $1 AND position = 2`, [st.sessionId],
    );
    expect(row).toMatchObject({ restarted: true, interrupted: true, hidden_duration_ms: 4000 });
    expect(row!.timing_flags).toEqual(expect.arrayContaining(['restarted', 'tab_hidden']));
    expect(row!.rt_ms).toBeCloseTo(1400 - 605);
    const sess = await q1<{ resume_count: number }>(`SELECT resume_count FROM experiment_sessions WHERE id = $1`, [st.sessionId]);
    expect(sess!.resume_count).toBe(1);
  });

  it('flags answers given before the signal ended as invalid timing', async () => {
    const p = await newParticipant('Early');
    const st = await startDay1(p.participantId, { skipDiagnostic: true });
    await submitResponse(p.participantId, st.sessionId, responseFor(st, 'E', { responseMs: 1000 + 3000 + 300 }));
    const row = await q1<{ invalid_timing: boolean; rt_ms: number; timing_flags: string[] }>(`SELECT * FROM trial_responses WHERE session_id = $1`, [st.sessionId]);
    expect(row!.invalid_timing).toBe(true);
    expect(row!.rt_ms).toBeLessThan(0);
    expect(row!.timing_flags).toContain('response_before_signal_end');
  });

  it('stores events idempotently with sequence numbers', async () => {
    const p = await newParticipant('Eventful');
    const st = await startDay1(p.participantId, { skipDiagnostic: true });
    const batch = [ev(1), ev(2, 'audio_played'), ev(3, 'visibility_hidden')];
    const r1 = await recordEvents(p.participantId, st.sessionId, batch);
    expect(r1.accepted).toHaveLength(3);
    const r2 = await recordEvents(p.participantId, st.sessionId, batch);
    expect(r2.accepted).toHaveLength(0);
    expect(r2.duplicates).toHaveLength(3);
    expect(await countRows('behavioral_events', st.sessionId)).toBe(3);
    await expect(recordEvents(p.participantId, st.sessionId, [{ ...ev(4), type: 'keystroke' as never }])).rejects.toThrow();
  });

  it('withdrawal ends a session; deletion removes every row', async () => {
    const p = await newParticipant('Leaver');
    const st = await startDay1(p.participantId, { skipDiagnostic: true });
    await recordEvents(p.participantId, st.sessionId, [ev(1)]);
    await submitResponse(p.participantId, st.sessionId, responseFor(st, 'E'));
    const w = await withdrawSession(p.participantId, st.sessionId);
    expect(w.stage).toBe('withdrawn');
    const del = await deleteParticipantCompletely(p.participantId);
    expect(del.sessionsDeleted).toBe(1);
    for (const t of ['trial_responses', 'trial_schedule', 'behavioral_events', 'consent_records']) expect(await countRows(t, st.sessionId)).toBe(0);
    expect(await q1(`SELECT 1 FROM participants WHERE id = $1`, [p.participantId])).toBeNull();
    expect(await q1(`SELECT 1 FROM auth_identities WHERE participant_id = $1`, [p.participantId])).toBeNull();
    expect(await signInWithRecoveryCode(p.recoveryCode)).toBeNull();
  });
});

describe('longitudinal: delayed retention session', () => {
  it('links a separately versioned retention test to the Day-1 session and evaluates the frozen profile', async () => {
    const p = await newParticipant('Returner');
    let st = await startDay1(p.participantId, { skipDiagnostic: true });
    st = (await answerWhile(p.participantId, st, ['learning', 'final_assessment'], perfect)).state;
    expect(st.stage).toBe('completed');
    const day1 = st.sessionId;

    // Disabled by default.
    await expectAppError(startSession(p.participantId, 'delayed_retention'), 'not_eligible');
    const settings = await getSettings();
    const r = await q1<{ id: string }>(`INSERT INTO researchers (email, password_hash) VALUES ('r@example.org', 'x') RETURNING id`);
    await saveSettings({ ...settings, retentionEnabled: true }, r!.id);
    // Too early (needs 20h).
    let ov = await participantOverview(p.participantId);
    expect(ov.available).toHaveLength(0);
    expect(ov.upcoming).toHaveLength(1);
    await expectAppError(startSession(p.participantId, 'delayed_retention'), 'not_eligible');
    await q(`UPDATE experiment_sessions SET completed_at = now() - interval '26 hours' WHERE id = $1`, [day1]);
    ov = await participantOverview(p.participantId);
    expect(ov.available.map((a) => a.studyType)).toEqual(['delayed_retention']);

    let rs = await startRetention(p.participantId);
    expect(rs.stage).toBe('retention_test');
    expect(rs.hoursSinceParent).toBeGreaterThan(25);
    expect(rs.trial).toMatchObject({ phase: 'retention', replayAllowed: false, feedback: false, includeIdk: true });
    rs = (await answerWhile(p.participantId, rs, ['retention_test'], perfect)).state;
    expect(rs.stage).toBe('completed');
    const sess = await q1<{ parent_session_id: string; protocol_version: string; retention_answers: { practicedSince: string } }>(`SELECT * FROM experiment_sessions WHERE id = $1`, [rs.sessionId]);
    expect(sess).toMatchObject({ parent_session_id: day1, protocol_version: 'retention-v1', retention_answers: { practicedSince: 'no' } });
    const e = await q1<{ kind: string; profile_id: string }>(`SELECT * FROM evaluations WHERE session_id = $1`, [rs.sessionId]);
    const prof = await q1<{ id: string }>(`SELECT id FROM knowledge_profiles WHERE session_id = $1`, [day1]);
    expect(e).toMatchObject({ kind: 'retention', profile_id: prof!.id });
    ov = await participantOverview(p.participantId);
    expect(ov.sessions).toHaveLength(2);
    expect(ov.available).toHaveLength(0);
  });
});
