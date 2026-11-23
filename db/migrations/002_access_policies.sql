-- Access policies.
--
-- Browsers never talk to the database: every read and write goes through the Next.js server,
-- which connects as the role that owns these tables. Row-level security is enabled on every
-- table with NO policies, so any other role (for example Supabase's `anon` and `authenticated`
-- roles behind its auto-generated REST API) can read or write nothing. The owning role bypasses
-- RLS (it is not FORCEd), so the application is unaffected.

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = current_schema() LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC', t);
  END LOOP;
END $$;

-- Hosted Postgres providers that expose a public API create these roles; strip their table access.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM %I', current_schema(), r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM %I', current_schema(), r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I REVOKE ALL ON TABLES FROM %I', current_schema(), r);
    END IF;
  END LOOP;
END $$;
