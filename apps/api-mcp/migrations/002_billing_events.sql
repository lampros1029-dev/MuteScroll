-- Paddle notification idempotency and cancel-at-period-end (PRD D1).
-- Applied by `npm run migrate -w @mutescroll/api-mcp`. Never edit an applied file.

CREATE TABLE billing_events (
  event_id    text PRIMARY KEY CHECK (char_length(event_id) BETWEEN 1 AND 200),
  received_at timestamptz NOT NULL
);

-- The paid plan stays until effective_at. Maintenance then sets the user to free.
CREATE TABLE billing_downgrades (
  user_id      text PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  effective_at timestamptz NOT NULL
);
