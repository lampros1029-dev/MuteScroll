-- Links a verified Google subject to a MuteScroll account. The Gmail send client is not used here.

CREATE TABLE external_identities (
  provider   text NOT NULL CHECK (provider IN ('google')),
  subject    text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 255),
  user_id    text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  email      text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (provider, subject)
);

CREATE INDEX external_identities_user_id_idx ON external_identities (user_id);
