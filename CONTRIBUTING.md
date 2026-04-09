# Contributing to BridgeHook

Thanks for your interest in contributing!

## Setup

```bash
git clone https://github.com/hallelx2/bridgehook
cd bridgehook
pnpm install
```

## Development

```bash
# Run relay server (needs DATABASE_URL in relay/.dev.vars)
pnpm dev:relay

# Run web app
pnpm dev:web

# Run docs site
pnpm --filter @bridgehook/docs dev
```

## Project Structure

| Package | What | Tech |
|---------|------|------|
| `packages/shared` | Types, constants, DB schema | TypeScript, Drizzle |
| `apps/web` | Landing page + Dashboard | React, Vite, Tailwind |
| `apps/desktop` | System tray app (Phase 2) | Tauri, Rust, React |
| `relay` | Webhook relay API | Cloudflare Workers, Neon |
| `docs` | Documentation site | React, Vite, Tailwind |

## Commands

```bash
pnpm -r typecheck          # Typecheck all packages
pnpm lint                  # Lint with Biome
pnpm format                # Format with Biome
pnpm --filter @bridgehook/web build    # Build web
pnpm --filter @bridgehook/docs build   # Build docs
```

## Database Changes

Schema is in `packages/shared/src/db/schema.ts`. After modifying:

```bash
cd relay
DATABASE_URL="your-url" npx drizzle-kit push
```

## Pull Requests

1. Fork the repo
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make your changes
4. Ensure `pnpm -r typecheck` passes
5. Submit a PR against `main`

## Code Style

- Biome for linting and formatting (tab indentation, double quotes)
- Manrope for headlines, Plus Jakarta Sans for body text, Sora for labels
- Keep the dark theme consistent (#030303 background, #9093ff primary)
