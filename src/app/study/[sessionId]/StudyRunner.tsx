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
import { Logo } from '@/components/TopBar';
import { ConsentView, AudioSetupView, ScreeningView, RetentionScreeningView, PhaseIntro, CompletionView, EndedView } from './Screens';

const TRIAL_STAGES = ['diagnostic', 'learning', 'final_assessment', 'retention_test'];

const PHASE_NAMES: Record<string, string> = {
  diagnostic: 'Quick check',
  learning: 'Learning',
  final: 'Final challenge',
  retention: 'Follow-up check',
};
const ALL_LETTERS = ['E', 'T', 'A', 'N', 'I', 'M'];

export function StudyRunner({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [state, setState] = useState<SessionState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [audioReady, setAudioReady] = useState(false);
  const [phaseIntroSeen, setPhaseIntroSeen] = useState<Record<string, boolean>>({});
  const [confirmExit, setConfirmExit] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [streak, setStreak] = useState(0);
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
          onResult={(correct) => setStreak((k) => (correct ? k + 1 : 0))}
          streak={streak}
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
        {!(inTrials && trial && trial.phase === 'learning') && <Logo />}
        <div style={{ flex: 1, minWidth: 0 }}>
          {inTrials && trial && trial.phase === 'learning' ? (
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'nowrap', gap: 8 }}>
              <div className="letter-strip" aria-label={`Letters learned so far: ${trial.options.join(', ')}`}>
                {ALL_LETTERS.map((c) => {
                  const on = trial.options.includes(c);
                  const fresh = trial.introduce.some((x) => x.character === c);
                  return <span key={c} className={`letter-chip${on ? ' on' : ''}${fresh ? ' fresh' : ''}`}>{on ? c : '?'}</span>;
                })}
              </div>
              {streak >= 2 && <span className={`streak${streak >= 5 ? ' hot' : ''}`} aria-label={`${streak} correct in a row`}>🔥 {streak}</span>}
            </div>
          ) : inTrials && trial && progress ? (
            <>
              <span className="phase-label">{PHASE_NAMES[trial.phase]}</span>
              <div className="progress" aria-hidden><div style={{ width: `${pct}%` }} /></div>
            </>
          ) : (
            <span className="phase-label">Morse Study</span>
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
  const [msg, setMsg] = useState('Nice work! Getting the final challenge ready…');
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
      <div className="slide-icon" aria-hidden>🏁</div>
      <h2>Learning complete</h2>
      <p className="muted">{msg}</p>
    </div>
  );
}
