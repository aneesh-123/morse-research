import { createHash } from 'node:crypto';
import { PROTOCOLS } from './protocols';
import { canonicalJson } from '../estimator/snapshot';

interface Queryable { query: (text: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> }

export function protocolHash(def: unknown): string {
  return createHash('sha256').update(canonicalJson(def)).digest('hex');
}

/**
 * Registers every code-defined protocol in the `protocols` table. A version that already exists
 * with a different definition is a fatal error: versions must never be reused for new content.
 */
export async function ensureProtocols(db: Queryable): Promise<void> {
  for (const p of Object.values(PROTOCOLS)) {
    const hash = protocolHash(p);
    const existing = await db.query(`SELECT definition_sha256 FROM protocols WHERE version = $1`, [p.version]);
    const row = existing.rows[0];
    if (!row) {
      await db.query(
        `INSERT INTO protocols (version, study_type, definition, definition_sha256) VALUES ($1, $2, $3, $4) ON CONFLICT (version) DO NOTHING`,
        [p.version, p.studyType, JSON.stringify(p), hash],
      );
    } else if (row.definition_sha256 !== hash) {
      throw new Error(`Protocol ${p.version} in code differs from the stored definition. Create a new protocol version instead of editing ${p.version}.`);
    }
  }
}
