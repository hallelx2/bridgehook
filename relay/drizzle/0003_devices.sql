-- Devices: extension/desktop/CLI instances paired to a user account.
-- Token issued once at pairing; only its SHA-256 hash is stored.

CREATE TABLE IF NOT EXISTS devices (
  id            varchar(24) PRIMARY KEY,             -- 'dev_' + 20-char random
  user_id       text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  kind          varchar(16) NOT NULL,                -- 'extension' | 'desktop' | 'cli' | 'web'
  label         text NOT NULL,                       -- "Chrome on MacBook Pro"
  token_hash    text NOT NULL,
  os            text,
  user_agent    text,
  last_seen_at  timestamptz,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS devices_user_active ON devices (user_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS devices_token_hash ON devices (token_hash) WHERE revoked_at IS NULL;

-- Ephemeral pairing codes for the device-flow OAuth-style approval.
-- Cron deletes expired rows.
CREATE TABLE IF NOT EXISTS device_codes (
  code               varchar(16) PRIMARY KEY,         -- 'DV-XXXX-XXXX'
  kind               varchar(16) NOT NULL,
  label_hint         text,
  status             varchar(16) NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved' | 'expired'
  approved_user_id   text REFERENCES "user"(id) ON DELETE CASCADE,
  expires_at         timestamptz NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS device_codes_expires_at ON device_codes (expires_at);
