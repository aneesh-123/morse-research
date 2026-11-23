import 'server-only';
import { q1, type Db, pool } from './db';

/**
 * Fixed-window rate limiter stored in Postgres, so it works across serverless instances.
 * Returns true when the request is allowed. Disabled when RATE_LIMIT_DISABLED=1 (tests only).
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number, db: Db = pool()): Promise<boolean> {
  if (process.env.RATE_LIMIT_DISABLED === '1') return true;
  const row = await q1<{ count: number }>(
    `INSERT INTO rate_limits (key, window_start, count)
     VALUES ($1, to_timestamp(floor(extract(epoch from now()) / $2) * $2), 1)
     ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
     RETURNING count`,
    [key, windowSeconds],
    db,
  );
  if (Math.random() < 0.01) {
    // Opportunistic cleanup of expired windows.
    await db.query(`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`);
  }
  return (row?.count ?? 0) <= limit;
}
