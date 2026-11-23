import 'server-only';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { env } from './env';

const g = globalThis as unknown as { __morsePool?: Pool };

export function pool(): Pool {
  if (!g.__morsePool) {
    g.__morsePool = new Pool({
      connectionString: env.databaseUrl,
      max: Number(process.env.DATABASE_POOL_MAX ?? 5),
      idleTimeoutMillis: 30_000,
    });
    g.__morsePool.on('error', (e) => console.error(JSON.stringify({ level: 'error', msg: 'pg pool error', error: e.message })));
  }
  return g.__morsePool;
}

export type Db = Pick<PoolClient, 'query'>;

export async function q<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = [], db: Db = pool()): Promise<T[]> {
  const r = await db.query<T>(text, params);
  return r.rows;
}

export async function q1<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = [], db: Db = pool()): Promise<T | null> {
  const rows = await q<T>(text, params, db);
  return rows[0] ?? null;
}

export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool().connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}
