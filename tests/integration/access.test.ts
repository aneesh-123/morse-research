import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { resetTestDatabase, TEST_DB_URL } from '../support/db';

beforeAll(resetTestDatabase);

describe('database access policies', () => {
  const c = new Client({ connectionString: TEST_DB_URL });
  beforeAll(async () => {
    await c.connect();
    await c.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'morse_probe') THEN CREATE ROLE morse_probe NOLOGIN; END IF; END $$`);
    await c.query(`GRANT USAGE ON SCHEMA public TO morse_probe`);
  });
  afterAll(async () => {
    await c.query(`RESET ROLE`);
    await c.end();
  });

  it('enables row-level security on every application table', async () => {
    const r = await c.query<{ tablename: string; rowsecurity: boolean }>(`SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public'`);
    expect(r.rows.length).toBeGreaterThan(15);
    expect(r.rows.filter((x) => !x.rowsecurity).map((x) => x.tablename)).toEqual([]);
  });

  it('gives a non-owner role no access to research or auth tables', async () => {
    await c.query(`SET ROLE morse_probe`);
    try {
      for (const t of ['participants', 'auth_identities', 'trial_responses', 'knowledge_profiles']) {
        await expect(c.query(`SELECT 1 FROM ${t} LIMIT 1`)).rejects.toThrow(/permission denied/);
      }
    } finally {
      await c.query(`RESET ROLE`);
    }
  });
});
