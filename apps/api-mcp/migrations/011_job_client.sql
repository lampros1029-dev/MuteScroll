-- Which client created a job. Additive and independent of other job-column migrations.
-- source: web (the site), rest (API key or other /v1 caller), mcp.
-- client_name and client_version come from MCP initialize clientInfo, remembered for that MCP session.
-- oauth_client_id is the OAuth client that issued the access token, when there is one.
-- user_agent is truncated by the application. This table does not store IP addresses.

ALTER TABLE jobs
  ADD COLUMN source text CHECK (source IN ('web', 'rest', 'mcp')),
  ADD COLUMN client_name text CHECK (client_name IS NULL OR char_length(client_name) <= 200),
  ADD COLUMN client_version text CHECK (client_version IS NULL OR char_length(client_version) <= 200),
  ADD COLUMN oauth_client_id text CHECK (oauth_client_id IS NULL OR char_length(oauth_client_id) <= 120),
  ADD COLUMN user_agent text CHECK (user_agent IS NULL OR char_length(user_agent) <= 200);

CREATE INDEX jobs_created_at_idx ON jobs (created_at);

-- MCP has no process-local session. initialize's clientInfo is stored under a key derived from
-- the bearer credential hash or a client-supplied session id, then copied onto later jobs.
CREATE TABLE mcp_client_sessions (
  session_key    text PRIMARY KEY,
  client_name    text,
  client_version text,
  created_at     timestamptz NOT NULL,
  expires_at     timestamptz NOT NULL
);
CREATE INDEX mcp_client_sessions_expires_at_idx ON mcp_client_sessions (expires_at);
