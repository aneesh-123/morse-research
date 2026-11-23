import { execSync } from 'node:child_process';
import { Client } from 'pg';

export default async function globalSetup() {
  const url = process.env.E2E_DATABASE_URL ?? 'postgres://postgres@localhost:5432/morse_e2e';
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await c.end();
  execSync('npx tsx scripts/migrate.ts', { env: { ...process.env, DATABASE_URL: url }, stdio: 'inherit' });
  execSync('npx tsx --conditions=react-server scripts/create-researcher.ts e2e-researcher@example.org', {
    env: { ...process.env, DATABASE_URL: url, RESEARCHER_PASSWORD: 'e2e-password-123' },
    stdio: 'inherit',
  });
}
