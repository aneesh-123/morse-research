'use client';
import { useState } from 'react';
import { apiFetch, ApiError } from '@/lib/client/api';

export function ParticipantActions({ id, isTest }: { id: string; isTest: boolean }) {
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  async function act(body: unknown, then: () => void) {
    setError(null);
    try {
      await apiFetch(`/api/research/participants/${id}`, body);
      then();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed');
    }
  }
  return (
    <section className="card">
      <h2>Data management</h2>
      {error && <div className="error">{error}</div>}
      <div className="stack">
        <div>
          <button className="btn btn-secondary" onClick={() => act({ action: 'set_test', value: !isTest }, () => window.location.reload())}>
            {isTest ? 'Unmark as test participant' : 'Mark as test participant'}
          </button>
          <div className="hint">Test participants are excluded from overview and analysis by default and flagged in exports.</div>
        </div>
        <details>
          <summary>Delete this participant (withdrawal request)</summary>
          <p className="small">Permanently deletes the profile, credentials and every research row linked to it. This is logged in the audit log and cannot be undone.</p>
          <div className="row">
            <input className="input" style={{ maxWidth: 200 }} placeholder="Type DELETE" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            <button className="btn btn-danger" disabled={confirm !== 'DELETE'} onClick={() => act({ action: 'delete', confirm: 'DELETE' }, () => window.location.assign('/research/participants'))}>Delete</button>
          </div>
        </details>
      </div>
    </section>
  );
}
