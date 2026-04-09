# BridgeHook

Zero-install webhook testing tool. Browser acts as the proxy between cloud relay and localhost.

## Architecture

- `packages/shared/` — TypeScript types, constants, Drizzle DB schema
- `apps/web/` — Landing page + Dashboard (React + Vite + Tailwind)
- `apps/desktop/` — System tray app (Tauri + Rust, Phase 2)
- `relay/` — Cloudflare Worker with Neon PostgreSQL
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

Neon PostgreSQL. Schema in `packages/shared/src/db/schema.ts`. Push with:
```bash
cd relay && DATABASE_URL="..." npx drizzle-kit push
```

## How It Works

1. Browser creates channel (relay stores in Neon)
2. Browser connects SSE to relay
3. External webhook hits relay → stored in Neon → pushed via SSE to browser
4. Browser JS calls fetch() to localhost → captures response → sends back to relay
5. Relay stores response in Neon and returns to webhook sender

## Key Files

- `relay/src/index.ts` — All server-side API routes
- `apps/web/src/lib/relay.ts` — Client-side API + SSE + localhost forwarding
- `apps/web/src/hooks/useBridge.ts` — Bridge orchestration hook
- `apps/web/src/pages/Dashboard.tsx` — Real dashboard UI
- `packages/shared/src/db/schema.ts` — Drizzle schema (channels + events tables)
