# Deployment

**Status: not deployed.** No hosting or database credentials were available when this was built, so the steps
below have not been run against a live host. The production build (`next build` + `next start`) has been run and
tested locally against PostgreSQL 16.

You need three things: a PostgreSQL database (≥ 14), a Node.js host (Node 20 or 22), and a domain served over HTTPS.
The recommended low-maintenance setup is **Vercel + Neon** (both have free tiers). Docker instructions follow.

## Option A — Vercel + Neon (or Supabase) Postgres

1. **Put the code on GitHub.** Create an empty private repository and push this folder to it
   (`git remote add origin … && git push -u origin main`). `.env.local` is git-ignored; never commit it.
2. **Create the database.**
   * Neon: create a project, copy the **pooled** connection string (host contains `-pooler`), and make sure it ends
     with `?sslmode=require`.
   * Supabase: Project settings → Database → connection string, "Transaction pooler" (port 6543), with
     `?sslmode=require`. Migration 002 turns on row-level security and revokes access from Supabase's `anon` and
     `authenticated` roles, so its auto-generated REST API exposes nothing.
3. **Schema and researcher login are automatic on Vercel.** Vercel runs the `vercel-build` script, which applies the
   migrations (`npm run db:migrate`), creates the researcher account from `RESEARCHER_EMAIL` / `RESEARCHER_PASSWORD`
   when both are set (`npm run researcher:bootstrap`), then builds. Both steps are idempotent. On other hosts run
   `npm run db:migrate` and `npm run researcher:create -- you@your-domain.org` yourself.
4. **Create the Vercel project**: "Add New → Project", import the repository. Framework: Next.js (detected). Add the
   environment variables below for **Production**, then deploy.
5. **Set the domain**: Vercel gives you `https://<project>.vercel.app`, or add your own domain. Set `APP_URL` to the
   final address and redeploy.
6. **Configure the study**: sign in at `https://<your-domain>/research/login` → Study configuration → enter your real
   name and contact email (and, only if they exist, institution and ethics approval). Save.
7. **Check**: `https://<your-domain>/api/health` returns `{"ok":true,…}`. Complete one session on a phone.
   Mark that profile as a test participant.

### Environment variables

| Variable | Required | Value |
|---|---|---|
| `DATABASE_URL` | yes | pooled Postgres URL with `sslmode=require` |
| `APP_URL` | yes | `https://your-domain` (no trailing slash); used in emailed sign-in links |
| `STUDY_CONTACT_NAME`, `STUDY_CONTACT_EMAIL` | optional | defaults for the consent contact; can be set in the dashboard instead |
| `STUDY_INSTITUTION`, `STUDY_ETHICS_STATEMENT` | optional | leave unset unless true |
| `SMTP_URL`, `EMAIL_FROM` | optional | enables email sign-in, e.g. `smtps://resend:<API_KEY>@smtp.resend.com:465` and `Morse Study <study@your-domain>` (the sender domain must be verified with the provider) |
| `RESEARCHER_EMAIL`, `RESEARCHER_PASSWORD` | optional | researcher login created or updated at each Vercel build (password 12+ characters); change the password by changing the variable and redeploying |
| `DATABASE_POOL_MAX` | optional | default 5 connections per server instance |

Never set `INSECURE_COOKIES`, `EMAIL_DEV_LOG` or `RATE_LIMIT_DISABLED` in production (`EMAIL_DEV_LOG` prints
sign-in codes to the log). Without SMTP, email sign-in is unavailable: adding an email is refused with a message to
use the recovery code instead, and participants sign in with their recovery code.

## Option B — Docker (Render, Fly.io, Railway, a VPS…)

```bash
docker build -t morse-study .
docker run --rm --env-file .env.production morse-study npx tsx scripts/migrate.ts       # once per release
docker run -d -p 3000:3000 --env-file .env.production morse-study
```

Put the container behind HTTPS (the platform's TLS, or a reverse proxy such as Caddy). The app sets
`Strict-Transport-Security` and secure cookies in production, so it must be served over HTTPS. The Dockerfile has
not been built in this environment (no Docker available); treat it as a starting point.

Create the researcher account with `npm run researcher:create` from a checkout that can reach the database.

## Option C — any Node host

```bash
npm ci && npm run build
DATABASE_URL=… npm run db:migrate
DATABASE_URL=… APP_URL=https://… NODE_ENV=production npm start   # listens on $PORT or 3000
```

## Operations

* **Backups**: enable your provider's point-in-time recovery or daily backups. The research tables are append-only,
  so a backup plus the protocol version is enough to reproduce every analysis.
* **Updates**: deploy, then `npm run db:migrate`. Adding a protocol version does not affect running sessions.
* **Rate limiting** lives in the database, so it works across multiple server instances. Old rows in `rate_limits`
  can be deleted at any time.
* **Logs** contain no participant answers, emails, codes or tokens.
* **Secrets**: keep them only in the host's environment settings. Rotate the database password if it was ever
  shared in chat or email.
