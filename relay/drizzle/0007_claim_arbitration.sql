-- Claim arbitration (Phase 3):
-- The events.claimed_by_device_id column was added in 0005 with an FK to
-- devices(id). Web-tab executors don't carry a device row (they forward via
-- session cookie, no pairing), so we relax the constraint:
--
--   • Drop the FK so non-device executors can also claim.
--   • Widen to TEXT so client-generated UUIDs (36 chars) fit alongside the
--     "dev_<20>" ids (24 chars) extension/desktop carry.
--
-- The claim itself is enforced by an atomic UPDATE … WHERE claimed_by_device_id
-- IS NULL — see relay/src/index.ts POST /hook/:channelId/claim. Schema-side
-- there's nothing to enforce beyond uniqueness of the winning UPDATE.

-- Look up the actual FK name from the catalog (Drizzle's auto-generated
-- naming has varied across versions; anchoring on the column is robust).
DO $$
DECLARE
  fk_name text;
BEGIN
  SELECT conname INTO fk_name
  FROM pg_constraint
  WHERE conrelid = 'events'::regclass
    AND contype = 'f'
    AND conkey = (
      SELECT array_agg(attnum)
      FROM pg_attribute
      WHERE attrelid = 'events'::regclass
        AND attname = 'claimed_by_device_id'
    );
  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE events DROP CONSTRAINT %I', fk_name);
  END IF;
END $$;

ALTER TABLE events ALTER COLUMN claimed_by_device_id TYPE text;
