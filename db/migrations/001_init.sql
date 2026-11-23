-- Morse learning research platform: initial schema.
-- Conventions: all timestamps are timestamptz (UTC); client monotonic times are double precision
-- milliseconds from the page's performance.timeOrigin; durations are milliseconds; NULL means
-- "not applicable / not measured", never zero.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Guard used by immutability triggers. Deletion of research rows is only allowed inside a
-- transaction that has run: SELECT set_config('morse.allow_delete', 'on', true);
CREATE OR REPLACE FUNCTION morse_forbid_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable (table %)', TG_OP, TG_TABLE_NAME USING ERRCODE = 'P0001';
END $$;

CREATE OR REPLACE FUNCTION morse_guard_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(current_setting('morse.allow_delete', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Deleting from % requires the withdrawal/deletion procedure', TG_TABLE_NAME USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END $$;

-- ---------------------------------------------------------------- identity (research side)
CREATE TABLE participants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_code     text NOT NULL UNIQUE,              -- short pseudonymous code shown to researchers, e.g. P-7K3Q9X
  display_name    text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 40),
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  is_test         boolean NOT NULL DEFAULT false,    -- researcher-marked test/pilot accounts
  adult_confirmed boolean NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_active_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- authentication (kept separate)
CREATE TABLE auth_identities (
  participant_id           uuid PRIMARY KEY REFERENCES participants(id) ON DELETE CASCADE,
  email                    text UNIQUE CHECK (email IS NULL OR email = lower(email)),
  email_verified_at        timestamptz,
  recovery_code_hash       text UNIQUE,              -- SHA-256 of a 130-bit random code
  recovery_code_created_at timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE auth_sessions (
  token_hash     text PRIMARY KEY,                   -- SHA-256 of the cookie token
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL
);
CREATE INDEX auth_sessions_participant ON auth_sessions(participant_id);

CREATE TABLE auth_email_tokens (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  purpose        text NOT NULL CHECK (purpose IN ('verify_email', 'sign_in')),
  email          text NOT NULL,
  link_hash      text NOT NULL UNIQUE,
  code_hash      text NOT NULL,
  attempts       integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL,
  consumed_at    timestamptz
);
CREATE INDEX auth_email_tokens_email ON auth_email_tokens(email, created_at DESC);

CREATE TABLE researchers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash text NOT NULL,                       -- scrypt (Node crypto), format scrypt$N$r$p$salt$hash
  disabled      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

CREATE TABLE researcher_sessions (
  token_hash    text PRIMARY KEY,
  researcher_id uuid NOT NULL REFERENCES researchers(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL
);

CREATE TABLE rate_limits (
  key          text NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer NOT NULL,
  PRIMARY KEY (key, window_start)
);

CREATE TABLE researcher_audit_log (
  id            bigserial PRIMARY KEY,
  researcher_id uuid REFERENCES researchers(id) ON DELETE SET NULL,
  action        text NOT NULL,
  target        text,
  detail        jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- study configuration
CREATE TABLE study_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES researchers(id) ON DELETE SET NULL
);

CREATE TABLE protocols (
  version           text PRIMARY KEY,
  study_type        text NOT NULL CHECK (study_type IN ('day1_learning', 'delayed_retention')),
  definition        jsonb NOT NULL,
  definition_sha256 text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER protocols_immutable BEFORE UPDATE ON protocols FOR EACH ROW EXECUTE FUNCTION morse_forbid_update();
CREATE TRIGGER protocols_nodelete BEFORE DELETE ON protocols FOR EACH ROW EXECUTE FUNCTION morse_guard_delete();

-- ---------------------------------------------------------------- sessions
CREATE TABLE experiment_sessions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id         uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  study_type             text NOT NULL CHECK (study_type IN ('day1_learning', 'delayed_retention')),
  protocol_version       text NOT NULL REFERENCES protocols(version),
  parent_session_id      uuid REFERENCES experiment_sessions(id) ON DELETE CASCADE,
  seed                   text NOT NULL,
  stage                  text NOT NULL CHECK (stage IN ('created','consent_pending','audio_setup','baseline_screening','diagnostic','learning','profile_generation','final_assessment','retention_screening','retention_test','completed','declined','withdrawn','abandoned')),
  status                 text GENERATED ALWAYS AS (
                           CASE WHEN stage IN ('completed','declined','withdrawn','abandoned') THEN stage ELSE 'in_progress' END
                         ) STORED,
  created_at             timestamptz NOT NULL DEFAULT now(),
  consented_at           timestamptz,
  completed_at           timestamptz,
  last_activity_at       timestamptz NOT NULL DEFAULT now(),
  device_category        text CHECK (device_category IN ('mobile','tablet','desktop','unknown')),
  browser_family         text,
  os_family              text,
  client_info            jsonb,                      -- coarse capabilities: touch, viewport, audio sample rate/latency
  baseline_status        text CHECK (baseline_status IN ('tested','not_tested_self_reported_beginner')),
  prior_knowledge_rating smallint CHECK (prior_knowledge_rating BETWEEN 1 AND 10),
  skipped_diagnostic     boolean,
  retention_answers      jsonb,                      -- Day-2: practiced elsewhere, etc.
  hours_since_parent     double precision,
  schedule_length        integer,
  current_position       integer,                    -- next schedule position awaiting a response
  resume_count           integer NOT NULL DEFAULT 0,
  stage_history          jsonb NOT NULL DEFAULT '[]'::jsonb,
  end_reason             text
);
CREATE INDEX experiment_sessions_participant ON experiment_sessions(participant_id, created_at);
-- At most one in-progress session per participant and study type (blocks duplicate creation).
CREATE UNIQUE INDEX experiment_sessions_one_active
  ON experiment_sessions(participant_id, study_type)
  WHERE stage NOT IN ('completed','declined','withdrawn','abandoned');
CREATE TRIGGER experiment_sessions_nodelete BEFORE DELETE ON experiment_sessions FOR EACH ROW EXECUTE FUNCTION morse_guard_delete();

CREATE TABLE consent_records (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id      uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  session_id          uuid NOT NULL REFERENCES experiment_sessions(id) ON DELETE CASCADE,
  consent_version     text NOT NULL,
  protocol_version    text NOT NULL,
  decision            text NOT NULL CHECK (decision IN ('agreed','declined')),
  consent_text_sha256 text NOT NULL,
  contact_snapshot    jsonb NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id)
);
CREATE TRIGGER consent_immutable BEFORE UPDATE ON consent_records FOR EACH ROW EXECUTE FUNCTION morse_forbid_update();
CREATE TRIGGER consent_nodelete BEFORE DELETE ON consent_records FOR EACH ROW EXECUTE FUNCTION morse_guard_delete();

-- ---------------------------------------------------------------- schedule and responses
CREATE TABLE trial_schedule (
  session_id                 uuid NOT NULL REFERENCES experiment_sessions(id) ON DELETE CASCADE,
  position                   integer NOT NULL CHECK (position >= 1),
  trial_key                  text NOT NULL,
  phase                      text NOT NULL CHECK (phase IN ('diagnostic','learning','final','retention')),
  phase_index                integer NOT NULL,
  block                      integer,
  target                     text NOT NULL,
  pattern                    text NOT NULL,
  options                    jsonb NOT NULL,
  include_idk                boolean NOT NULL,
  feedback                   boolean NOT NULL,
  replay_allowed             boolean NOT NULL,
  introduce_before           jsonb NOT NULL DEFAULT '[]'::jsonb,
  prior_target_presentations integer NOT NULL,
  PRIMARY KEY (session_id, position),
  UNIQUE (session_id, trial_key)
);
CREATE TRIGGER trial_schedule_immutable BEFORE UPDATE ON trial_schedule FOR EACH ROW EXECUTE FUNCTION morse_forbid_update();
CREATE TRIGGER trial_schedule_nodelete BEFORE DELETE ON trial_schedule FOR EACH ROW EXECUTE FUNCTION morse_guard_delete();

CREATE TABLE trial_responses (
  id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_response_id           uuid NOT NULL UNIQUE,  -- idempotency key from the client
  session_id                   uuid NOT NULL REFERENCES experiment_sessions(id) ON DELETE CASCADE,
  participant_id               uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  protocol_version             text NOT NULL,
  position                     integer NOT NULL,
  trial_key                    text NOT NULL,
  phase                        text NOT NULL CHECK (phase IN ('diagnostic','learning','final','retention')),
  phase_index                  integer NOT NULL,
  block                        integer,
  target                       text NOT NULL,
  pattern                      text NOT NULL,
  options                      jsonb NOT NULL,
  option_count                 integer NOT NULL,
  response                     text,                  -- NULL when "I don't know"
  is_idk                       boolean NOT NULL,
  is_correct                   boolean NOT NULL,
  feedback_shown               boolean NOT NULL,
  hints_available              boolean NOT NULL,
  replay_allowed               boolean NOT NULL,
  replay_count                 integer NOT NULL CHECK (replay_count >= 0),
  prior_target_presentations   integer NOT NULL,
  cumulative_target_exposures  integer NOT NULL,      -- diagnostic+learning presentations of target up to and including this trial (final/retention: prior only)
  presentation_number          integer NOT NULL CHECK (presentation_number >= 1),
  -- client timing (ms, page monotonic clock)
  client_load_id               uuid NOT NULL,
  client_time_origin_epoch_ms  double precision NOT NULL,
  trial_shown_ms               double precision,
  playback_requested_ms        double precision,
  playback_start_est_ms        double precision,      -- from AudioContext.getOutputTimestamp when available
  playback_end_expected_ms     double precision,
  playback_end_observed_ms     double precision,      -- oscillator 'ended' event
  signal_duration_ms           double precision NOT NULL,
  answers_enabled_ms           double precision,
  response_ms                  double precision NOT NULL,
  rt_ms                        double precision,      -- response_ms - end of first playback
  rt_from_last_playback_ms     double precision,
  audio_output_latency_ms      double precision,
  -- interruption flags
  tab_hidden_during            boolean NOT NULL,
  hidden_duration_ms           double precision,
  window_blurred_during        boolean NOT NULL,
  blur_duration_ms             double precision,
  playback_interrupted         boolean NOT NULL,
  restarted                    boolean NOT NULL,      -- presentation_number > 1
  invalid_timing               boolean NOT NULL,
  interrupted                  boolean NOT NULL,      -- any of the above
  timing_flags                 jsonb NOT NULL DEFAULT '[]'::jsonb,
  client_submitted_epoch_ms    double precision,
  received_at                  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, position),
  FOREIGN KEY (session_id, position) REFERENCES trial_schedule(session_id, position) ON DELETE CASCADE
);
CREATE INDEX trial_responses_participant ON trial_responses(participant_id);
CREATE INDEX trial_responses_phase ON trial_responses(session_id, phase, position);
CREATE TRIGGER trial_responses_immutable BEFORE UPDATE ON trial_responses FOR EACH ROW EXECUTE FUNCTION morse_forbid_update();
CREATE TRIGGER trial_responses_nodelete BEFORE DELETE ON trial_responses FOR EACH ROW EXECUTE FUNCTION morse_guard_delete();

-- ---------------------------------------------------------------- telemetry
CREATE TABLE behavioral_events (
  id                 uuid PRIMARY KEY,                -- client-generated, makes inserts idempotent
  session_id         uuid NOT NULL REFERENCES experiment_sessions(id) ON DELETE CASCADE,
  participant_id     uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  client_load_id     uuid NOT NULL,
  seq                integer NOT NULL,                -- per page load, starts at 1
  type               text NOT NULL,
  client_ms          double precision NOT NULL,       -- page monotonic clock
  client_epoch_ms    double precision NOT NULL,       -- timeOrigin + client_ms
  trial_position     integer,
  screen             text,
  payload            jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, client_load_id, seq)
);
CREATE INDEX behavioral_events_session ON behavioral_events(session_id, client_epoch_ms);
CREATE TRIGGER behavioral_events_immutable BEFORE UPDATE ON behavioral_events FOR EACH ROW EXECUTE FUNCTION morse_forbid_update();
CREATE TRIGGER behavioral_events_nodelete BEFORE DELETE ON behavioral_events FOR EACH ROW EXECUTE FUNCTION morse_guard_delete();

-- ---------------------------------------------------------------- knowledge estimation
CREATE TABLE knowledge_profiles (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id            uuid NOT NULL UNIQUE REFERENCES experiment_sessions(id) ON DELETE CASCADE,
  participant_id        uuid NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  protocol_version      text NOT NULL,
  estimator_version     text NOT NULL,
  input_cutoff_position integer NOT NULL,
  input_observations    integer NOT NULL,
  input_snapshot        jsonb NOT NULL,
  input_sha256          text NOT NULL,
  profile               jsonb NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER knowledge_profiles_immutable BEFORE UPDATE ON knowledge_profiles FOR EACH ROW EXECUTE FUNCTION morse_forbid_update();
CREATE TRIGGER knowledge_profiles_nodelete BEFORE DELETE ON knowledge_profiles FOR EACH ROW EXECUTE FUNCTION morse_guard_delete();

-- A final-assessment response can only exist once the session's profile has been frozen.
CREATE OR REPLACE FUNCTION morse_require_frozen_profile() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.phase = 'final' AND NOT EXISTS (SELECT 1 FROM knowledge_profiles WHERE session_id = NEW.session_id) THEN
    RAISE EXCEPTION 'Final assessment response rejected: no frozen knowledge profile for session %', NEW.session_id USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trial_responses_require_profile BEFORE INSERT ON trial_responses FOR EACH ROW EXECUTE FUNCTION morse_require_frozen_profile();

-- A profile can only be frozen while no final-assessment responses exist for the session.
CREATE OR REPLACE FUNCTION morse_profile_before_final() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM trial_responses WHERE session_id = NEW.session_id AND phase = 'final') THEN
    RAISE EXCEPTION 'Profile rejected: session % already has final-assessment responses', NEW.session_id USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER knowledge_profiles_before_final BEFORE INSERT ON knowledge_profiles FOR EACH ROW EXECUTE FUNCTION morse_profile_before_final();

CREATE TABLE evaluations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id         uuid NOT NULL REFERENCES experiment_sessions(id) ON DELETE CASCADE,  -- the session whose test was evaluated
  profile_id         uuid NOT NULL REFERENCES knowledge_profiles(id) ON DELETE CASCADE,
  kind               text NOT NULL CHECK (kind IN ('final_assessment','retention')),
  evaluation_version text NOT NULL,
  result             jsonb NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, profile_id, kind, evaluation_version)
);
CREATE TRIGGER evaluations_immutable BEFORE UPDATE ON evaluations FOR EACH ROW EXECUTE FUNCTION morse_forbid_update();
CREATE TRIGGER evaluations_nodelete BEFORE DELETE ON evaluations FOR EACH ROW EXECUTE FUNCTION morse_guard_delete();

-- Later, separately versioned analyses (e.g. other estimators run on the same frozen snapshot).
CREATE TABLE analysis_results (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id       uuid REFERENCES experiment_sessions(id) ON DELETE CASCADE,
  profile_id       uuid REFERENCES knowledge_profiles(id) ON DELETE CASCADE,
  analysis_type    text NOT NULL,
  analysis_version text NOT NULL,
  result           jsonb NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER analysis_results_nodelete BEFORE DELETE ON analysis_results FOR EACH ROW EXECUTE FUNCTION morse_guard_delete();
