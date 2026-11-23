'use client';
import { apiFetch } from '@/lib/client/api';

export function LogoutButton() {
  return (
    <button className="btn btn-ghost" onClick={async () => { await apiFetch('/api/research/logout', {}).catch(() => undefined); window.location.assign('/research/login'); }}>
      Sign out
    </button>
  );
}
