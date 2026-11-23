import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { ensureProtocols } from '@/lib/protocol/registry';

export const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/morse_test';

/** Drops and recreates the schema in the test database, then applies all migrations. */
export async function resetTestDatabase(): Promise<void> {
  const c = new Client({ connectionString: TEST_DB_URL });
  await c.connect();
  try {
    await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    const dir = path.join(__dirname, '..', '..', 'db', 'migrations');
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
      await c.query(readFileSync(path.join(dir, f), 'utf8'));
    }
    await ensureProtocols(c);
  } finally {
    await c.end();
  }
}
