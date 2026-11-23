# Morse Learning Study — research platform (Phase 1)

A public, mobile-friendly web experiment in which adults learn six Morse code letters by ear under a fixed,
standardised schedule, while the platform records trial-level performance and task-relevant behaviour,
**freezes an interpretable knowledge estimate before an independent final test**, and then compares that
estimate with the test.

It is a **knowledge-measurement instrument**, not an adaptive tutor. The central question:

> Can a system construct an accurate, interpretable representation of a learner's knowledge from their
> interactions, and identify when it lacks sufficient evidence to make a reliable assessment?

Hypotheses the data is designed for: H1 knowledge estimation (learning → independent test), H2 behavioural
signals beyond correctness/latency/exposure, H3 recognising insufficient or inconsistent evidence, H4 prior
knowledge (self-report and diagnostic) vs learning. The platform does not test them by itself; it collects the
data to do so.

## What a participant does

1. Creates a learner profile (nickname; email optional, otherwise a 130-bit recovery code) and confirms they are 18+.
2. Reads and accepts consent (nothing is recorded before this).
3. Enables audio and checks they can hear a test sound (letter S, not a study letter).
4. Rates prior Morse knowledge 1–10, or ticks "I don't know any Morse code — skip the diagnostic".
5. Optional 12-trial diagnostic (E T A N I M × 2, no feedback, no replay, "I don't know" allowed).
6. 48 learning trials in six fixed blocks (E,T → +A → +N → +I → +M → consolidation) with replay and corrective feedback.
7. The server freezes a knowledge profile from diagnostic + learning data only.
8. 24-trial final test (each letter × 4, no feedback/replay/chart, "I don't know" allowed).
9. Completion screen with measured results; can return later with the same profile.

A separately versioned **delayed retention check** (`retention-v1`, 24 no-feedback trials, ≥ 20 h after Day 1, asks about
practice first) is implemented and tested but **off by default**; switch it on under Study configuration.

## Stack

| Concern | Choice |
|---|---|
| App | Next.js 15 (App Router) + React 19 + TypeScript (strict) |
| Database | PostgreSQL ≥ 14 via `pg`; SQL migrations in `db/migrations` |
| Validation | zod on every API input |
| Auth | Own server-side sessions (httpOnly cookies, SHA-256-hashed tokens) using Node's crypto; passwordless email link + 6-digit code (SMTP via nodemailer); recovery codes; scrypt for researcher passwords |
| Audio | Web Audio API oscillator with a gain envelope (deterministic timing) |
| Tests | Vitest (unit + integration on real Postgres), Playwright (production build, emulated phones/tablet/desktop) |

Why not Supabase Auth: anonymous-first profiles with an optional email plus a recovery code, and strict separation of
auth from research tables, were simpler to implement and test directly. Any PostgreSQL (including Supabase's) works.

## Repository layout

```
src/lib/protocol/   pure experiment definition: Morse map + timing, versioned protocols, seeded schedule, state machine, consent text, event vocabulary
src/lib/estimator/  snapshot boundary (no final-test data), rules-v1 estimator, evaluation
src/lib/server/     database, auth, rate limiting, experiment service (server-authoritative state machine), researcher queries
src/lib/client/     Web Audio player, telemetry queue, API client, coarse device info
src/lib/export/     CSV/JSON datasets and the data dictionary
src/app/            participant pages (/, /start, /signin, /home, /study/[id], /privacy), researcher pages (/research/*), API routes
db/migrations/      schema, constraints and immutability triggers
tests/              unit + integration tests     e2e/   Playwright journeys
docs/               architecture, protocol, estimator, data dictionary, researcher guide, pilot guide, deployment
```

## Local development

```bash
cp .env.example .env.local           # set DATABASE_URL (local Postgres is fine), APP_URL=http://localhost:3000
npm ci
npm run db:migrate                   # applies migrations and registers protocol definitions
npm run researcher:create -- you@example.org   # prompts for a password (12+ chars)
npm run dev                          # http://localhost:3000, dashboard at /research
```

Without SMTP settings, development builds print sign-in links/codes to the server console.

## Tests

```bash
createdb morse_test && createdb morse_e2e        # once
npm run test:unit                                 # protocol, schedule, estimator, export formatting
npm run test:integration                          # real Postgres (TEST_DATABASE_URL, default postgres://postgres@localhost:5432/morse_test)
npm run build && npm run test:e2e                 # Playwright against `next start` (E2E_DATABASE_URL, default .../morse_e2e)
```

If Playwright's bundled browser is missing, point it at an installed Chromium with `PW_CHROMIUM_PATH=/path/to/chrome`.
Mobile projects (Pixel 7, iPhone 13, iPad) are **Chromium emulation** of viewport, touch and user agent — not real devices.

## Deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Short version: a Postgres database, `npm run db:migrate` against it, a
Node host or Vercel with the environment variables from `.env.example`, `npm run researcher:create`, and real consent
contact details in the dashboard before sharing the link.

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — components, data flow, auth, database, state machine
- [Experiment protocol](docs/PROTOCOL.md) — trial counts, schedule, randomisation, feedback, timing, versioning
- [Knowledge estimator](docs/ESTIMATOR.md) — features, rules, thresholds, explanations, limitations, freezing
- [Data dictionary](docs/DATA_DICTIONARY.md) — every exported field, units, nulls, events, formulas
- [Researcher guide](docs/RESEARCHER_GUIDE.md) — inspecting sessions, reading profiles, exporting
- [Pilot testing guide](docs/PILOT_GUIDE.md) — recruitment, checks, ceiling/floor effects, versioning changes
- [Privacy & data handling](docs/PRIVACY.md) — retention, deletion, withdrawal, security measures

## Credits and licence

Apache-2.0. The letter mapping and the progressive, interleaved teaching idea come from
[Morse Learn](https://github.com/AceCentre/morse-learn) by Ace Centre (itself based on Google Creative Lab's Morse
experiment with Tania Finlayson). See [NOTICE](NOTICE). Not affiliated with Ace Centre or Google.
