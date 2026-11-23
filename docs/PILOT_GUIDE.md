# Pilot testing guide

The aim of a pilot is to find problems with the procedure, the instrument and the data **before** collecting data
you intend to analyse. Treat pilot data as pilot data.

## 1. Before inviting anyone

- [ ] Deployed over HTTPS, `npm run db:migrate` applied, `/api/health` returns `{"ok":true}`.
- [ ] Real researcher name and contact email in Study configuration. Ethics statement empty unless an approval exists.
- [ ] Read the consent screen as a participant would. Is the time estimate (15–20 minutes) right for your pilot?
- [ ] If you rely on email sign-in, SMTP is configured and you received a code. Otherwise participants use recovery
      codes (they must save them).
- [ ] Complete the whole study yourself on: an iPhone (Safari), an Android phone (Chrome) and a desktop browser.
      Automated tests use **emulated** devices only, so real-device checks are your job. On iPhone check with the
      silent switch on and off, and with Bluetooth headphones.
- [ ] Mark your own profiles as test participants.
- [ ] Download the full export and open each CSV. Check that you can answer your questions from it.

## 2. Recruitment

* Adults (18+) only; the app asks participants to confirm.
* For a first pilot, 5–10 people who will tell you what went wrong is more useful than 50 silent ones. Ask them to
  note anything confusing and the device and browser they used.
* Ask for a quiet place and headphones or speakers; the study depends on hearing short tones.
* Do not coach participants on Morse code before the session; that changes the baseline.

## 3. What to check after each pilot session

| Check | Where | Concern if… |
|---|---|---|
| Completed without help | Overview / session page | stuck at a stage, repeated restarts |
| Duration | session page timeline | far from 15–20 minutes |
| Audio | session page: audio info, `audio_played` events, `no_observed_playback_end` flags | many flagged trials on one device type |
| Interruptions | Behaviour section, `interrupted` trials | many hidden/blur events (participant distracted or notifications) |
| Learning curve | Learning trajectory | flat at chance throughout (task too hard, or audio inaudible) |
| Final test | Knowledge profile vs. independent test | see ceiling/floor below |
| Telemetry | event counts, `dropped` counts in `screen_exit` payloads | missing events or drops |

## 4. Ceiling and floor effects

With six letters and 48 learning trials, some participants will answer almost everything correctly (ceiling) and
some will stay near chance (floor). Both reduce how much the data can tell you about the estimator.

* **Ceiling**: most participants ≥ 23/24 on the final test, profiles mostly `strong_evidence`. Options for a new
  protocol version: faster speed (e.g. 18–20 WPM), more similar letters, fewer learning trials, or more letters.
* **Floor**: many participants ≤ 8/24 (6-option chance is 4/24). Options: slower speed, more learning trials per
  letter, longer introductions.
* **Prior knowledge**: participants with a high self-rating or a high diagnostic score can sit at ceiling from the
  start. The Analysis page splits by prior knowledge; consider excluding or analysing them separately (H4).
* **M has only 4 learning trials** in day1-v1, so it will often be `insufficient_evidence`. That is by design; if you
  want more evidence for every letter, change the block design in a new protocol version.

## 5. Changing things between pilot rounds

Never edit an existing protocol or estimator version. Instead:

1. Add a new protocol (e.g. `day1-v2`) in `src/lib/protocol/protocols.ts`, and a new estimator config and
   `ESTIMATOR_VERSION` if thresholds change.
2. Update consent text and bump `consentVersion` if anything participants are told changes (duration, data, etc.).
3. Run the unit tests (they check counts, determinism and balance), deploy, run `npm run db:migrate`.
4. Select the new version in Study configuration. Earlier sessions keep their versions; every row in the export
   carries `protocol_version`, and profiles carry `estimator_version`.
5. Write down what changed and why, with the date, outside the app (e.g. in your lab notebook or repository).

## 6. Delayed retention check (optional)

`retention-v1` is implemented and integration-tested but has not been piloted. Turn it on in Study configuration only
when you want it; it is offered to participants whose Day-1 session finished at least 20 hours earlier, the next time
they sign in. Participants are not reminded automatically.

## 7. Known limitations to keep in mind

* The browser receives the Morse pattern of each trial (it has to play it). A technically skilled participant could
  read it from developer tools. This is a recognition study with no stakes, so this was accepted.
* Reaction times depend on device, input method and audio output latency. Compare within device type.
* Thresholds of the estimator are provisional and unvalidated.
