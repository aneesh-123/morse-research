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
const SLIDE_ICONS: [RegExp, string][] = [
  [/about/i, '🧪'],
  [/do/i, '🎧'],
  [/record/i, '📝'],
  [/stored|data/i, '🔒'],
  [/choice/i, '🙌'],
];
const iconFor = (heading: string) => SLIDE_ICONS.find(([re]) => re.test(heading))?.[1] ?? '💡';

/**
 * The consent document shown one section per slide. Every word of the document is shown; the
 * participant agrees on the last slide. The stored hash covers exactly these sections.
 */
export function ConsentView({ sessionId, consent, onDone }: { sessionId: string; consent: ConsentDocument & { sha256: string }; onDone: (s: SessionState) => void }) {
  const { busy, error, run } = useAction();
  const [i, setI] = useState(0);
  const n = consent.sections.length;
  const last = i === n - 1;
  const sec = consent.sections[i]!;
  const decide = (decision: 'agreed' | 'declined') =>
    run(async () => onDone(await apiFetch<SessionState>(`/api/sessions/${sessionId}/consent`, { decision, consentSha256: consent.sha256 })));
  return (
    <div className="slides">
      <p className="phase-label center" style={{ margin: '4px 0 0' }}>{consent.title}</p>
      <div className="dots" aria-hidden>{consent.sections.map((_, k) => <span key={k} className={k === i ? 'on' : ''} />)}</div>
      <section className="card slide" key={i} aria-live="polite">
        <div className="slide-icon" aria-hidden>{iconFor(sec.heading)}</div>
        <h2 className="center">{sec.heading}</h2>
        {sec.body.map((p, k) => <p key={k}>{p}</p>)}
        {last && <p className="small muted" style={{ margin: 0 }}>Consent version {consent.version}. Nothing about your activity is recorded until you agree.</p>}
      </section>
      {error && <div className="error" role="alert">{error}</div>}
      {last ? (
        <div className="stack">
          <button className="btn btn-primary btn-block" disabled={busy} onClick={() => void decide('agreed')} data-testid="consent-agree">{consent.agreeLabel}</button>
          <button className="btn btn-secondary btn-block" disabled={busy} onClick={() => void decide('declined')} data-testid="consent-decline">{consent.declineLabel}</button>
          <button className="btn btn-ghost btn-block" onClick={() => setI(i - 1)}>← Back</button>
        </div>
      ) : (
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          {i > 0 && <button className="btn btn-secondary" onClick={() => setI(i - 1)} aria-label="Previous">←</button>}
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => setI(i + 1)} data-testid="slide-next">Got it →</button>
        </div>
      )}
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
      <div className="center"><div className="slide-icon" aria-hidden>🎧</div><h1>Sound check</h1></div>
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
            🔊 Turn on sound
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
              <li>Reload this page and tap “Turn on sound” again. Your place is saved.</li>
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
      <div className="center"><div className="slide-icon" aria-hidden>🤔</div><h1>One quick question</h1></div>
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
const PHASE_TEXT: Record<string, { icon: string; title: string; body: string[] }> = {
  diagnostic: {
    icon: '🔎',
    title: 'Quick check',
    body: [
      'Before you learn anything, let’s see what you already know. You’ll hear 12 short beeps. Pick the letter you think it is, or tap “I don’t know”.',
      'No one is expected to know these yet. There’s no feedback here and each sound plays once.',
    ],
  },
  learning: {
    icon: '🚀',
    title: 'Let’s learn',
    body: [
      'You’ll unlock six letters, a couple at a time. Hear a beep, tap the letter, and we’ll show you if you got it.',
      'Want to hear it again? Tap “Play it again” as often as you like.',
    ],
  },
  final: {
    icon: '🏆',
    title: 'Final challenge',
    body: [
      'Show what you’ve learned! You’ll hear 24 beeps using all six letters. Pick the letter for each, or “I don’t know”.',
      'This round has no hints: each sound plays once and you’ll see your score at the end.',
    ],
  },
  retention: {
    icon: '🧠',
    title: 'Follow-up check',
    body: ['You’ll hear 24 beeps. Pick the letter for each, or “I don’t know”. Each sound plays once and you’ll see your score at the end.'],
  },
};

export function PhaseIntro({ phase, resumed, onStart }: { phase: string; resumed: boolean; optionsCount: number; onStart: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const txt = PHASE_TEXT[phase] ?? { icon: '▶️', title: 'Continue', body: [] };
  return (
    <div className="center">
      <div className="slide-icon" aria-hidden>{resumed ? '👋' : txt.icon}</div>
      <h1>{resumed ? 'Welcome back' : txt.title}</h1>
      <div className="card" style={{ textAlign: 'left' }}>
        {resumed ? <p style={{ margin: 0 }}>Everything so far is saved. Tap continue to turn the sound back on and pick up where you left off.</p> : txt.body.map((p, i) => <p key={i} style={i === txt.body.length - 1 ? { margin: 0 } : undefined}>{p}</p>)}
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
  const day1 = completion.studyType === 'day1_learning';
  return (
    <div data-testid="completion" className="center">
      <Confetti />
      <div className="slide-icon" aria-hidden>🎉</div>
      <h1>You did it!</h1>
      <p className="muted">{day1 ? 'You learned six Morse letters. Thanks for taking part!' : 'Follow-up done. Thanks for coming back!'}</p>
      <section className="card">
        <div className="score-ring">{t.correct}<span className="muted" style={{ fontSize: '1.4rem' }}> / {t.total}</span></div>
        <p className="muted" style={{ margin: '4px 0 0', fontWeight: 800 }}>{day1 ? 'Final challenge score' : 'Follow-up score'}</p>
        <div className="results">
          {t.perCharacter.map((c) => (
            <div key={c.character} className="result" aria-label={`${c.character}: ${c.correct} of ${c.total}`}>
              <div className="l">{c.character}</div>
              <div className="s" aria-hidden>{Array.from({ length: c.total }, (_, k) => <span key={k} className={k < c.correct ? '' : 'off'}>★</span>)}</div>
            </div>
          ))}
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          {completion.learning ? <>During practice you got {completion.learning.correct} of {completion.learning.total} right. </> : null}
          {completion.durationMinutes !== null ? <>It took about {Math.round(completion.durationMinutes)} minutes. </> : null}
          A few beeps per letter is only a rough snapshot, not a verdict on what you know.
        </p>
      </section>
      <section className="card card-tight small" style={{ textAlign: 'left' }}>
        Your profile is saved. If a follow-up session opens later, you’ll see it on your profile page. Nothing new starts without asking you first.
      </section>
      <a className="btn btn-primary btn-block" href="/home">Go to my profile</a>
    </div>
  );
}

function Confetti() {
  const colors = ['var(--accent)', 'var(--pop)', 'var(--sun)', 'var(--sky)', 'var(--mint)'];
  return (
    <div className="confetti" aria-hidden>
      {Array.from({ length: 40 }, (_, k) => {
        const angle = (Math.PI * 2 * k) / 40;
        const dist = 160 + (k % 5) * 50;
        return (
          <i
            key={k}
            style={{ background: colors[k % colors.length], animationDuration: '1600ms', animationDelay: `${(k % 7) * 40}ms`, ['--dx' as string]: `${Math.round(Math.cos(angle) * dist)}px`, ['--dy' as string]: `${Math.round(Math.sin(angle) * dist - 60)}px`, ['--rot' as string]: `${(k * 47) % 720 - 360}deg` } as React.CSSProperties}
          />
        );
      })}
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
    <div className="card center">
      <div className="slide-icon" aria-hidden>👋</div>
      <h1>Session ended</h1>
      <p>{text}</p>
      <a className="btn btn-secondary btn-block" href="/home">Go to my profile</a>
    </div>
  );
}
