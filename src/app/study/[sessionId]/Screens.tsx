'use client';
import { useState } from 'react';
import { apiFetch, ApiError } from '@/lib/client/api';
import { morseAudio } from '@/lib/client/audio';
import type { Telemetry } from '@/lib/client/telemetry';
import type { AudioParams } from '@/lib/protocol/morse';
import type { CompletionSummary, SessionState } from '@/lib/protocol/api-types';
import type { ConsentDocument } from '@/lib/protocol/consent';

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

// ------------------------------------------------------------------------------------ consent
export function ConsentView({ sessionId, consent, onDone }: { sessionId: string; consent: ConsentDocument & { sha256: string }; onDone: (s: SessionState) => void }) {
  const { busy, error, run } = useAction();
  const decide = (decision: 'agreed' | 'declined') =>
    run(async () => onDone(await apiFetch<SessionState>(`/api/sessions/${sessionId}/consent`, { decision, consentSha256: consent.sha256 })));
  return (
    <div>
      <h1>{consent.title}</h1>
      <div className="card">
        {consent.sections.map((s) => (
          <section key={s.heading} style={{ marginBottom: 14 }}>
            <h3>{s.heading}</h3>
            {s.body.map((p, i) => <p key={i}>{p}</p>)}
          </section>
        ))}
        <p className="small muted" style={{ margin: 0 }}>Consent version {consent.version}. Nothing about your activity is recorded until you agree.</p>
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      <div className="stack">
        <button className="btn btn-primary btn-block" disabled={busy} onClick={() => void decide('agreed')} data-testid="consent-agree">{consent.agreeLabel}</button>
        <button className="btn btn-secondary btn-block" disabled={busy} onClick={() => void decide('declined')} data-testid="consent-decline">{consent.declineLabel}</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------ audio
export function AudioSetupView({ audioParams, onUnlock, onConfirmed, telemetry }: { audioParams: AudioParams; onUnlock: () => Promise<boolean>; onConfirmed: () => Promise<void>; telemetry: Telemetry | null }) {
  const [enabled, setEnabled] = useState(false);
  const [played, setPlayed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [trouble, setTrouble] = useState(false);
  const { busy, error, run } = useAction();

  async function sample() {
    if (playing) return;
    setPlaying(true);
    try {
      // Test signal: the letter S (· · ·), which is not one of the study letters.
      await morseAudio().play('...', audioParams);
      telemetry?.log('audio_test_played', { payload: { n: played + 1 } });
      setPlayed((n) => n + 1);
    } finally {
      setPlaying(false);
    }
  }

  return (
    <div>
      <h1>Sound check</h1>
      <div className="card">
        <p>Put on headphones or turn your speaker up to a comfortable level. On an iPhone, check that the side switch is not on silent.</p>
        {!enabled ? (
          <button
            className="btn btn-primary btn-block"
            data-testid="enable-audio"
            onClick={() => run(async () => {
              if (await onUnlock()) {
                setEnabled(true);
                await sample();
              }
            })}
          >
            Enable audio
          </button>
        ) : (
          <div className="stack">
            <p>You should hear three short beeps. This test sound is not one of the letters you will learn.</p>
            <button className="btn btn-secondary btn-block" onClick={() => void sample()} disabled={playing} data-testid="play-sample">
              {playing ? 'Playing…' : '▶ Play the test sound again'}
            </button>
            <button className="btn btn-primary btn-block" disabled={busy || playing || played === 0} onClick={() => run(onConfirmed)} data-testid="audio-ok">
              I can hear it clearly
            </button>
            <button className="btn btn-ghost btn-block" onClick={() => setTrouble(true)}>I can’t hear anything</button>
          </div>
        )}
        {trouble && (
          <div className="notice">
            <strong>Try this:</strong>
            <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
              <li>Turn the volume up and take your phone off silent.</li>
              <li>Disconnect and reconnect Bluetooth headphones, or try the phone speaker.</li>
              <li>Close other apps that are playing sound.</li>
              <li>Reload this page and tap “Enable audio” again. Your place is saved.</li>
            </ul>
          </div>
        )}
        {error && <div className="error" role="alert">{error}</div>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------ screening
export function ScreeningView({ sessionId, onDone }: { sessionId: string; onDone: (s: SessionState) => void }) {
  const [rating, setRating] = useState(1);
  const [touched, setTouched] = useState(false);
  const [none, setNone] = useState(false);
  const { busy, error, run } = useAction();
  const value = none ? 1 : rating;
  return (
    <div>
      <h1>One quick question</h1>
      <div className="card">
        <label htmlFor="rating" style={{ fontSize: '1.1rem' }}>How much Morse code do you currently know?</label>
        <div className="slider-value" aria-hidden>{value}</div>
        <input
          id="rating"
          className="slider"
          type="range"
          min={1}
          max={10}
          step={1}
          value={value}
          disabled={none}
          onChange={(e) => { setRating(Number(e.target.value)); setTouched(true); }}
          aria-valuetext={`${value} of 10`}
          data-testid="rating"
        />
        <div className="slider-labels"><span>1 = None</span><span>10 = Expert</span></div>
        <label className="check" style={{ marginTop: 16 }}>
          <input type="checkbox" checked={none} onChange={(e) => setNone(e.target.checked)} data-testid="skip-diagnostic" />
          <span>I don’t know any Morse code — skip the diagnostic.</span>
        </label>
        <p className="hint">
          {none
            ? 'You will go straight to learning.'
            : 'Next is a short 12-question check of what you already know, without feedback. Guessing or “I don’t know” is fine.'}
        </p>
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      <button
        className="btn btn-primary btn-block"
        disabled={busy || (!none && !touched)}
        onClick={() => run(async () => onDone(await apiFetch<SessionState>(`/api/sessions/${sessionId}/screening`, { priorKnowledgeRating: value, skipDiagnostic: none })))}
        data-testid="screening-continue"
      >
        Continue
      </button>
      {!none && !touched && <p className="hint center">Move the slider (or tick the box) to continue.</p>}
    </div>
  );
}

export function RetentionScreeningView({ sessionId, hoursSince, onDone }: { sessionId: string; hoursSince: number | null; onDone: (s: SessionState) => void }) {
  const [answer, setAnswer] = useState<'no' | 'a_little' | 'a_lot' | null>(null);
  const { busy, error, run } = useAction();
  const opts: { v: 'no' | 'a_little' | 'a_lot'; l: string }[] = [
    { v: 'no', l: 'No' },
    { v: 'a_little', l: 'Yes, a little' },
    { v: 'a_lot', l: 'Yes, a lot' },
  ];
  return (
    <div>
      <h1>Welcome back</h1>
      <div className="card">
        {hoursSince !== null && <p className="muted">Your learning session was about {hoursSince < 48 ? `${Math.round(hoursSince)} hours` : `${Math.round(hoursSince / 24)} days`} ago.</p>}
        <p style={{ fontWeight: 600 }}>Since then, have you practised or looked up Morse code anywhere else?</p>
        <div className="stack" role="radiogroup">
          {opts.map((o) => (
            <label className="check" key={o.v}>
              <input type="radio" name="practiced" checked={answer === o.v} onChange={() => setAnswer(o.v)} />
              <span>{o.l}</span>
            </label>
          ))}
        </div>
        <p className="hint">Then you will hear the six letters again and pick what you hear. There is no feedback and each sound plays once.</p>
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      <button className="btn btn-primary btn-block" disabled={busy || !answer} onClick={() => run(async () => onDone(await apiFetch<SessionState>(`/api/sessions/${sessionId}/retention-screening`, { practicedSince: answer })))}>
        Continue
      </button>
    </div>
  );
}

// ------------------------------------------------------------------------------------ phase intros
const PHASE_TEXT: Record<string, { title: string; body: string[] }> = {
  diagnostic: {
    title: 'Quick check',
    body: [
      'You will hear 12 short Morse signals. For each one, pick the letter you think it is, or “I don’t know”.',
      'There is no feedback and each sound plays once. Nobody is expected to know these yet.',
    ],
  },
  learning: {
    title: 'Learning',
    body: [
      'You will learn six letters, a few at a time. New letters are added as you go, and you keep practising the earlier ones.',
      'After each answer you will see the correct letter. You can replay a sound before answering.',
    ],
  },
  final: {
    title: 'Final test',
    body: [
      'You will hear 24 signals using all six letters. Pick the letter for each, or “I don’t know”.',
      'This time there is no feedback, no replay and no chart. Each sound plays once.',
    ],
  },
  retention: {
    title: 'Follow-up check',
    body: ['You will hear 24 signals. Pick the letter for each, or “I don’t know”. There is no feedback and each sound plays once.'],
  },
};

export function PhaseIntro({ phase, resumed, onStart }: { phase: string; resumed: boolean; optionsCount: number; onStart: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const txt = PHASE_TEXT[phase] ?? { title: 'Continue', body: [] };
  return (
    <div>
      <h1>{resumed ? 'Welcome back' : txt.title}</h1>
      <div className="card">
        {resumed ? <p>Your answers so far are saved. Tap continue to switch the sound back on and carry on with the {txt.title.toLowerCase()}.</p> : txt.body.map((p, i) => <p key={i}>{p}</p>)}
      </div>
      <button className="btn btn-primary btn-block" disabled={busy} data-testid="phase-start" onClick={async () => { setBusy(true); await onStart(); setBusy(false); }}>
        {resumed ? 'Continue' : 'Start'}
      </button>
    </div>
  );
}

// ------------------------------------------------------------------------------------ end states
export function CompletionView({ completion }: { completion: CompletionSummary }) {
  const t = completion.test;
  return (
    <div data-testid="completion">
      <h1>All done — thank you!</h1>
      <div className="card">
        <p>{completion.studyType === 'day1_learning' ? 'You have completed the learning session.' : 'You have completed the follow-up check.'}</p>
        <h3>Your measured results</h3>
        <p>
          {completion.studyType === 'day1_learning' ? 'Final test' : 'Follow-up check'}: <strong>{t.correct} of {t.total}</strong> correct
          {completion.learning ? <> · during learning: {completion.learning.correct} of {completion.learning.total} correct</> : null}
          {completion.durationMinutes !== null ? <> · about {Math.round(completion.durationMinutes)} minutes</> : null}
        </p>
        <div className="row small">
          {t.perCharacter.map((c) => (
            <span key={c.character} className="badge">{c.character}: {c.correct}/{c.total}</span>
          ))}
        </div>
        <p className="hint">These are counts from the test itself. With only a few signals per letter they are a rough snapshot, not a verdict on what you know.</p>
      </div>
      <div className="card">
        <p style={{ margin: 0 }}>
          Your profile is saved. Follow-up sessions may become available later; you would see them on your profile page when you sign in again.
          Nothing new starts without asking you first.
        </p>
      </div>
      <a className="btn btn-primary btn-block" href="/home">Go to my profile</a>
    </div>
  );
}

export function EndedView({ stage }: { stage: string }) {
  const text = stage === 'declined'
    ? 'You chose not to take part. Nothing about this session was recorded apart from that choice.'
    : stage === 'withdrawn'
      ? 'This session was stopped.'
      : 'This session is closed.';
  return (
    <div className="card">
      <h1>Session ended</h1>
      <p>{text}</p>
      <a className="btn btn-secondary btn-block" href="/home">Go to my profile</a>
    </div>
  );
}
