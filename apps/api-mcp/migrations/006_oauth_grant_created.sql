-- When the person approved the OAuth client. Copied onto later access and refresh grants.
-- Applied by `npm run migrate -w @mutescroll/api-mcp`. Never edit an applied file.

ALTER TABLE oauth_grants ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
