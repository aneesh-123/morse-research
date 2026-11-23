'use client';
import { useState } from 'react';
import { apiFetch, ApiError } from '@/lib/client/api';

export function SessionActions({ id, canAbandon, canReevaluate }: { id: string; canAbandon: boolean; canReevaluate: boolean }) {
  const [error, setError] = useState<string | null>(null);
  async function act(action: string) {
    setError(null);
    try {
      await apiFetch(`/api/research/sessions/${id}`, { action });
      window.location.reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed');
    }
  }
  if (!canAbandon && !canReevaluate) return null;
  return (
    <div className="row" style={{ marginTop: 12 }}>
      {canAbandon && <button className="btn btn-secondary" onClick={() => act('abandon')}>Mark as abandoned</button>}
      {canReevaluate && <button className="btn btn-secondary" onClick={() => act('reevaluate')}>Compute missing evaluation</button>}
      {error && <span className="error">{error}</span>}
    </div>
  );
}
