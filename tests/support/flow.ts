import { randomUUID } from 'node:crypto';
import { q, q1 } from '@/lib/server/db';
import {
  completeAudioSetup, recordConsent, sessionState, startSession, submitResponse, submitScreening, submitRetentionScreening,
  type ResponseInput,
} from '@/lib/server/experiment';
import { createParticipant } from '@/lib/server/participants';
import type { SessionState, SubmitResult } from '@/lib/protocol/api-types';

export const CLIENT_INFO = {
  deviceCategory: 'mobile' as const, browserFamily: 'Safari', osFamily: 'iOS', touch: true, maxTouchPoints: 5,
  viewportWidth: 390, viewportHeight: 844, devicePixelRatio: 3, audioSampleRate: 48000, audioBaseLatencyMs: 5,
  audioOutputLatencyMs: 20, hasGetOutputTimestamp: true, prefersReducedMotion: false,
};

export async function newParticipant(name = 'Tester') {
  return createParticipant({ displayName: name, adultConfirmed: true });
}

export async function targetAt(sessionId: string, position: number): Promise<string> {
  const r = await q1<{ target: string }>(`SELECT target FROM trial_schedule WHERE session_id = $1 AND position = $2`, [sessionId, position]);
  if (!r) throw new Error('no schedule row');
  return r.target;
}

export function responseFor(state: SessionState, response: string | null, extra: Partial<ResponseInput> = {}): ResponseInput {
  const t = state.trial;
  if (!t) throw new Error(`no trial at stage ${state.stage}`);
  const base = 1000 + t.position * 3000;
  return {
    clientResponseId: randomUUID(),
    position: t.position,
    response,
    presentationNumber: 1,
    replayCount: 0,
    clientLoadId: '00000000-0000-4000-8000-000000000001',
    clientTimeOriginEpochMs: 1_760_000_000_000,
    trialShownMs: base,
    playbackRequestedMs: base + 10,
    playbackStartEstMs: base + 260,
    playbackEndExpectedMs: base + 600,
    playbackEndObservedMs: base + 605,
    lastPlaybackEndMs: base + 605,
    answersEnabledMs: base + 606,
    responseMs: base + 1400,
    signalDurationMs: 340,
    audioOutputLatencyMs: 20,
    tabHiddenDuring: false,
    hiddenDurationMs: null,
    windowBlurredDuring: false,
    blurDurationMs: null,
    playbackInterrupted: false,
    clientSubmittedEpochMs: 1_760_000_010_000,
    ...extra,
  };
}

export type Strategy = (target: string, options: string[], state: SessionState) => string | null;
export const perfect: Strategy = (t) => t;
export const wrong: Strategy = (t, opts) => opts.find((o) => o !== t) ?? null;

export async function startDay1(participantId: string, opts: { skipDiagnostic: boolean; rating?: number }): Promise<SessionState> {
  const { sessionId } = await startSession(participantId, 'day1_learning');
  const st = await sessionState(participantId, sessionId);
  await recordConsent(participantId, sessionId, { decision: 'agreed', consentSha256: st.consent!.sha256 });
  await completeAudioSetup(participantId, sessionId, CLIENT_INFO);
  return submitScreening(participantId, sessionId, { priorKnowledgeRating: opts.rating ?? (opts.skipDiagnostic ? 1 : 3), skipDiagnostic: opts.skipDiagnostic });
}

export async function startRetention(participantId: string): Promise<SessionState> {
  const { sessionId } = await startSession(participantId, 'delayed_retention');
  const st = await sessionState(participantId, sessionId);
  await recordConsent(participantId, sessionId, { decision: 'agreed', consentSha256: st.consent!.sha256 });
  await completeAudioSetup(participantId, sessionId, CLIENT_INFO);
  return submitRetentionScreening(participantId, sessionId, { practicedSince: 'no' });
}

/** Answers trials until the stage leaves `untilStageNot` or the session completes. */
export async function answerWhile(participantId: string, state: SessionState, stages: string[], strategy: Strategy): Promise<{ state: SessionState; results: SubmitResult[] }> {
  const results: SubmitResult[] = [];
  let st = state;
  while (st.trial && stages.includes(st.stage)) {
    const target = await targetAt(st.sessionId, st.trial.position);
    const r = await submitResponse(participantId, st.sessionId, responseFor(st, strategy(target, st.trial.options, st)));
    results.push(r);
    st = r.state;
  }
  return { state: st, results };
}

export async function countRows(table: string, sessionId: string): Promise<number> {
  const r = await q<{ n: string }>(`SELECT count(*)::text AS n FROM ${table} WHERE session_id = $1`, [sessionId]);
  return Number(r[0]?.n ?? 0);
}
