-- MuteScroll API schema, version 1 (PRD 12, 15, 16, 20).
-- Applied by `npm run migrate -w @mutescroll/api-mcp`. Never edit an applied file: add 002_*.sql instead.
-- Timestamps are written by the application (from its clock) so tests and retries stay deterministic.

CREATE TABLE users (
  id            text PRIMARY KEY,
  email         text NOT NULL UNIQUE CHECK (char_length(email) BETWEEN 3 AND 254),
  password_hash text NOT NULL,
  plan          text NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'creator', 'pro', 'team')),
  created_at    timestamptz NOT NULL
);

-- Web sessions. Only the SHA-256 of the cookie token is stored.
CREATE TABLE sessions (
  token_hash    text PRIMARY KEY,
  user_id       text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL,
  last_seen_at  timestamptz NOT NULL,
  expires_at    timestamptz NOT NULL
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

-- API keys (msk_...). Only the SHA-256 of the key and a short display prefix are stored.
CREATE TABLE api_keys (
  id            text PRIMARY KEY,
  user_id       text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  key_prefix    text NOT NULL,
  key_hash      text NOT NULL UNIQUE,
  created_at    timestamptz NOT NULL,
  last_used_at  timestamptz
);
CREATE INDEX api_keys_user_id_idx ON api_keys (user_id, created_at);

-- Transcription jobs. owner_user_id is NULL for anonymous jobs (capability by job_id).
CREATE TABLE jobs (
  id              text PRIMARY KEY,
  dedupe_key      text NOT NULL,
  owner_user_id  text REFERENCES users (id) ON DELETE CASCADE,
  status          text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  language        text NOT NULL,
  platform        text,
  failure         text,
  result          jsonb,
  credits_charged integer NOT NULL DEFAULT 0 CHECK (credits_charged >= 0),
  created_at      timestamptz NOT NULL,
  updated_at      timestamptz NOT NULL,
  expires_at      timestamptz NOT NULL
);
-- At most one live job per dedupe key. Failed jobs are never reused (PRD 14).
CREATE UNIQUE INDEX jobs_live_dedupe_key_idx ON jobs (dedupe_key) WHERE status <> 'failed';
CREATE INDEX jobs_owner_created_idx ON jobs (owner_user_id, created_at DESC);
CREATE INDEX jobs_expires_at_idx ON jobs (expires_at);

-- Credit ledger (PRD 20.5). Append-only: each job run writes reserve, then release, then charge.
-- Usage in a period = reserve + charge - release. Keys make every write idempotent.
CREATE TABLE credit_ledger (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  user_id         text NOT NULL,
  job_id          text NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('reserve', 'release', 'charge')),
  credits         integer NOT NULL CHECK (credits > 0),
  period          text NOT NULL CHECK (period ~ '^[0-9]{4}-[0-9]{2}$'),
  created_at      timestamptz NOT NULL
);
CREATE INDEX credit_ledger_user_period_idx ON credit_ledger (user_id, period);

CREATE FUNCTION credit_ledger_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'credit_ledger is append-only';
END;
$$;

CREATE TRIGGER credit_ledger_append_only
  BEFORE UPDATE OR DELETE ON credit_ledger
  FOR EACH ROW EXECUTE FUNCTION credit_ledger_reject_change();
