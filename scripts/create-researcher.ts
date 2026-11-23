/*
 * Creates (or resets the password of) a researcher account.
 * Usage: DATABASE_URL=... npm run researcher:create -- you@example.org
 * The password is read from RESEARCHER_PASSWORD or prompted for on the terminal (not echoed).
 */
import { Client } from 'pg';
import { createInterface } from 'node:readline';
import { hashPassword } from '../src/lib/server/crypto';

async function promptHidden(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
  let muted = false;
  out._writeToOutput = (s: string) => { if (!muted) process.stdout.write(s); };
  return new Promise((resolve) => {
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
    muted = true;
  });
}

async function main() {
  const email = (process.argv[2] ?? '').trim().toLowerCase();
  if (!/.+@.+/.test(email)) throw new Error('Usage: npm run researcher:create -- <email>');
  const password = process.env.RESEARCHER_PASSWORD ?? (await promptHidden('Password (12+ characters): '));
  if (password.length < 12) throw new Error('Password must be at least 12 characters');
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query(
      `INSERT INTO researchers (email, password_hash) VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, disabled = false`,
      [email, await hashPassword(password)],
    );
    console.log(`Researcher account ready: ${email}`);
  } finally {
    await db.end();
  }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
