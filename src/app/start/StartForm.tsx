'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { TopBar } from '@/components/TopBar';
import { apiFetch, ApiError } from '@/lib/client/api';
import { RecoveryCodeCard } from '@/components/RecoveryCodeCard';

export function StartForm({ emailAvailable }: { emailAvailable: boolean }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [adult, setAdult] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ recoveryCode: string; emailPending: boolean; name: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const r = await apiFetch<{ recoveryCode: string; emailPending: boolean; participant: { displayName: string } }>('/api/participants', {
        displayName: name,
        email: emailAvailable ? email.trim() || null : null,
        adultConfirmed: adult,
      });
      setCreated({ recoveryCode: r.recoveryCode, emailPending: r.emailPending, name: r.participant.displayName });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <>
        <TopBar />
        <main className="page">
          <div className="center" style={{ margin: '8px 0 16px' }}>
            <div className="slide-icon" aria-hidden>🎉</div>
            <h1>Nice to meet you, {created.name}!</h1>
            <p className="muted">One last thing before we start.</p>
          </div>
          {created.emailPending && (
            <div className="info">We sent a confirmation link to your email. You can confirm it later.</div>
          )}
          <RecoveryCodeCard code={created.recoveryCode} required={!created.emailPending} onDone={() => router.push('/home')} doneLabel="Let’s start" />
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar />
      <main className="page">
        <div className="center" style={{ margin: '8px 0 16px' }}>
          <div className="slide-icon" aria-hidden>👋</div>
          <h1>What should we call you?</h1>
          <p className="muted">Any nickname works. You don’t need a password.</p>
        </div>
        <form className="card" onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="name">Nickname</label>
            <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="nickname" placeholder="e.g. Sparky" required />
          </div>
          {emailAvailable && (
            <div className="field">
              <label htmlFor="email">Email <span className="muted">(optional)</span></label>
              <input id="email" className="input" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
              <div className="hint">Lets you sign back in with a code sent by email.</div>
            </div>
          )}
          <label className="check field">
            <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
            <span>I am 18 years old or older</span>
          </label>
          {error && <div className="error" role="alert">{error}</div>}
          <button className="btn btn-primary btn-block" disabled={busy || !name.trim() || !adult}>
            {busy ? 'Creating…' : 'Create my profile'}
          </button>
        </form>
        <p className="center">
          <Link href="/signin">I already have a profile</Link>
        </p>
      </main>
    </>
  );
}
