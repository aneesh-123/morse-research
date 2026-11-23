# Architecture

## Components

```
Browser (phone / tablet / desktop)                 Next.js server (Node)                     PostgreSQL
─────────────────────────────────                 ─────────────────────                     ──────────
Participant pages (/start /signin /home            API routes (/api/*)                       auth tables
  /study/[id]) — React client components    ──►     zod validation, same-origin check, ──►   research tables
  · Web Audio player (src/lib/client/audio)         rate limit, session cookie                 (append-only,
  · telemetry queue (localStorage, batched)        experiment service (state machine,          triggers)
  · pending-answer store (retry on reconnect)        scoring, schedule, freezing, evaluation)
Researcher pages (/research/*) — server-   ──►     research queries / exports (server-only)
  rendered, behind researcher login
```

* There is **no direct browser → database access**. The database credentials exist only on the server.
  Migration `002_access_policies.sql` additionally enables row-level security with no policies on every table and
  revokes table access from `PUBLIC` and from Supabase-style `anon`/`authenticated` roles, so a hosted provider's
  auto-generated REST API cannot read anything either.
* All modules under `src/lib/server` import `server-only`, so they cannot be bundled into client code.
* The browser receives the **Morse pattern** of each trial (it has to play it) but never the target letter, the
  correctness of an answer before submitting it, or future schedule entries. Scoring happens on the server.

## Data flow of one trial

1. `GET /api/sessions/:id` returns the session state: stage, current position and the current `ClientTrial`
   (position, phase, block, pattern, option list, whether replay/IDK are allowed). Introductions of new letters
   come from the protocol definition, not from the schedule.
2. The client plays the pattern with an `OscillatorNode` and a gain envelope on the `AudioContext` clock. Answer
   buttons are disabled until the oscillator's `ended` event. All client times are `performance.now()` values on
   the page's monotonic clock, together with `performance.timeOrigin` (`client_time_origin_epoch_ms`) and a
   per-page-load id (`client_load_id`).
3. The answer is stored locally (`mr_pending_<session>`) and posted to `POST /api/sessions/:id/responses` with a
   client-generated `clientResponseId`. Network failures are retried with backoff; the same id makes the insert
   idempotent.
4. The server checks ownership, stage, position (`already_answered` / `out_of_order`), that the response is one of
   the scheduled options, that IDK/replay are allowed in this phase, recomputes timing (`rt_ms`, flags), scores the
   answer against the stored schedule, inserts the immutable `trial_responses` row and advances the state machine
   in one transaction.
5. Learning trials return the correct answer for feedback; diagnostic/final trials return only "saved".

## Authentication

* **Participants**: an anonymous-first profile (`participants` row with a random UUID and a public code like
  `P-7K3Q9D`). Sign-in methods live in `auth_identities`:
  * `recovery_code`: 26 Crockford base32 characters (130 bits) shown once; only its SHA-256 hash is stored.
  * `email` (optional): a 6-digit code and a magic link, both single use, 15-minute expiry, max 5 attempts; tokens
    are stored hashed. Requests never reveal whether an email is registered.
  * Names are display labels only and are never used to authenticate; duplicates are allowed.
* **Sessions**: a 256-bit random token in an httpOnly, `Secure`, `SameSite=Lax` cookie (`mr_session`, 30-day sliding);
  the database stores only `sha256(token)`.
* **Researchers**: separate table, scrypt password hashes, separate cookie (`mr_researcher`, `SameSite=Strict`,
  8 h), created only from the command line (`npm run researcher:create`). Researcher actions are written to
  `researcher_audit_log`.
* **CSRF**: every state-changing API call requires a JSON body and an `Origin` header matching the site.
* **Rate limiting**: fixed-window counters in Postgres (`rate_limits`) on profile creation, sign-in, email sending,
  researcher login, responses and telemetry.

## Database

`db/migrations/001_init.sql` holds the schema. Auth tables are separate from research tables; research tables
reference the internal participant UUID only. Key integrity rules enforced **in the database**, not just in code:

| Rule | Mechanism |
|---|---|
| Protocol definitions, consent records, schedules, responses, events, profiles, evaluations are append-only | `BEFORE UPDATE` trigger `morse_forbid_update` |
| Rows can only be deleted by the explicit deletion routine (participant deletion / researcher delete) | `BEFORE DELETE` trigger `morse_guard_delete` checks a transaction-local setting |
| One active session per participant and study type | unique partial index |
| A response must belong to a scheduled position | composite FK `(session_id, position) → trial_schedule` |
| One response per position, one response per client id | unique constraints |
| No final-test response without a frozen profile | trigger `morse_require_frozen_profile` |
| No profile once final-test responses exist | trigger `morse_profile_before_final` |
| Session status is derived from stage | generated column |

## State machine

`src/lib/protocol/state-machine.ts`; every stage change goes through `assertTransition` inside a transaction that
locks the session row (`SELECT … FOR UPDATE`).

```
created → consent_pending ─┬─► declined
                           └─► audio_setup ─┬─► baseline_screening ─┬─► diagnostic ─► learning
                                            │                       └──────────────► learning
                                            │   learning ─► profile_generation ─► final_assessment ─► completed
                                            └─► retention_screening ─► retention_test ─► completed
any active stage ─► withdrawn | abandoned
```

Trials are accepted only in the stage that owns their phase (`PHASE_STAGE`). Telemetry is accepted only after
consent (`telemetryAllowed`). Resuming never regenerates anything: the schedule is generated once, when the baseline screen is submitted (it depends on the diagnostic choice), from
the stored seed, and stored row by row in `trial_schedule`.

## Resilience

* **Reload / new device**: the page asks the server for the state and shows a "Welcome back" gate (which also
  re-unlocks audio). An unanswered trial is replayed with `presentation_number + 1` and flagged `restarted`.
* **Tab hidden during playback**: playback stops, the trial is restarted and flagged `playback_interrupted`,
  `tab_hidden_during`. Hidden *after* playback: the answer is accepted and flagged with the hidden duration.
* **Offline**: answers wait in local storage and are re-sent; telemetry batches retry and keep a `dropped` count.
* **Duplicate submit**: same `clientResponseId` returns the original result.

## Repository map

See the README. The protocol and estimator are pure TypeScript modules with no I/O, so they are unit-tested in
isolation; everything that touches the database is integration-tested against a real Postgres.
