-- Pack credits and extra Team seats. A pack or seat purchase must not change `users.plan`.
-- `billing_grants` makes each Paddle transaction or subscription apply once.

ALTER TABLE users
  ADD COLUMN bonus_credits integer NOT NULL DEFAULT 0 CHECK (bonus_credits >= 0),
  ADD COLUMN extra_seats integer NOT NULL DEFAULT 0 CHECK (extra_seats >= 0);

CREATE TABLE billing_grants (
  grant_key  text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('pack', 'seat')),
  created_at timestamptz NOT NULL
);

CREATE INDEX billing_grants_user_id_idx ON billing_grants (user_id);
