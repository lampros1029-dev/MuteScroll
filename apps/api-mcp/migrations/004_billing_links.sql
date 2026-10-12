-- Checkout ownership: a Paddle id or server-issued nonce belongs to the user this server created it for.
-- Applied by `npm run migrate -w @mutescroll/api-mcp`. Never edit an applied file.

CREATE TABLE billing_links (
  paddle_id text PRIMARY KEY CHECK (char_length(paddle_id) BETWEEN 1 AND 80),
  user_id   text NOT NULL REFERENCES users (id) ON DELETE CASCADE
);
