# BridgeHook

Webhook testing for apps built with AI, and the agents building them. A permanent URL per local port (`<id>.bridgehook.dev`); the browser (Chrome extension or a dashboard tab) forwards queued webhooks to localhost; coding agents drive it through the MCP server at `relay.bridgehook.dev/mcp`.

## Architecture

- `packages/shared/`: TypeScript types, constants, Drizzle DB schema
- `apps/web/`: Landing page + Dashboard (React + Vite + Tailwind)
- `apps/extension/`: Chrome extension (MV3 module service worker); `drain.js` is generated from `apps/web/src/lib/drain.ts` (`pnpm --filter @bridgehook/extension build:drain`)
- `apps/desktop/`: Desktop app (Tauri + Rust), in development, not released
- `relay/`: Cloudflare Worker with Cloudflare D1 (SQLite)
- `docs/`: Documentation site (React + Vite + Tailwind)

## Development

```bash
pnpm install
pnpm dev:relay  # Cloudflare Worker on :8787
pnpm dev:web    # Vite dev server on :5173
```

## Key Commands

- `pnpm -r typecheck`: typecheck all packages
- `pnpm --filter @bridgehook/web build`: build web app
- `pnpm --filter @bridgehook/docs build`: build docs
- `pnpm lint`: lint with Biome

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

1. A forwarder (extension, dashboard tab at `/dashboard/bridge`, or an MCP agent) gets the channel for a port: one per (user, port), permanent.
2. A webhook hits `<id>.bridgehook.dev/<path>` → relay checks the allowlist and quotas → stores it in D1 → notifies the per-user SSE stream (`/api/me/stream`).
3. The forwarder drains `GET /api/channels/:id/events?pending=1` oldest first: claim (signed), `fetch(localhost)`, report the answer (signed). Logic: `QueueDrainer` in `apps/web/src/lib/drain.ts`.
4. Async channels answered the sender 202 at step 2; sync channels hold the sender in the channel Durable Object until the answer arrives.

Docs: `docs/` builds `llms.txt`, `llms-full.txt` and one `.md` per page from the React pages (`docs/scripts/build-llms.tsx`). Every claim in the docs is checked against the code; keep it that way.

## Deploy (GitHub Actions is billing-locked: deploy locally)

```bash
cd relay && yes | npx wrangler d1 migrations apply bridgehook --remote   # before code that needs it
cd relay && npx wrangler deploy
VITE_RELAY_URL=https://relay.bridgehook.dev pnpm --filter @bridgehook/web build && npx wrangler pages deploy apps/web/dist --project-name=bridgehook-web --branch=main
VITE_RELAY_URL=https://relay.bridgehook.dev pnpm --filter @bridgehook/docs build && npx wrangler pages deploy docs/dist --project-name=bridgehook-docs --branch=main
```

## Brand

- Tokens: `apps/web/tailwind.config.js` (dark surfaces, primary `#FF5C26`); reuse the existing card and badge markup in `apps/web/src/components/`.
- Logo: `apps/web/src/components/Logo.tsx`; favicon `apps/web/public/favicon.svg`.
- `DESIGN.md` is a Cursor-inspired reference, not the live system: the shipped app does not use its palette or fonts.
- Voice: no em dashes; plain, specific claims that match the code.

## Key Files

- `relay/src/index.ts`: All server-side API routes
- `relay/src/mcp.ts`: MCP server (tools for coding agents)
- `apps/web/src/lib/relay.ts`: Client-side API and localhost forwarding
- `apps/web/src/lib/drain.ts`: Ordered delivery (shared with the extension)
- `apps/web/src/hooks/useBridge.ts`: Browser bridge orchestration
- `apps/web/src/pages/Dashboard.tsx`: Browser bridge page (`/dashboard/bridge`)
- `apps/extension/background.js`: Extension service worker
- `packages/shared/src/db/schema.ts`: Drizzle schema (channels + events tables)
