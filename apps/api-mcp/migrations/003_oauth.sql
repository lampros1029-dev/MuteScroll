-- ChatGPT and other MCP hosts sign in with OAuth 2.1 (authorization code + PKCE).
-- Clients and grants are stored here. Only hashes of codes and tokens are kept.

CREATE TABLE oauth_clients (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  redirect_uris text[] NOT NULL,
  secret_hash   text,
  created_at    timestamptz NOT NULL
);

CREATE TABLE oauth_grants (
  token_hash     text PRIMARY KEY,
  user_id        text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  client_id      text NOT NULL REFERENCES oauth_clients (id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('code', 'access', 'refresh')),
  redirect_uri   text,
  code_challenge text,
  scope          text NOT NULL,
  expires_at     timestamptz NOT NULL
);
CREATE INDEX oauth_grants_expires_at_idx ON oauth_grants (expires_at);
