-- Channels gain ownership columns. user_id is NULLABLE in this migration so
-- existing anonymous channels (created before commit 5 lands) keep working
-- under their existing 24h TTL. A later migration (commit 17, after the
-- anonymous drain window) flips user_id to NOT NULL.
--
-- expires_at also becomes nullable: owned channels are perpetual (retention
-- enforced on events instead).

ALTER TABLE channels
  ADD COLUMN IF NOT EXISTS user_id   text REFERENCES "user"(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS device_id varchar(24) REFERENCES devices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS label     text;

ALTER TABLE channels ALTER COLUMN expires_at DROP NOT NULL;

CREATE INDEX IF NOT EXISTS channels_user ON channels (user_id);
CREATE INDEX IF NOT EXISTS channels_device ON channels (device_id) WHERE device_id IS NOT NULL;
