import 'server-only';
import { z } from 'zod';
import { q, q1, tx, pool, type Db } from './db';
import {
  generateEmailCode, generatePublicCode, generateRecoveryCode, hashRecoveryCode, randomToken, safeEqualHex, sha256,
} from './crypto';
import { sendAuthEmail } from './mailer';
import { env } from './env';
import { log } from './log';

/**
 * Participant identity and authentication services. Research data lives in `participants` and
 * the experiment tables; credentials live only in the auth_* tables.
 */

export const SESSION_DAYS = 30;
const EMAIL_TOKEN_MINUTES = 15;
const EMAIL_CODE_MAX_ATTEMPTS = 5;

export class AppError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'AppError';
  }
}

export const DisplayName = z.string().trim().min(1, 'Please enter a nickname').max(40, 'Nickname is too long (40 characters max)')
  .refine((s) => !/[<>]/.test(s), 'Nickname cannot contain < or >');
export const Email = z.string().trim().toLowerCase().email('Please enter a valid email address').max(200);

export interface CreatedParticipant {
  participantId: string;
  publicCode: string;
  displayName: string;
  recoveryCode: string;
  sessionToken: string;
  emailPending: boolean;
}

async function newAuthSession(participantId: string, db: Db): Promise<string> {
  const token = randomToken(32);
  await db.query(
    `INSERT INTO auth_sessions (token_hash, participant_id, expires_at) VALUES ($1, $2, now() + make_interval(days => $3))`,
    [sha256(token), participantId, SESSION_DAYS],
  );
  return token;
}

export async function createParticipant(input: { displayName: string; email?: string | null; adultConfirmed: boolean }): Promise<CreatedParticipant> {
  const displayName = DisplayName.parse(input.displayName);
  const email = input.email ? Email.parse(input.email) : null;
  if (!input.adultConfirmed) throw new AppError(400, 'adult_required', 'This study is open to adults (18+) only.');
  if (email && !env.emailEnabled) throw new AppError(400, 'email_unavailable', 'Email sign-in is not available yet. Leave email empty and save your recovery code.');

  const recoveryCode = generateRecoveryCode();
  const created = await tx(async (c) => {
    if (email) {
      const taken = await q1(`SELECT 1 FROM auth_identities WHERE email = $1`, [email], c);
      if (taken) throw new AppError(409, 'email_in_use', 'That email already has a profile. Use "Sign in" instead.');
    }
    let p: { id: string; public_code: string } | null = null;
    for (let i = 0; i < 5 && !p; i++) {
      p = await q1<{ id: string; public_code: string }>(
        `INSERT INTO participants (public_code, display_name, adult_confirmed) VALUES ($1, $2, true)
         ON CONFLICT (public_code) DO NOTHING RETURNING id, public_code`,
        [generatePublicCode(), displayName],
        c,
      );
    }
    if (!p) throw new Error('Could not allocate participant code');
    await c.query(
      `INSERT INTO auth_identities (participant_id, email, recovery_code_hash, recovery_code_created_at) VALUES ($1, $2, $3, now())`,
      [p.id, email, hashRecoveryCode(recoveryCode)],
    );
    const sessionToken = await newAuthSession(p.id, c);
    return { participantId: p.id, publicCode: p.public_code, sessionToken };
  });
  if (email) await issueEmailToken(created.participantId, email, 'verify_email');
  return { ...created, displayName, recoveryCode, emailPending: Boolean(email) };
}

export async function signInWithRecoveryCode(code: string): Promise<{ participantId: string; sessionToken: string } | null> {
  const row = await q1<{ participant_id: string }>(
    `SELECT a.participant_id FROM auth_identities a JOIN participants p ON p.id = a.participant_id
     WHERE a.recovery_code_hash = $1 AND p.status = 'active'`,
    [hashRecoveryCode(code)],
  );
  if (!row) return null;
  const sessionToken = await newAuthSession(row.participant_id, pool());
  await touchParticipant(row.participant_id);
  return { participantId: row.participant_id, sessionToken };
}

export async function regenerateRecoveryCode(participantId: string): Promise<string> {
  const code = generateRecoveryCode();
  await q(`UPDATE auth_identities SET recovery_code_hash = $2, recovery_code_created_at = now() WHERE participant_id = $1`, [participantId, hashRecoveryCode(code)]);
  return code;
}

async function issueEmailToken(participantId: string, email: string, purpose: 'verify_email' | 'sign_in'): Promise<void> {
  const link = randomToken(32);
  const code = generateEmailCode();
  await q(
    `INSERT INTO auth_email_tokens (participant_id, purpose, email, link_hash, code_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + make_interval(mins => $6))`,
    [participantId, purpose, email, sha256(link), sha256(`code:${email}:${code}`), EMAIL_TOKEN_MINUTES],
  );
  await sendAuthEmail({ to: email, purpose, link: `${env.appUrl}/auth/email?token=${encodeURIComponent(link)}`, code });
}

/** Always resolves the same way whether or not the email has an account (no enumeration). */
export async function requestEmailSignIn(rawEmail: string): Promise<void> {
  const email = Email.parse(rawEmail);
  if (!env.emailEnabled) throw new AppError(400, 'email_unavailable', 'Email sign-in is not available. Use your recovery code.');
  const row = await q1<{ participant_id: string }>(
    `SELECT a.participant_id FROM auth_identities a JOIN participants p ON p.id = a.participant_id WHERE a.email = $1 AND p.status = 'active'`,
    [email],
  );
  if (!row) {
    log('info', 'email sign-in requested for unknown address');
    return;
  }
  await issueEmailToken(row.participant_id, email, 'sign_in');
}

async function consumeToken(id: string, participantId: string, email: string, db: Db): Promise<string> {
  await db.query(`UPDATE auth_email_tokens SET consumed_at = now() WHERE id = $1`, [id]);
  await db.query(
    `UPDATE auth_identities SET email_verified_at = coalesce(email_verified_at, now()) WHERE participant_id = $1 AND email = $2`,
    [participantId, email],
  );
  return newAuthSession(participantId, db);
}

export async function signInWithEmailLink(linkToken: string): Promise<{ participantId: string; sessionToken: string } | null> {
  return tx(async (c) => {
    const t = await q1<{ id: string; participant_id: string; email: string }>(
      `SELECT id, participant_id, email FROM auth_email_tokens
       WHERE link_hash = $1 AND consumed_at IS NULL AND expires_at > now() FOR UPDATE`,
      [sha256(linkToken)],
      c,
    );
    if (!t) return null;
    const sessionToken = await consumeToken(t.id, t.participant_id, t.email, c);
    return { participantId: t.participant_id, sessionToken };
  });
}

export async function signInWithEmailCode(rawEmail: string, code: string): Promise<{ participantId: string; sessionToken: string } | null> {
  const email = Email.parse(rawEmail);
  const clean = code.replace(/\D/g, '');
  return tx(async (c) => {
    const t = await q1<{ id: string; participant_id: string; email: string; code_hash: string; attempts: number }>(
      `SELECT id, participant_id, email, code_hash, attempts FROM auth_email_tokens
       WHERE email = $1 AND consumed_at IS NULL AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [email],
      c,
    );
    if (!t || t.attempts >= EMAIL_CODE_MAX_ATTEMPTS) return null;
    if (!safeEqualHex(t.code_hash, sha256(`code:${email}:${clean}`))) {
      await c.query(`UPDATE auth_email_tokens SET attempts = attempts + 1 WHERE id = $1`, [t.id]);
      return null;
    }
    const sessionToken = await consumeToken(t.id, t.participant_id, t.email, c);
    return { participantId: t.participant_id, sessionToken };
  });
}

export async function addEmail(participantId: string, rawEmail: string): Promise<void> {
  const email = Email.parse(rawEmail);
  if (!env.emailEnabled) throw new AppError(400, 'email_unavailable', 'Email is not available on this deployment.');
  const taken = await q1(`SELECT 1 FROM auth_identities WHERE email = $1 AND participant_id <> $2`, [email, participantId]);
  if (taken) throw new AppError(409, 'email_in_use', 'That email is already used by another profile.');
  await q(`UPDATE auth_identities SET email = $2, email_verified_at = NULL WHERE participant_id = $1`, [participantId, email]);
  await issueEmailToken(participantId, email, 'verify_email');
}

export interface AuthedParticipant { id: string; publicCode: string; displayName: string }

export async function participantFromSessionToken(token: string | undefined): Promise<AuthedParticipant | null> {
  if (!token) return null;
  const row = await q1<{ id: string; public_code: string; display_name: string; last_seen_at: Date }>(
    `SELECT p.id, p.public_code, p.display_name, s.last_seen_at
     FROM auth_sessions s JOIN participants p ON p.id = s.participant_id
     WHERE s.token_hash = $1 AND s.expires_at > now() AND p.status = 'active'`,
    [sha256(token)],
  );
  if (!row) return null;
  // Sliding expiry, refreshed at most hourly.
  if (Date.now() - new Date(row.last_seen_at).getTime() > 3600_000) {
    await q(
      `UPDATE auth_sessions SET last_seen_at = now(), expires_at = now() + make_interval(days => $2) WHERE token_hash = $1`,
      [sha256(token), SESSION_DAYS],
    );
  }
  return { id: row.id, publicCode: row.public_code, displayName: row.display_name };
}

export async function revokeSessionToken(token: string): Promise<void> {
  await q(`DELETE FROM auth_sessions WHERE token_hash = $1`, [sha256(token)]);
}

export async function touchParticipant(participantId: string, db: Db = pool()): Promise<void> {
  await db.query(`UPDATE participants SET last_active_at = now() WHERE id = $1`, [participantId]);
}

/**
 * Withdrawal with deletion: removes the participant, credentials and every research row linked
 * to them (sessions, consent, schedules, responses, events, profiles, evaluations).
 */
export async function deleteParticipantCompletely(participantId: string): Promise<{ sessionsDeleted: number }> {
  return tx(async (c) => {
    await c.query(`SELECT set_config('morse.allow_delete', 'on', true)`);
    const s = await q1<{ n: string }>(`SELECT count(*)::text AS n FROM experiment_sessions WHERE participant_id = $1`, [participantId], c);
    const del = await c.query(`DELETE FROM participants WHERE id = $1`, [participantId]);
    if (del.rowCount !== 1) throw new AppError(404, 'not_found', 'Participant not found');
    return { sessionsDeleted: Number(s?.n ?? 0) };
  });
}
