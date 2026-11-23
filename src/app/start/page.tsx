'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { TopBar } from '@/components/TopBar';
import { apiFetch, ApiError } from '@/lib/client/api';
import { RecoveryCodeCard } from '@/components/RecoveryCodeCard';

export default function StartPage() {
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
        email: email.trim() || null,
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
          <h1>Welcome, {created.name}</h1>
          {created.emailPending && (
            <div className="info">We sent a confirmation link to your email. You can confirm it later; you can start the study now.</div>
          )}
          <RecoveryCodeCard
            code={created.recoveryCode}
            required={!created.emailPending}
            onDone={() => router.push('/home')}
          />
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar />
      <main className="page">
        <h1>Create your learner profile</h1>
        <p className="muted">Your profile lets you return later. We do not need your real name.</p>
        <form className="card" onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="name">Nickname</label>
            <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="nickname" required />
            <div className="hint">Shown only to you and the researchers. Other people can use the same nickname.</div>
          </div>
          <div className="field">
            <label htmlFor="email">Email <span className="muted">(optional)</span></label>
            <input id="email" className="input" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            <div className="hint">Lets you sign in on another device with a one-time link or code. Without it, you will get a recovery code to save instead.</div>
          </div>
          <label className="check field">
            <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
            <span>I am 18 years old or older</span>
          </label>
          {error && <div className="error" role="alert">{error}</div>}
          <button className="btn btn-primary btn-block" disabled={busy || !name.trim() || !adult}>
            {busy ? 'Creating…' : 'Create profile'}
          </button>
        </form>
        <p className="center">
          <Link href="/signin">I already have a profile</Link>
        </p>
      </main>
    </>
  );
}
