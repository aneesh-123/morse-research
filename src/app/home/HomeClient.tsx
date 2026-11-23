'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch, ApiError } from '@/lib/client/api';
import { RecoveryCodeCard } from '@/components/RecoveryCodeCard';

export function StartButton({ studyType }: { studyType: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      {error && <div className="error" role="alert">{error}</div>}
      <button
        className="btn btn-primary btn-block"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const r = await apiFetch<{ sessionId: string }>('/api/sessions', { studyType });
            router.push(`/study/${r.sessionId}`);
          } catch (e) {
            setError(e instanceof ApiError ? e.message : 'Could not start the session.');
            setBusy(false);
          }
        }}
      >
        {busy ? 'Starting…' : 'Start'}
      </button>
    </>
  );
}

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      className="btn btn-ghost"
      onClick={async () => {
        await apiFetch('/api/auth/signout', {}).catch(() => undefined);
        router.push('/');
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}

export function HomeActions({ email, emailVerified, emailAvailable }: { email: string | null; emailVerified: boolean; emailAvailable: boolean }) {
  const router = useRouter();
  const [newEmail, setNewEmail] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  if (code) {
    return <RecoveryCodeCard code={code} required={!email} doneLabel="Done" onDone={() => setCode(null)} />;
  }

  return (
    <section className="card">
      <h2>Account</h2>
      {msg && <div className="info" role="status">{msg}</div>}
      {err && <div className="error" role="alert">{err}</div>}
      <div className="stack">
        <div>
          <strong>Email</strong>
          <div className="muted small">
            {email ? <>{email} · {emailVerified ? 'confirmed' : 'not confirmed yet (check your inbox)'}</> : 'No email added. You sign in with your recovery code.'}
          </div>
          {emailAvailable && (
            <form className="row" style={{ marginTop: 8 }} onSubmit={(e) => { e.preventDefault(); void run(async () => { await apiFetch('/api/me/email', { email: newEmail }); setMsg('We sent a confirmation link and code to that address.'); setNewEmail(''); router.refresh(); }); }}>
              <input className="input" style={{ flex: '1 1 200px' }} type="email" placeholder={email ? 'Change email' : 'Add an email'} value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
              <button className="btn btn-secondary" disabled={busy || !newEmail.includes('@')}>Save</button>
            </form>
          )}
        </div>
        <div>
          <strong>Recovery code</strong>
          <div className="muted small">Lost it? Make a new one. The old code stops working.</div>
          <button className="btn btn-secondary" style={{ marginTop: 8 }} disabled={busy} onClick={() => run(async () => { const r = await apiFetch<{ recoveryCode: string }>('/api/me/recovery-code', {}); setCode(r.recoveryCode); })}>
            Create a new recovery code
          </button>
        </div>
        <details>
          <summary>Delete my data and leave the study</summary>
          <p className="small" style={{ marginTop: 8 }}>
            This permanently deletes your profile and all study data linked to it (answers, timings, events and results). It cannot be undone.
            See <Link href="/privacy">privacy information</Link>.
          </p>
          <label htmlFor="del" className="small">Type DELETE to confirm</label>
          <div className="row">
            <input id="del" className="input" style={{ flex: '1 1 160px' }} value={confirmDelete} onChange={(e) => setConfirmDelete(e.target.value)} autoComplete="off" />
            <button className="btn btn-danger" disabled={busy || confirmDelete !== 'DELETE'} onClick={() => run(async () => { await apiFetch('/api/me/delete', { confirm: 'DELETE' }); router.push('/?deleted=1'); router.refresh(); })}>
              Delete everything
            </button>
          </div>
        </details>
      </div>
    </section>
  );
}
