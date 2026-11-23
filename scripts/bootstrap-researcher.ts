/*
 * Deploy-time researcher account setup, so hosted deployments need no terminal.
 * If RESEARCHER_EMAIL and RESEARCHER_PASSWORD are set, creates that researcher (or sets its
 * password to the configured value). If either is missing, does nothing.
 */
import { Client } from 'pg';
import { hashPassword } from '../src/lib/server/crypto';

async function main() {
  const email = (process.env.RESEARCHER_EMAIL ?? '').trim().toLowerCase();
  const password = process.env.RESEARCHER_PASSWORD ?? '';
  if (!email || !password) {
    console.log('RESEARCHER_EMAIL / RESEARCHER_PASSWORD not set; skipping researcher bootstrap');
    return;
  }
  if (!/.+@.+/.test(email)) throw new Error('RESEARCHER_EMAIL is not an email address');
  if (password.length < 12) throw new Error('RESEARCHER_PASSWORD must be at least 12 characters');
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query(
      `INSERT INTO researchers (email, password_hash) VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, disabled = false`,
      [email, await hashPassword(password)],
    );
    console.log('Researcher account ready');
  } finally {
    await db.end();
  }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
