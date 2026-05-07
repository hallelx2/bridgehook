-- Dual-auth migration. Allow both ECDSA (public_key) and legacy bearer (secret_hash)
-- credentials to coexist on the channels table. Exactly one must be populated per row,
-- enforced at the application layer.
--
-- Idempotent — safe to run against any prior state of the DB:
--   • Fresh schema (only secret_hash NOT NULL): adds public_key, drops NOT NULL on secret_hash.
--   • Post-rename schema (only public_key NOT NULL): adds secret_hash, drops NOT NULL on public_key.
--   • Already migrated: all four statements no-op.

ALTER TABLE channels ADD COLUMN IF NOT EXISTS public_key text;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS secret_hash text;
ALTER TABLE channels ALTER COLUMN secret_hash DROP NOT NULL;
ALTER TABLE channels ALTER COLUMN public_key DROP NOT NULL;
