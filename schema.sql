-- The server runs this automatically on startup, but you can also
-- paste it into the Neon SQL Editor if you prefer.
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  bid_amount    NUMERIC(12,2),
  bid_at        TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ticket status (added for the ticket checkbox). Safe to run on an existing table.
ALTER TABLE users ADD COLUMN IF NOT EXISTS has_ticket BOOLEAN NOT NULL DEFAULT false;

-- Names are "First Last" and stay unique regardless of capitalization.
-- email is the login. username remains the display name.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_name_lower_idx ON users (lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));

CREATE INDEX IF NOT EXISTS users_bid_idx ON users (bid_amount DESC NULLS LAST, bid_at ASC);
