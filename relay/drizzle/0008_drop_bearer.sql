-- Drop the legacy bearer (secret_hash) channel auth scheme.
-- ECDSA P-256 is the only supported scheme since commit 12; new channels
-- have rejected the secret_hash payload at the API layer for several
-- releases. This migration removes the column entirely and tightens
-- public_key to NOT NULL so the schema matches the runtime invariant.
--
-- Pre-launch: there should be no rows with public_key IS NULL by the time
-- this runs. Run the assertion below before applying — it raises if any
-- legacy rows remain so the operator can decide between deleting them or
-- pausing the migration.

DO $$
DECLARE
  legacy_count int;
BEGIN
  SELECT count(*) INTO legacy_count FROM channels WHERE public_key IS NULL;
  IF legacy_count > 0 THEN
    RAISE EXCEPTION
      'channels.public_key has % rows still null — drain or delete legacy bearer channels first',
      legacy_count;
  END IF;
END $$;

ALTER TABLE channels DROP COLUMN IF EXISTS secret_hash;
ALTER TABLE channels ALTER COLUMN public_key SET NOT NULL;
