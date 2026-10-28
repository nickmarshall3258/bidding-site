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

-- Names are now "First Last", so keep them unique regardless of capitalization.
CREATE UNIQUE INDEX IF NOT EXISTS users_name_lower_idx ON users (lower(username));

CREATE INDEX IF NOT EXISTS users_bid_idx ON users (bid_amount DESC NULLS LAST, bid_at ASC);
