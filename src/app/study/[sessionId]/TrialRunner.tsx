'use client';
import { useEffect, useRef, useState } from 'react';
import { apiWithRetry, ApiError, apiFetch, store, uuid } from '@/lib/client/api';
import { morseAudio, type PlaybackRecord } from '@/lib/client/audio';
import type { Telemetry } from '@/lib/client/telemetry';
import type { AudioParams } from '@/lib/protocol/morse';
import type { ClientTrial, LearningFeedback, SessionState, SubmitResult } from '@/lib/protocol/api-types';
import { Pattern } from '@/components/Pattern';

type Step = 'intro' | 'waiting' | 'playing' | 'answer' | 'replaying' | 'saving' | 'feedback' | 'paused';

/** Fixed pause between showing a trial and starting its signal (ms). */
const PRE_SIGNAL_MS = 500;
/** Fixed pause before the next trial when no feedback is shown (ms). */
const INTER_TRIAL_MS = 400;

interface TimingState {
  presentationNumber: number;
  trialShownMs: number | null;
  first: PlaybackRecord | null;
  answersEnabledMs: number | null;
  lastPlaybackEndMs: number | null;
  replayCount: number;
  tabHiddenDuring: boolean;
  hiddenStart: number | null;
  hiddenDurationMs: number;
  windowBlurredDuring: boolean;
  blurStart: number | null;
  blurDurationMs: number;
  playbackInterrupted: boolean;
}

const now = () => performance.now();

export function TrialRunner(props: {
  sessionId: string;
  trial: ClientTrial;
  audioParams: AudioParams;
  telemetry: Telemetry | null;
  onAdvance: (s: SessionState) => void;
  onAudioLost: () => void;
  /** Called after a learning answer is scored, for streaks and celebration. */
  onResult?: (correct: boolean) => void;
  /** Current run of correct learning answers, including this one once scored. */
  streak?: number;
}) {
  const { sessionId, trial, audioParams, telemetry, onAdvance } = props;
  const audio = morseAudio();
  const [step, setStep] = useState<Step>(trial.introduce.length ? 'intro' : 'waiting');
  const [selected, setSelected] = useState<string | null | undefined>(undefined);
  const [feedback, setFeedback] = useState<LearningFeedback | null>(null);
  const [nextState, setNextState] = useState<SessionState | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stepRef = useRef<Step>(step);
  stepRef.current = step;
  const t = useRef<TimingState>({
    presentationNumber: 0, trialShownMs: null, first: null, answersEnabledMs: null, lastPlaybackEndMs: null, replayCount: 0,
    tabHiddenDuring: false, hiddenStart: null, hiddenDurationMs: 0, windowBlurredDuring: false, blurStart: null, blurDurationMs: 0,
    playbackInterrupted: false,
  });
  const started = useRef(false);
  const screen = `${trial.phase}_trial`;
  const log: Telemetry['log'] = (type, o = {}) => telemetry?.log(type, { trialPosition: trial.position, ...o });

  // ------------------------------------------------------------------ presentation
  function begin() {
    const presKey = `mr_pres_${sessionId}_${trial.position}`;
    const n = (store.get<number>(presKey) ?? 0) + 1;
    store.set(presKey, n);
    t.current.presentationNumber = n;
    t.current.trialShownMs = now();
    t.current.first = null;
    t.current.answersEnabledMs = null;
    t.current.lastPlaybackEndMs = null;
    telemetry?.enterScreen(screen, trial.position);
    if (n > 1) log('trial_restarted', { payload: { presentationNumber: n } });
    log('trial_presented', { payload: { presentationNumber: n, phase: trial.phase } });
    setStep('waiting');
    setTimeout(() => void playInitial(), PRE_SIGNAL_MS);
  }

  async function playInitial() {
    if (stepRef.current !== 'waiting') return;
    setStep('playing');
    let rec: PlaybackRecord;
    try {
      rec = await audio.play(trial.pattern, audioParams);
    } catch {
      props.onAudioLost();
      return;
    }
    if (rec.interrupted) return; // visibility handler takes over
    t.current.first = rec;
    t.current.lastPlaybackEndMs = rec.endObservedMs ?? rec.endExpectedMs;
    t.current.answersEnabledMs = now();
    log('audio_played', { payload: { kind: 'initial', durationMs: rec.durationMs, scheduleToStartMs: Math.round(rec.startEstMs - rec.requestedMs), endLagMs: rec.endObservedMs === null ? null : Math.round(rec.endObservedMs - rec.endExpectedMs), endEventMissing: rec.endEventMissing } });
    setStep('answer');
  }

  async function replay(kind: 'replay' | 'feedback') {
    if (kind === 'replay' && (stepRef.current !== 'answer' || !trial.replayAllowed)) return;
    if (kind === 'feedback' && stepRef.current !== 'feedback') return;
    const prev = stepRef.current;
    if (kind === 'replay') {
      t.current.replayCount++;
      setStep('replaying');
      log('audio_replayed', { payload: { replayNumber: t.current.replayCount } });
    } else {
      log('feedback_replayed');
    }
    try {
      const rec = await audio.play(kind === 'feedback' && feedback ? feedback.correctPattern : trial.pattern, audioParams);
      if (kind === 'replay' && !rec.interrupted) t.current.lastPlaybackEndMs = rec.endObservedMs ?? rec.endExpectedMs;
    } catch {
      /* sound unavailable: answering is still possible */
    }
    if (stepRef.current === 'replaying') setStep(prev === 'replaying' ? 'answer' : prev);
  }

  // Start (or show character introduction first) once.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (trial.introduce.length) {
      telemetry?.enterScreen('introduction', trial.position);
      log('intro_shown', { payload: { characters: trial.introduce.map((i) => i.character).join('') } });
    } else {
      begin();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------------ interruptions
  useEffect(() => {
    function onVis() {
      const s = stepRef.current;
      if (document.visibilityState === 'hidden') {
        if (['waiting', 'playing', 'answer', 'replaying', 'saving'].includes(s)) {
          t.current.tabHiddenDuring = true;
          t.current.hiddenStart = now();
        }
        if (s === 'playing' || s === 'waiting') {
          // The first presentation did not finish: restart the trial when the page is visible again.
          audio.stop();
          t.current.playbackInterrupted = true;
          log('playback_interrupted', { payload: { during: s } });
          setStep('paused');
        } else if (s === 'replaying') {
          audio.stop();
          log('playback_interrupted', { payload: { during: 'replay' } });
        }
      } else if (t.current.hiddenStart !== null) {
        t.current.hiddenDurationMs += now() - t.current.hiddenStart;
        t.current.hiddenStart = null;
      }
    }
    function onBlur() {
      const s = stepRef.current;
      if (['waiting', 'playing', 'answer', 'replaying'].includes(s)) {
        t.current.windowBlurredDuring = true;
        t.current.blurStart = now();
      }
    }
    function onFocus() {
      if (t.current.blurStart !== null) {
        t.current.blurDurationMs += now() - t.current.blurStart;
        t.current.blurStart = null;
      }
    }
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      audio.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------------ answering
  async function answer(response: string | null) {
    if (stepRef.current !== 'answer') return;
    const responseMs = now();
    setSelected(response);
    setStep('saving');
    const tm = t.current;
    if (tm.hiddenStart !== null) { tm.hiddenDurationMs += responseMs - tm.hiddenStart; tm.hiddenStart = null; }
    if (tm.blurStart !== null) { tm.blurDurationMs += responseMs - tm.blurStart; tm.blurStart = null; }
    log('answer_selected', { payload: { response: response ?? 'idk', replayCount: tm.replayCount } });
    const body = {
      clientResponseId: uuid(),
      position: trial.position,
      response,
      presentationNumber: tm.presentationNumber,
      replayCount: tm.replayCount,
      clientLoadId: telemetry?.clientLoadId ?? uuid(),
      clientTimeOriginEpochMs: performance.timeOrigin,
      trialShownMs: tm.trialShownMs,
      playbackRequestedMs: tm.first?.requestedMs ?? null,
      playbackStartEstMs: tm.first?.startEstMs ?? null,
      playbackEndExpectedMs: tm.first?.endExpectedMs ?? null,
      playbackEndObservedMs: tm.first?.endObservedMs ?? null,
      lastPlaybackEndMs: tm.lastPlaybackEndMs,
      answersEnabledMs: tm.answersEnabledMs,
      responseMs,
      signalDurationMs: tm.first?.durationMs ?? 0,
      audioOutputLatencyMs: tm.first?.outputLatencyMs ?? null,
      tabHiddenDuring: tm.tabHiddenDuring,
      hiddenDurationMs: tm.tabHiddenDuring ? Math.round(tm.hiddenDurationMs) : null,
      windowBlurredDuring: tm.windowBlurredDuring,
      blurDurationMs: tm.windowBlurredDuring ? Math.round(tm.blurDurationMs) : null,
      playbackInterrupted: tm.playbackInterrupted,
      clientSubmittedEpochMs: Date.now(),
    };
    store.set(`mr_pending_${sessionId}`, { body });
    let result: SubmitResult;
    try {
      result = await apiWithRetry<SubmitResult>(`/api/sessions/${sessionId}/responses`, body, (attempt) => {
        setSaveMsg('Saving your answer… check your connection. Your answer will be sent when you are back online.');
        if (attempt === 1) log('save_retry');
      });
    } catch (e) {
      store.remove(`mr_pending_${sessionId}`);
      // Final refusal (e.g. already answered on another device): resync with the server.
      setError(e instanceof ApiError ? e.message : 'Could not save.');
      const st = await apiFetch<SessionState>(`/api/sessions/${sessionId}`).catch(() => null);
      if (st) onAdvance(st);
      return;
    }
    store.remove(`mr_pending_${sessionId}`);
    store.remove(`mr_pres_${sessionId}_${trial.position}`);
    setSaveMsg(null);
    if (result.feedback) {
      setFeedback(result.feedback);
      setNextState(result.state);
      props.onResult?.(result.feedback.correct);
      setStep('feedback');
      telemetry?.enterScreen('feedback', trial.position);
      log('feedback_displayed', { payload: { correct: result.feedback.correct } });
    } else {
      setTimeout(() => onAdvance(result.state), INTER_TRIAL_MS);
    }
  }

  function next() {
    if (!nextState) return;
    log('next_trial_requested');
    onAdvance(nextState);
  }

  // ------------------------------------------------------------------ render
  if (step === 'intro') {
    return <Introduction trial={trial} audioParams={audioParams} log={log} onStart={begin} />;
  }

  if (step === 'paused') {
    return (
      <div className="card center" role="alertdialog" aria-labelledby="paused-title">
        <h2 id="paused-title">Paused</h2>
        <p>The sound was interrupted because the page was hidden. This letter will be played again from the start.</p>
        <button
          className="btn btn-primary btn-block"
          onClick={async () => {
            try {
              await audio.unlock();
            } catch {
              /* begin() reports audio problems */
            }
            begin();
          }}
        >
          Continue
        </button>
      </div>
    );
  }

  if (step === 'feedback' && feedback) {
    const streak = props.streak ?? 0;
    return (
      <div>
        {feedback.correct && <Celebration />}
        <div className={`feedback ${feedback.correct ? 'good' : 'bad'}`} role="status" aria-live="polite" data-testid="feedback">
          <div className="verdict">{feedback.correct ? cheerFor(streak) : 'Not quite!'}</div>
          {!feedback.correct && (
            <div className="muted">You picked {feedback.response ?? '“I don’t know”'}. That sound was:</div>
          )}
          <div className="big-letter">{feedback.correctCharacter}</div>
          <Pattern pattern={feedback.correctPattern} />
          {feedback.correct && streak >= 3 && <div className="cheer">🔥 {streak} in a row</div>}
        </div>
        <div className="stack">
          <button className="btn btn-primary btn-block" onClick={next} data-testid="next">Keep going →</button>
          <button className="btn btn-secondary btn-block" onClick={() => void replay('feedback')}>🔊 Hear {feedback.correctCharacter} again</button>
        </div>
      </div>
    );
  }

  const canAnswer = step === 'answer';
  const listening = step === 'playing' || step === 'replaying';
  const n = trial.options.length;
  return (
    <div>
      <div className="signal-area">
        <div className={`listen-indicator${listening ? ' on' : ''}`} aria-hidden>{listening ? '🔊' : step === 'waiting' ? '👂' : '?'}</div>
        <div className="status-line" aria-live="polite" data-testid="status">
          {step === 'waiting' ? 'Get ready…' : listening ? 'Listen…' : step === 'saving' ? (saveMsg ?? (trial.phase === 'learning' ? 'Checking…' : 'Got it')) : 'Which letter was that?'}
        </div>
        {trial.replayAllowed && (
          <button className="btn btn-ghost" onClick={() => void replay('replay')} disabled={!canAnswer} data-testid="replay">
            🔁 Play it again
          </button>
        )}
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      <div className={`answers n${n <= 2 ? 2 : n === 4 ? 4 : 3}${canAnswer ? ' ready' : ''}`} role="group" aria-label="Answer options">
        {trial.options.map((o) => (
          <button
            key={o}
            className={`answer${selected === o ? ' selected' : ''}`}
            disabled={!canAnswer}
            onClick={() => void answer(o)}
            aria-label={`Letter ${o}`}
            data-testid={`answer-${o}`}
          >
            {o}
          </button>
        ))}
      </div>
      {trial.includeIdk && (
        <button className={`btn btn-secondary btn-block idk${selected === null ? ' selected' : ''}`} disabled={!canAnswer} onClick={() => void answer(null)} data-testid="answer-idk">
          I don’t know
        </button>
      )}
      {!trial.replayAllowed && <p className="hint center">Each sound plays once in this part.</p>}
    </div>
  );
}

function Introduction({ trial, audioParams, log, onStart }: { trial: ClientTrial; audioParams: AudioParams; log: Telemetry['log']; onStart: () => void }) {
  const audio = morseAudio();
  const [playing, setPlaying] = useState<string | null>(null);
  const auto = useRef(false);

  async function play(character: string, pattern: string, automatic: boolean) {
    setPlaying(character);
    log('intro_played', { payload: { character, automatic } });
    try {
      await audio.play(pattern, audioParams);
    } catch {
      /* ignore */
    }
    setPlaying(null);
  }

  useEffect(() => {
    if (auto.current) return;
    auto.current = true;
    (async () => {
      for (const c of trial.introduce) {
        await play(c.character, c.pattern, true);
        await new Promise((r) => setTimeout(r, 600));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const first = trial.block === 1;
  const words = wordsFor(trial.options, trial.introduce.map((c) => c.character));
  return (
    <div className="stack unlock">
      <span className="badge-new">{first ? 'Your first letters' : 'New letter unlocked'}</span>
      <h2>{first ? 'Meet E and T' : `Say hello to ${trial.introduce.map((c) => c.character).join(' and ')}`}</h2>
      <p className="muted">
        {first
          ? 'Listen to how each one sounds. Then you’ll hear them one at a time. Just tap the letter you hear.'
          : 'It joins the letters you already know. Listen to it a couple of times.'}
      </p>
      {trial.introduce.map((c) => (
        <div className="letter-card" key={c.character} data-testid={`intro-${c.character}`}>
          <div className="big-letter">{c.character}</div>
          <Pattern pattern={c.pattern} />
          <div style={{ marginTop: 14 }}>
            <button className="btn btn-secondary" disabled={playing !== null} onClick={() => void play(c.character, c.pattern, false)}>
              {playing === c.character ? '🔊 Playing…' : `🔊 Play ${c.character}`}
            </button>
          </div>
        </div>
      ))}
      {words.length > 0 && !first && (
        <div>
          <p className="small muted" style={{ margin: '4px 0 0', fontWeight: 800 }}>Words you can spell now</p>
          <div className="words">{words.map((w, k) => <span key={w} style={{ animationDelay: `${k * 90}ms` }}>{w}</span>)}</div>
        </div>
      )}
      <button className="btn btn-primary btn-block" onClick={onStart} disabled={playing !== null} data-testid="start-practice">
        {first ? 'I’m ready' : 'Let’s practise'}
      </button>
    </div>
  );
}

const WORDS = ['TEE', 'TEA', 'EAT', 'ATE', 'TAN', 'ANT', 'NET', 'TEN', 'NEAT', 'TEEN', 'TIN', 'TINT', 'NINE', 'INN', 'MEAT', 'TEAM', 'MATE', 'MINT', 'TIME', 'NAME', 'MAIN', 'MEAN', 'ITEM', 'ANIMATE'];

/** Decorative words spelled only with letters already learned, preferring ones that use the new letter. Shown before practice, never during a trial. */
function wordsFor(active: string[], fresh: string[]): string[] {
  const ok = WORDS.filter((w) => [...w].every((c) => active.includes(c)));
  const withNew = ok.filter((w) => fresh.some((c) => w.includes(c)));
  return [...withNew, ...ok.filter((w) => !withNew.includes(w))].slice(0, 5);
}

const CHEERS = ['Nice!', 'Yes!', 'Great ear!', 'Spot on!', 'You got it!', 'Nailed it!'];
function cheerFor(streak: number): string {
  if (streak >= 5) return 'Unstoppable!';
  return CHEERS[streak % CHEERS.length] ?? 'Nice!';
}

const CONFETTI_COLORS = ['var(--accent)', 'var(--pop)', 'var(--sun)', 'var(--sky)', 'var(--mint)'];

/** Screen flash plus a short confetti burst. Hidden for people who prefer reduced motion. */
function Celebration() {
  const [pieces] = useState(() =>
    Array.from({ length: 26 }, (_, k) => {
      const angle = (Math.PI * 2 * k) / 26 + Math.random() * 0.4;
      const dist = 140 + Math.random() * 180;
      return {
        dx: `${Math.round(Math.cos(angle) * dist)}px`,
        dy: `${Math.round(Math.sin(angle) * dist - 80)}px`,
        rot: `${Math.round(Math.random() * 720 - 360)}deg`,
        color: CONFETTI_COLORS[k % CONFETTI_COLORS.length],
        delay: `${Math.round(Math.random() * 80)}ms`,
      };
    }),
  );
  return (
    <>
      <div className="flash" aria-hidden />
      <div className="confetti" aria-hidden>
        {pieces.map((p, k) => (
          <i key={k} style={{ background: p.color, animationDelay: p.delay, ['--dx' as string]: p.dx, ['--dy' as string]: p.dy, ['--rot' as string]: p.rot } as React.CSSProperties} />
        ))}
      </div>
    </>
  );
}
