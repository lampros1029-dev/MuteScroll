-- The interval the subscriber actually pays. Null until a Paddle subscription says month or year.
-- A missing value must stay null. Do not default it to year.

ALTER TABLE users
  ADD COLUMN billing_interval text CHECK (billing_interval IN ('month', 'year'));
