'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, apiWithRetry, ApiError, store } from '@/lib/client/api';
import { morseAudio } from '@/lib/client/audio';
import { Telemetry } from '@/lib/client/telemetry';
import { deviceInfo } from '@/lib/client/device';
import { telemetryAllowed } from '@/lib/protocol/state-machine';
import type { SessionState } from '@/lib/protocol/api-types';
import { TrialRunner } from './TrialRunner';
import { ConsentView, AudioSetupView, ScreeningView, RetentionScreeningView, PhaseIntro, CompletionView, EndedView } from './Screens';

const TRIAL_STAGES = ['diagnostic', 'learning', 'final_assessment', 'retention_test'];

const PHASE_NAMES: Record<string, string> = {
  diagnostic: 'Quick check',
  learning: 'Learning',
  final: 'Final test',
  retention: 'Follow-up check',
};

export function StudyRunner({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [state, setState] = useState<SessionState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [audioReady, setAudioReady] = useState(false);
  const [phaseIntroSeen, setPhaseIntroSeen] = useState<Record<string, boolean>>({});
  const [confirmExit, setConfirmExit] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const telemetry = useRef<Telemetry | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);
  const resumedFromStage = useRef<string | null>(null);

  // Initial load: replay any unsaved response from a previous page load, then record the resume.
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    (async () => {
      try {
        const pending = store.get<{ body: unknown }>(`mr_pending_${sessionId}`);
        if (pending) {
          try {
            await apiWithRetry(`/api/sessions/${sessionId}/responses`, pending.body);
          } catch {
            /* already answered or no longer valid: the server state below is authoritative */
          }
          store.remove(`mr_pending_${sessionId}`);
        }
        const st = await apiFetch<SessionState>(`/api/sessions/${sessionId}/resume`, {});
        resumedFromStage.current = st.stage;
        setPhaseIntroSeen(store.get<Record<string, boolean>>(`mr_intro_${sessionId}`) ?? {});
        setState(st);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) router.replace('/signin');
        else setLoadError(e instanceof ApiError ? e.message : 'Could not load the session.');
      }
    })();
  }, [sessionId, router]);

  // Telemetry starts only once consent has been given.
  useEffect(() => {
    if (!state || telemetry.current || !telemetryAllowed(state.stage)) return;
    const t = new Telemetry(sessionId, state.idleThresholdMs, () => root.current);
    telemetry.current = t;
    t.start();
    if (resumedFromStage.current && telemetryAllowed(resumedFromStage.current as never)) {
      t.log('session_resumed', { payload: { stage: state.stage } });
    } else {
      t.log('experiment_started', { payload: { protocolVersion: state.protocolVersion } });
    }
  }, [state, sessionId]);

  useEffect(() => () => telemetry.current?.stop(), []);

  // Screen tracking for non-trial screens.
  useEffect(() => {
    if (!state || !telemetry.current) return;
    if (!TRIAL_STAGES.includes(state.stage)) telemetry.current.enterScreen(state.stage);
    if (state.stage === 'completed') {
      telemetry.current.log('session_completed');
      void telemetry.current.flush(true);
    }
  }, [state?.stage, state]);

  const update = useCallback((st: SessionState) => setState(st), []);

  const markIntro = (phase: string) => {
    const next = { ...phaseIntroSeen, [phase]: true };
    setPhaseIntroSeen(next);
    store.set(`mr_intro_${sessionId}`, next);
  };

  async function unlockAudio(): Promise<boolean> {
    try {
      await morseAudio().unlock();
      setAudioReady(true);
      telemetry.current?.log('audio_unlocked');
      return true;
    } catch (e) {
      setNotice((e as Error).message || 'Sound could not be started on this device.');
      return false;
    }
  }

  function exitToHome() {
    telemetry.current?.log('session_paused', { payload: { stage: state?.stage ?? null } });
    morseAudio().stop();
    void telemetry.current?.flush(true);
    window.location.assign('/home');
  }

  if (loadError) {
    return (
      <main className="page">
        <div className="error" role="alert">{loadError}</div>
        <a className="btn btn-secondary" href="/home">Back to my profile</a>
      </main>
    );
  }
  if (!state) return <main className="page"><p className="muted" aria-live="polite">Loading…</p></main>;

  const trial = state.trial;
  const inTrials = TRIAL_STAGES.includes(state.stage) && trial;
  const progress = trial ? state.progress[trial.phase] : null;
  const pct = progress ? Math.round((progress.done / progress.total) * 100) : 0;

  let body: React.ReactNode;
  if (state.stage === 'consent_pending' && state.consent) {
    body = <ConsentView sessionId={sessionId} consent={state.consent} onDone={update} />;
  } else if (state.stage === 'audio_setup') {
    body = (
      <AudioSetupView
        audioParams={state.audio}
        onUnlock={unlockAudio}
        telemetry={telemetry.current}
        onConfirmed={async () => {
          const st = await apiFetch<SessionState>(`/api/sessions/${sessionId}/audio`, deviceInfo(morseAudio().info()));
          update(st);
        }}
      />
    );
  } else if (state.stage === 'baseline_screening') {
    body = <ScreeningView sessionId={sessionId} onDone={update} />;
  } else if (state.stage === 'retention_screening') {
    body = <RetentionScreeningView sessionId={sessionId} hoursSince={state.hoursSinceParent} onDone={update} />;
  } else if (inTrials && trial) {
    const needsIntro = trial.phaseIndex === 1 && !phaseIntroSeen[trial.phase];
    if (needsIntro || !audioReady) {
      body = (
        <PhaseIntro
          phase={trial.phase}
          resumed={!needsIntro}
          optionsCount={trial.options.length}
          onStart={async () => {
            if (await unlockAudio()) markIntro(trial.phase);
          }}
        />
      );
    } else {
      body = (
        <TrialRunner
          key={trial.position}
          sessionId={sessionId}
          trial={trial}
          audioParams={state.audio}
          telemetry={telemetry.current}
          onAdvance={update}
          onAudioLost={() => setAudioReady(false)}
        />
      );
    }
  } else if (state.stage === 'profile_generation') {
    body = <ProfileGeneration sessionId={sessionId} onDone={update} />;
  } else if (state.stage === 'completed' && state.completion) {
    body = <CompletionView completion={state.completion} />;
  } else {
    body = <EndedView stage={state.stage} />;
  }

  return (
    <div className="study-shell" ref={root}>
      <header className="study-header">
        <span className="brand-mark" aria-hidden>·−</span>
        <div style={{ flex: 1 }}>
          {inTrials && trial && progress ? (
            <>
              <div className="row small" style={{ justifyContent: 'space-between' }}>
                <span className="phase-label">
                  {PHASE_NAMES[trial.phase]}
                  {trial.block && trial.blockCount ? ` · block ${trial.block} of ${trial.blockCount}` : ''}
                </span>
                <span className="muted" data-testid="trial-counter">{trial.phaseIndex} / {trial.phaseTotal}</span>
              </div>
              <div className="progress" aria-hidden><div style={{ width: `${pct}%` }} /></div>
            </>
          ) : (
            <span className="phase-label">Morse Learning Study</span>
          )}
        </div>
        {state.stage !== 'completed' && (
          <button className="btn btn-ghost" onClick={() => setConfirmExit(true)} aria-label="Pause and leave">Exit</button>
        )}
      </header>
      <main className="study-main">
        {notice && <div className="notice" role="status">{notice} <button className="btn btn-ghost" onClick={() => setNotice(null)}>Dismiss</button></div>}
        {body}
      </main>
      {confirmExit && (
        <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="exit-title">
          <div className="card">
            <h2 id="exit-title">Take a break?</h2>
            <p>Everything you have answered is saved. You can come back to this session from your profile page and continue where you left off.</p>
            <div className="stack">
              <button className="btn btn-primary btn-block" onClick={() => setConfirmExit(false)}>Keep going</button>
              <button className="btn btn-secondary btn-block" onClick={exitToHome}>Leave for now</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProfileGeneration({ sessionId, onDone }: { sessionId: string; onDone: (s: SessionState) => void }) {
  const [msg, setMsg] = useState('Saving your learning results…');
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      for (let attempt = 1; ; attempt++) {
        try {
          const st = await apiFetch<SessionState>(`/api/sessions/${sessionId}/profile`, {});
          onDone(st);
          return;
        } catch (e) {
          if (e instanceof ApiError && e.code === 'wrong_stage') {
            onDone(await apiFetch<SessionState>(`/api/sessions/${sessionId}`));
            return;
          }
          setMsg('Still saving… please keep this page open.');
          await new Promise((r) => setTimeout(r, Math.min(10000, 1000 * attempt)));
        }
      }
    })();
  }, [sessionId, onDone]);
  return (
    <div className="card center" aria-live="polite">
      <h2>Learning complete</h2>
      <p className="muted">{msg}</p>
    </div>
  );
}
