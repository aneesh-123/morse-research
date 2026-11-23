# Researcher guide

## Access

Researcher accounts are created only from a terminal with database access:

```bash
DATABASE_URL=... npm run researcher:create -- you@your-domain.org     # prompts for a password (12+ characters)
```

Sign in at `/research/login`. The researcher session lasts 8 hours. Every dashboard page and export requires it;
unauthenticated requests to `/research/*` redirect to the login page and `/api/research/*` returns 401. Exports,
deletions and other actions are recorded in `researcher_audit_log`.

## Before sharing the participant link

1. **Study configuration → Consent contact details**: enter your real name and contact email. Institution and ethics
   statement are optional; leave the ethics statement **empty unless an approval actually exists**. When empty,
   participants see: "This is an independent research pilot. It has not been reviewed by an institutional ethics
   board." In production, participants cannot consent until name and email are set.
2. Check **Enrollment → Open for new sessions** and the active Day-1 protocol (`day1-v1`).
3. Do a complete run yourself on a phone, then on the participant page mark that profile as a **test participant**
   so it is excluded from summaries and exports by default.

## Pages

| Page | What it shows |
|---|---|
| **Overview** (`/research`) | enrolment counts, sessions by stage, completion and decline rates, final-test accuracy, devices, protocol versions, recent sessions |
| **Participants** | one row per profile: public code (`P-XXXXXX`), nickname, created, last active, sessions, completed, test flag; filters |
| **Participant** | whether an email is on file (never the address), session history, prior-knowledge ratings, actions: mark/unmark as test, download full history (JSON), delete all data |
| **Session** | stage timeline, consent record, device/audio info, baseline, diagnostic answers, learning trajectory (per trial, with block boundaries), latency, per-letter strips, confusion matrices (learning and test), the **frozen profile** next to the **independent test** (per letter: category, explanation, predicted vs. measured), evaluation metrics and caveats, behaviour summary (replays, hidden/blur, idle, restarts, offline retries), the full trial table. Actions: mark abandoned, compute a missing evaluation |
| **Analysis** | pooled per-letter performance and exposure, confusion matrix by phase, model comparison readiness, frozen estimates vs. final test by category, predicted vs. measured scatter, prior knowledge vs. performance, device comparison, pooled learning curve |
| **Export** | full ZIP and every dataset as CSV/JSON |
| **Study configuration** | enrolment, active protocols, follow-up check switch, consent contact details, read-only protocol and estimator definitions |

## Reading a knowledge profile

* The profile is computed **before** the final test from diagnostic and learning data only, and is never changed.
  The session page shows the time it was frozen, the estimator version and the input hash.
* Categories describe evidence, not mastery (see [ESTIMATOR.md](ESTIMATOR.md)). `Insufficient evidence` means too
  few observations, which is expected for M (4 learning trials). `Little evidence` means enough observations with low
  accuracy.
* Look at `interrupted` trials before interpreting a single session: a participant who left the page several
  times has noisier latencies.
* The evaluation (profile vs. test) is stored separately and is immutable. If it is missing for a completed session
  (for example, the server stopped right after the last answer), "Compute missing evaluation" creates it.

## Exports

* **Full export (.zip)**: every dataset as CSV, nested JSON for sessions, profiles, evaluations, events and protocols,
  plus the data dictionary.
* Emails, recovery codes and sign-in tokens are **never** exported. Nicknames are included only if you tick
  "include nicknames (identifiable)". Test participants are excluded unless you tick "include test participants".
* CSV conventions: UTF-8, comma separated, CRLF line endings, an **empty cell means NULL** (not zero), booleans are
  `true`/`false`, times are ISO 8601 UTC, durations are milliseconds. Every field is described in
  [DATA_DICTIONARY.md](DATA_DICTIONARY.md) (regenerate with `npm run docs:dictionary`).
* Join keys: `participant_id` (UUID) and `session_id` (UUID); trials are keyed by `(session_id, position)`.

## Withdrawals and deletion

* A participant can withdraw from a session (data kept, session marked `withdrawn`) or delete their whole profile
  from their home page, which removes every row about them in one transaction.
* You can delete a participant from their page (type `DELETE` to confirm). Use this for deletion requests received
  by email. Deletion cannot be undone; exports you already downloaded are not affected, so delete the participant
  from your own copies too.

## Abandoned sessions

Sessions are never deleted automatically. A session that stopped mid-way stays at its stage; the participant can
resume it from their home page at any time. Mark it abandoned only when you are sure (for example, after the pilot
closes); a participant then starts a new session.
