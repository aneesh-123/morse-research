# Privacy and data handling

This describes what the software does. It is not legal advice; the researcher running the study is responsible for
the legal basis, the consent wording, any ethics review and data-protection obligations in their jurisdiction.

## What is collected

| Data | When | Where |
|---|---|---|
| Nickname, adult confirmation, account creation time | profile creation | `participants` |
| Email (optional, normalised lower case) | if the participant adds one | `auth_identities` (auth side only) |
| Recovery-code hash, session-token hashes, email-token hashes | sign-in | auth tables (hashes only) |
| Consent decision, consent text hash and version, contact details shown | consent screen | `consent_records` |
| Device category, browser family, OS family, viewport size, touch support, audio sample rate/latency | after consent | `experiment_sessions.client_info` |
| Prior-knowledge rating or skip | after consent | `experiment_sessions` |
| Trial answers, timings, replay counts, interruption flags | after consent | `trial_responses` |
| Behavioural events (see data dictionary) | after consent | `behavioral_events` |
| Knowledge profiles and evaluations | computed | `knowledge_profiles`, `evaluations` |

**Not collected**: microphone, camera, location, keystroke contents, text typed outside study controls, mouse
trajectories, browsing history, IP addresses in research tables, advertising or analytics cookies. Only *counts* of
pointer and key activity on the study page are recorded. Before consent nothing about activity is recorded; a
declined consent stores only the decision.

IP addresses are used transiently as rate-limit keys (`rate_limits.key`, e.g. `recovery:<ip>`), which are short-lived
counters that can be cleared at any time; they are not linked to participant records or exported.

## Separation

Authentication data (emails, hashes) lives in separate tables. Research tables reference only the random participant
UUID. Exports never contain emails, recovery codes or tokens; nicknames are included only if the researcher ticks
"include nicknames". Each export is recorded in the researcher audit log.

## Security measures

* HTTPS only in production (secure cookies, HSTS header).
* Session tokens, recovery codes and sign-in codes are stored only as SHA-256 hashes; researcher passwords use scrypt.
* httpOnly cookies; `SameSite=Lax` for participants, `Strict` for researchers; same-origin check and JSON-only bodies
  on every state-changing request.
* Rate limits on sign-up, sign-in, email sending, researcher login and study endpoints.
* No browser access to the database; RLS on all tables with no policies for other roles (migration 002).
* Research records are append-only (database triggers) and can only be deleted by the deletion routine.
* Secrets come from environment variables; `.env*` files are git-ignored; logs exclude tokens, codes and emails
  (except the development-only email log, which must not be enabled in production).

## Withdrawal and deletion

* **Withdraw from a session**: the session is marked `withdrawn` and data collected so far is kept (as stated in the
  consent text), so the participant can still delete it later.
* **Delete everything**: from the home page ("Delete my data and leave the study", confirmed by typing DELETE). Every
  row linked to the participant (auth and research) is deleted in one transaction. Verified by an end-to-end test.
* **On request**: a researcher can delete a participant from the dashboard.
* Already-downloaded exports are outside the system; researchers should delete the participant from their copies.

## Retention

The default statement shown to participants is "Research data is kept until the end of the research project and is
then deleted or fully anonymised." Change it in Study configuration (or `STUDY_DATA_RETENTION`) to match your plan.
The software does not delete data automatically.

## Minors

The pilot is for adults. Participants must confirm they are 18 or older to create a profile. Age is not verified.
