-- UTM attribution tracking (first-touch and last-touch).
-- Applied by `npm run migrate -w @mutescroll/api-mcp`. Never edit an applied file.

-- User attribution: stored when an account is created or updated with new UTM params.
CREATE TABLE user_attribution (
  user_id text PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  -- First-touch attribution (never overwritten after account creation)
  first_utm_source text,
  first_utm_medium text,
  first_utm_campaign text,
  first_utm_content text,
  first_utm_term text,
  first_referrer_host text,
  first_landing_path text,
  first_captured_at timestamptz,
  -- Last-touch attribution (updated on each new UTM visit before sign-up)
  last_utm_source text,
  last_utm_medium text,
  last_utm_campaign text,
  last_utm_content text,
  last_utm_term text,
  last_referrer_host text,
  last_landing_path text,
  last_captured_at timestamptz
);

-- Conversion events: signup and purchase tracking
CREATE TABLE conversion_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('signup', 'purchase')),
  -- Attribution at the time of conversion (from user_attribution or Paddle custom_data)
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  referrer_host text,
  landing_path text,
  -- Purchase-specific fields
  amount_cents integer CHECK (amount_cents IS NULL OR amount_cents >= 0),
  currency text CHECK (currency IS NULL OR char_length(currency) = 3),
  created_at timestamptz NOT NULL
);

CREATE INDEX conversion_events_user_id_idx ON conversion_events (user_id, created_at);
CREATE INDEX conversion_events_type_created_idx ON conversion_events (event_type, created_at);
CREATE INDEX conversion_events_utm_campaign_idx ON conversion_events (utm_campaign, created_at) WHERE utm_campaign IS NOT NULL;
