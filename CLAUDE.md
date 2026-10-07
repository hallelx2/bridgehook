# BridgeHook

Zero-install webhook testing tool. Browser acts as the proxy between cloud relay and localhost.

## Architecture

- `packages/shared/` — TypeScript types, constants, Drizzle DB schema
- `apps/web/` — Landing page + Dashboard (React + Vite + Tailwind)
- `apps/desktop/` — System tray app (Tauri + Rust, Phase 2)
- `relay/` — Cloudflare Worker with Cloudflare D1 (SQLite)
- `docs/` — Documentation site (React + Vite + Tailwind)

## Development

```bash
pnpm install
pnpm dev:relay  # Cloudflare Worker on :8787
pnpm dev:web    # Vite dev server on :5173
```

## Key Commands

- `pnpm -r typecheck` — typecheck all packages
- `pnpm --filter @bridgehook/web build` — build web app
- `pnpm --filter @bridgehook/docs build` — build docs
- `pnpm lint` — lint with Biome

## Database

Cloudflare D1 (binding `DB`, database `bridgehook`). Schema in `packages/shared/src/db/schema.ts`.
```bash
cd relay
pnpm db:generate          # schema change → new SQL in relay/migrations/
pnpm db:migrate:local     # local D1 used by wrangler dev
pnpm db:migrate:remote    # production, BEFORE deploying code that needs it
```
D1 limits that shape queries: ≤100 bound parameters per statement (use subqueries, never inline id lists), no interactive transactions (use `db.batch`).

## How It Works

1. Browser creates channel (relay stores in D1)
2. Browser connects SSE to relay
3. External webhook hits relay → stored in D1 → pushed via SSE to browser
4. Browser JS calls fetch() to localhost → captures response → sends back to relay
5. Relay stores response in D1 and returns to webhook sender

## Key Files

- `relay/src/index.ts` — All server-side API routes
- `apps/web/src/lib/relay.ts` — Client-side API + SSE + localhost forwarding
- `apps/web/src/hooks/useBridge.ts` — Bridge orchestration hook
- `apps/web/src/pages/Dashboard.tsx` — Real dashboard UI
- `packages/shared/src/db/schema.ts` — Drizzle schema (channels + events tables)
