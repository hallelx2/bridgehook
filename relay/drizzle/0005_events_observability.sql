-- Events gain observability columns:
--   • replay_of            — self-FK; non-null on replay events
--   • replayed_by_user_id  — who triggered the replay (null on live events)
--   • device_id            — which executor forwarded this event
--   • kind                 — 'live' | 'replay' (cheap to index)
--   • claimed_by_device_id — multi-device claim arbitration (Phase 3)
--   • claimed_at           — when the claim was made
--
-- A CHECK constraint enforces (kind = 'replay') iff (replay_of IS NOT NULL).

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS replay_of            varchar(32) REFERENCES events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS replayed_by_user_id  text REFERENCES "user"(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS device_id            varchar(24) REFERENCES devices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS kind                 varchar(16) NOT NULL DEFAULT 'live',
  ADD COLUMN IF NOT EXISTS claimed_by_device_id varchar(24) REFERENCES devices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS claimed_at           timestamptz;

-- Drop and recreate the constraint so re-runs are idempotent. Postgres has no
-- ADD CONSTRAINT IF NOT EXISTS; the catalog query approach is the standard idiom.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'events_replay_kind_consistent'
  ) THEN
    ALTER TABLE events ADD CONSTRAINT events_replay_kind_consistent
      CHECK ((kind = 'replay') = (replay_of IS NOT NULL));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS events_channel_received_desc ON events (channel_id, received_at DESC);
CREATE INDEX IF NOT EXISTS events_replay_of ON events (replay_of) WHERE replay_of IS NOT NULL;
