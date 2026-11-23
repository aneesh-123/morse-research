'use client';
import { useState } from 'react';
import { apiFetch, ApiError } from '@/lib/client/api';

export default function ResearcherLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <main className="page">
      <h1>Researcher sign-in</h1>
      <form
        className="card"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await apiFetch('/api/research/login', { email, password });
            window.location.assign('/research');
          } catch (err) {
            setError(err instanceof ApiError ? err.message : 'Sign-in failed.');
            setBusy(false);
          }
        }}
      >
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <div className="error" role="alert">{error}</div>}
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <p className="small muted">Researcher accounts are created by the operator with <code>npm run researcher:create</code>.</p>
    </main>
  );
}
