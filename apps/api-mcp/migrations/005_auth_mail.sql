-- Email verification and password reset. Only the SHA-256 of the token is stored.
-- Applied by `npm run migrate -w @mutescroll/api-mcp`. Never edit an applied file.

ALTER TABLE users ADD COLUMN email_verified_at timestamptz;

CREATE TABLE auth_tokens (
  token_hash text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  purpose    text NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX auth_tokens_user_purpose_idx ON auth_tokens (user_id, purpose);
