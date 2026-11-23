/* Applies db/migrations/*.sql in order, then registers protocol definitions. Usage: npm run db:migrate */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { ensureProtocols } from '../src/lib/protocol/registry';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const dir = path.join(__dirname, '..', 'db', 'migrations');
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    const done = new Set((await client.query(`SELECT name FROM schema_migrations`)).rows.map((r) => r.name as string));
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = readFileSync(path.join(dir, f), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [f]);
        await client.query('COMMIT');
        console.log(`applied ${f}`);
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    }
    await ensureProtocols(client);
    console.log('migrations complete; protocols registered');
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
