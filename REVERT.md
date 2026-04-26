# Revert guide — Claude session 2026-04-26

This session landed in a single commit (`91c5b44`) on top of tag
`before-claude-thread-2026-04-26` (which marks `62d666e`). Use this
guide to roll back code and/or production state.

## tl;dr

```bash
git reset --hard before-claude-thread-2026-04-26
```

That's it for the **code**. For **production**, see the section below.

## What the session changed

### Code (in this commit)

- **Relay** (`relay/`): audit hardening, dual-auth (ECDSA + legacy bearer),
  KV-backed rate limiting on `POST /api/channels`, hourly cron cleanup
  of expired channels.
- **Web app** (`apps/web/`): ECDSA signing with non-extractable CryptoKeys
  in IndexedDB, AbortController-driven `useBridge`, hardened Dashboard,
  strict CSP via `public/_headers`.
- **Desktop** (`apps/desktop/`): full UI redesign ("Terminal Refined"
  aesthetic, JetBrains Mono everywhere, uranium chartreuse accent), and
  full Rust ECDSA port (new `crypto.rs`, `Service.private_key_pkcs8`
  column, signed relay client in `bridge.rs`).
- **Browser extension** (`apps/extension/background.js`): ported to ECDSA
  with the same non-extractable-key model as the web client.
- **Schema** (`packages/shared/src/db/schema.ts`): `publicKey` and
  `secretHash` columns are both nullable; exactly one is populated per
  row, enforced in code.
- **Migration**: `relay/drizzle/0001_dual_auth.sql` (idempotent — safe to
  re-run from any prior schema state).

### Production state (out of git)

| What | Where | Identifier |
|---|---|---|
| Deployed Worker version | Cloudflare | `251fdd51-0545-4fa2-9954-7e041c73df20` |
| KV namespace | Cloudflare | `bridgehook-relay-RATE_LIMIT` (`647c7df6a0e64bf3882738057ad42f38`) |
| Neon schema migration | Neon `channels` table | added `public_key` text (nullable), made `secret_hash` nullable |
| Test channels | Neon `channels` table | `97bd2e01c072`, `79a7db76cb19` + 6 rate-limit-trial creates |

## Reverting the code

### Full revert

```bash
git reset --hard before-claude-thread-2026-04-26
```

This drops both `91c5b44` (the session checkpoint) and any subsequent
commits. The tag itself is not removed.

### Surgical revert

If you want to keep some of the work, diff against the tag first:

```bash
# See the full session diff
git diff before-claude-thread-2026-04-26 HEAD

# Restore one area only (e.g. desktop UI):
git checkout before-claude-thread-2026-04-26 -- apps/desktop/

# Or invert: keep the work but drop one area:
git checkout HEAD~1 -- apps/extension/         # if you want the pre-session extension
```

### Verifying the tag still exists

```bash
git tag -l "before-claude-thread*"
```

If you need to recreate it manually, the pre-session SHA is `62d666e`.

## Reverting the production state

The code revert alone does NOT undo what's deployed.

### 1. Cloudflare Worker — roll back to the previous version

```bash
cd relay
npx wrangler deployments list                  # find the deployment just before 251fdd51
npx wrangler rollback <previous-deployment-id>
```

### 2. Cloudflare KV namespace — delete it (optional)

If you want to fully remove the rate-limit binding and its associated
namespace:

```bash
cd relay
npx wrangler kv namespace delete --namespace-id 647c7df6a0e64bf3882738057ad42f38
```

If you `git reset --hard` first, the `[[kv_namespaces]]` block in
`wrangler.toml` is already gone, so the next `wrangler deploy` will
deploy without the binding.

### 3. Neon DB — leave it alone

The migration was purely additive (added `public_key`, dropped `NOT NULL`
on `secret_hash`). The old code only writes to `secret_hash`, so it'll
work fine with the new schema. Reverting it cleanly requires no rows
with `public_key`-only credentials, which depends on whether the new
worker has been processing real traffic. **Recommended: leave the schema
as-is.**

If you really want to revert the schema:

```sql
-- Only safe if no live channels rely on public_key auth.
ALTER TABLE channels DROP COLUMN public_key;
ALTER TABLE channels ALTER COLUMN secret_hash SET NOT NULL;
```

### 4. Test channels — clean them up (optional)

The session created a handful of throwaway channels during smoke tests.
They auto-expire in 24h via the new cron, but if you want to remove them
sooner:

```bash
cd relay
DATABASE_URL=$(grep DATABASE_URL .dev.vars | cut -d= -f2-) node -e "
  const { neon } = require('@neondatabase/serverless');
  const sql = neon(process.env.DATABASE_URL);
  sql\`DELETE FROM channels WHERE created_at > '2026-04-26' AND created_at < '2026-04-27'\`.then(r => console.log('deleted', r));
"
```

## Recovering after a revert

If you revert and then change your mind, the session work is still in
your reflog:

```bash
git reflog | head -10                          # find the SHA of the revert
git reset --hard 91c5b44                       # session checkpoint commit
```

The reflog persists for ~90 days by default.
