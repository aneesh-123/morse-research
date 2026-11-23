'use client';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { TopBar } from '@/components/TopBar';
import { apiFetch, ApiError } from '@/lib/client/api';

function SignInInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [otp, setOtp] = useState('');
  const [recovery, setRecovery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(params.get('link') === 'expired' ? 'That sign-in link has expired or was already used. Request a new one.' : null);

  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <TopBar />
      <main className="page">
        <h1>Sign in to your learner profile</h1>
        <div className="row" role="tablist" style={{ marginBottom: 12 }}>
          <button role="tab" aria-selected={mode === 'email'} className={`btn ${mode === 'email' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode('email')}>
            With email
          </button>
          <button role="tab" aria-selected={mode === 'code'} className={`btn ${mode === 'code' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode('code')}>
            With recovery code
          </button>
        </div>
        {error && <div className="error" role="alert">{error}</div>}

        {mode === 'email' ? (
          <section className="card">
            {!sent ? (
              <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await apiFetch('/api/auth/email/start', { email }); setSent(true); }); }}>
                <div className="field">
                  <label htmlFor="email">Email</label>
                  <input id="email" className="input" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </div>
                <button className="btn btn-primary btn-block" disabled={busy || !email.includes('@')}>{busy ? 'Sending…' : 'Send me a sign-in code'}</button>
              </form>
            ) : (
              <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await apiFetch('/api/auth/email/verify', { email, code: otp }); router.push('/home'); }); }}>
                <p>If a profile uses <strong>{email}</strong>, we sent it a link and a 6-digit code. Open the link, or type the code here.</p>
                <div className="field">
                  <label htmlFor="otp">6-digit code</label>
                  <input id="otp" className="input" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} />
                </div>
                <button className="btn btn-primary btn-block" disabled={busy || otp.length !== 6}>{busy ? 'Checking…' : 'Sign in'}</button>
                <button type="button" className="btn btn-ghost btn-block" onClick={() => { setSent(false); setOtp(''); }}>Use a different email</button>
              </form>
            )}
          </section>
        ) : (
          <section className="card">
            <form onSubmit={(e) => { e.preventDefault(); void run(async () => { await apiFetch('/api/auth/recovery', { code: recovery }); router.push('/home'); }); }}>
              <div className="field">
                <label htmlFor="recovery">Recovery code</label>
                <input id="recovery" className="input" autoCapitalize="characters" autoComplete="off" spellCheck={false} value={recovery} onChange={(e) => setRecovery(e.target.value)} placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXXX" />
              </div>
              <button className="btn btn-primary btn-block" disabled={busy || recovery.replace(/[^0-9a-z]/gi, '').length < 20}>{busy ? 'Checking…' : 'Sign in'}</button>
            </form>
          </section>
        )}
        <p className="center"><Link href="/start">Create a new profile instead</Link></p>
      </main>
    </>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInInner />
    </Suspense>
  );
}
