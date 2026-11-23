import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { q, q1 } from './db';
import { hashPassword, randomToken, sha256, verifyPassword } from './crypto';
import { AppError } from './participants';
import { RESEARCHER_COOKIE } from './http';

export const RESEARCHER_SESSION_HOURS = 8;

export interface Researcher { id: string; email: string }

export async function createResearcher(email: string, password: string): Promise<string> {
  if (password.length < 12) throw new Error('Password must be at least 12 characters');
  const row = await q1<{ id: string }>(
    `INSERT INTO researchers (email, password_hash) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, disabled = false RETURNING id`,
    [email.trim().toLowerCase(), await hashPassword(password)],
  );
  return (row as { id: string }).id;
}

// Dummy hash so a login for an unknown email costs the same as a real check.
let dummyHash: Promise<string> | null = null;

export async function researcherLogin(email: string, password: string): Promise<string | null> {
  const r = await q1<{ id: string; password_hash: string; disabled: boolean }>(
    `SELECT id, password_hash, disabled FROM researchers WHERE email = $1`,
    [email.trim().toLowerCase()],
  );
  if (!r) {
    dummyHash ??= hashPassword('not-a-real-password');
    await verifyPassword(password, await dummyHash);
    return null;
  }
  if (r.disabled || !(await verifyPassword(password, r.password_hash))) return null;
  const token = randomToken(32);
  await q(`INSERT INTO researcher_sessions (token_hash, researcher_id, expires_at) VALUES ($1, $2, now() + make_interval(hours => $3))`, [
    sha256(token), r.id, RESEARCHER_SESSION_HOURS,
  ]);
  await q(`UPDATE researchers SET last_login_at = now() WHERE id = $1`, [r.id]);
  await audit(r.id, 'login', null);
  return token;
}

export async function researcherFromToken(token: string | undefined): Promise<Researcher | null> {
  if (!token) return null;
  return q1<Researcher>(
    `SELECT r.id, r.email FROM researcher_sessions s JOIN researchers r ON r.id = s.researcher_id
     WHERE s.token_hash = $1 AND s.expires_at > now() AND NOT r.disabled`,
    [sha256(token)],
  );
}

export async function currentResearcher(): Promise<Researcher | null> {
  const jar = await cookies();
  return researcherFromToken(jar.get(RESEARCHER_COOKIE)?.value);
}

/** For server components/pages: redirect to the login page when not signed in. */
export async function requireResearcherPage(): Promise<Researcher> {
  const r = await currentResearcher();
  if (!r) redirect('/research/login');
  return r;
}

/** For route handlers. */
export async function requireResearcher(): Promise<Researcher> {
  const r = await currentResearcher();
  if (!r) throw new AppError(401, 'unauthenticated', 'Researcher sign-in required.');
  return r;
}

export async function researcherLogout(token: string | undefined): Promise<void> {
  if (token) await q(`DELETE FROM researcher_sessions WHERE token_hash = $1`, [sha256(token)]);
}

export async function audit(researcherId: string | null, action: string, target: string | null, detail?: unknown): Promise<void> {
  await q(`INSERT INTO researcher_audit_log (researcher_id, action, target, detail) VALUES ($1, $2, $3, $4)`, [
    researcherId, action, target, detail === undefined ? null : JSON.stringify(detail),
  ]);
}
