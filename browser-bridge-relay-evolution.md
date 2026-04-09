# Browser-Bridge Relay — Evolution & Technical Architecture

This document covers the full product evolution from browser-only MVP to production desktop app.

---

## Product Evolution

```
Phase 1: Web MVP              Phase 2: Desktop App            Phase 3: Full Product
(weekend project)             (system tray)                   (developer tool)
─────────────────             ─────────────────               ─────────────────
Browser tab                   Tauri system tray               Named services
Single port                   Multiple ports                  Config file (YAML)
Manual URL copy               Auto-copy to clipboard          Team sharing
No persistence                Event history (SQLite)          Replay / retry
Close tab = dead              Always running in background    Webhook buffering
Web UI only                   Native notifications            Auto-detect ports
Anonymous only                Local profile                   Project workspaces
```

---

## Phase 1: Web MVP

**Goal:** Validate the idea. Ship in a weekend.

**Stack:** Cloudflare Worker + Vite/React static site

**What it does:**
- Open `https://bridgehook.dev`
- Enter port: `3000`
- Get URL: `https://relay.bridgehook.dev/hook/abc123`
- Paste into Stripe → webhooks appear in the UI → forwarded to localhost

**Limitations:** Browser tab must stay open. One port at a time.

See [browser-bridge-relay.md](browser-bridge-relay.md) for the full MVP spec.

---

## Phase 2: Desktop App (System Tray)

**Goal:** Solve the "browser tab must stay open" problem. Support multiple services.

### Why Tauri

- Tiny binary (~5MB vs Electron's ~150MB)
- Rust backend does the bridging (no browser needed for core functionality)
- System tray support built-in
- Same React frontend skills from Phase 1
- SQLite for event history via `tauri-plugin-sql`
- Secure credential storage via OS keychain (`tauri-plugin-store`)

### Architecture Shift

In Phase 1, the browser does the bridging:

```
Relay ──SSE──→ Browser JS ──fetch()──→ localhost
```

In Phase 2, Rust does the bridging:

```
Relay ──SSE──→ Tauri Rust ──reqwest──→ localhost
                    │
                    └──→ WebView UI (optional, for inspection)
```

The UI is optional. The bridge runs even with the window minimized or closed to tray.

### System Tray Behavior

```
┌─────────────────────────────────────┐
│  🔗 BridgeHook           ─ □ ✕     │
│─────────────────────────────────────│
│                                     │
│  (full dashboard when window open)  │
│                                     │
└─────────────────────────────────────┘
         │
         │ close window
         ▼
    ┌──────────┐
    │ 🔗 tray  │ ← right-click menu:
    └──────────┘
         │   ┌─────────────────────────┐
         └──→│ ● stripe-api     :3000  │
              │ ● github-hooks   :3000  │
              │ ○ payments       :4000  │
              │ ─────────────────────── │
              │ Open Dashboard          │
              │ Pause All               │
              │ Copy URLs               │
              │ ─────────────────────── │
              │ Quit BridgeHook         │
              └─────────────────────────┘
```

**Tray states:**
- 🟢 Green icon: all services connected, recent events flowing
- 🟡 Yellow icon: connected but no events in 5+ minutes
- 🔴 Red icon: disconnected from relay or local server down
- Badge number: unread error count

**Native notifications:**

```
┌─────────────────────────────────────┐
│ 🔗 BridgeHook                      │
│                                     │
│ ⚠ stripe-api returned 500          │
│ POST /webhook/stripe                │
│ checkout.session.completed          │
│                                     │
│ Click to inspect                    │
└─────────────────────────────────────┘
```

### Dashboard UI

```
┌──────────────────────────────────────────────────────────────────┐
│  🔗 BridgeHook                                      ─  □  ✕    │
│──────────────────────────────────────────────────────────────────│
│                                                                  │
│  Services                                          [+ Add]       │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ 🟢 stripe-api                                              │  │
│  │    localhost:3000 → /webhook/stripe                         │  │
│  │    https://relay.bridgehook.dev/hook/a1b2c3     [Copy URL]  │  │
│  │    Last: 2 min ago  │  Total: 47  │  Errors: 0  │  12ms    │  │
│  ├────────────────────────────────────────────────────────────┤  │
│  │ 🟢 github-hooks                                            │  │
│  │    localhost:3000 → /webhook/github                         │  │
│  │    https://relay.bridgehook.dev/hook/d4e5f6     [Copy URL]  │  │
│  │    Last: 1 hr ago   │  Total: 12  │  Errors: 1  │  8ms     │  │
│  ├────────────────────────────────────────────────────────────┤  │
│  │ 🔴 payment-service                                         │  │
│  │    localhost:4000 → /payments                               │  │
│  │    https://relay.bridgehook.dev/hook/g7h8i9     [Copy URL]  │  │
│  │    Server not running — 3 webhooks buffered                 │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Live Events                              [Filter ▼] [Search]   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ 14:32:01  POST  stripe-api   checkout.session.completed    │  │
│  │           → 200 OK (12ms)                                  │  │
│  │ 14:31:45  POST  github-hooks push                          │  │
│  │           → 200 OK (8ms)                                   │  │
│  │ 14:30:12  POST  stripe-api   payment_intent.succeeded      │  │
│  │           → 500 Error (3ms)  ← click to inspect            │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Event Detail (click to expand)                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  Request                          Response                  │  │
│  │  ─────────                        ────────                  │  │
│  │  POST /webhook/stripe             200 OK                    │  │
│  │                                                             │  │
│  │  Headers:                         Headers:                  │  │
│  │  stripe-signature: t=1234...      content-type: app/json    │  │
│  │  content-type: application/json                             │  │
│  │                                   Body:                     │  │
│  │  Body:                            { "received": true }      │  │
│  │  {                                                          │  │
│  │    "type": "checkout.session...", [Replay]  [Copy cURL]     │  │
│  │    "data": { ... }                                          │  │
│  │  }                                                          │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

### Rust Backend Responsibilities

```rust
// Core bridge loop — runs independently of the UI
async fn bridge_service(config: ServiceConfig, db: SqlitePool) {
    let url = format!("{}/hook/{}/events", RELAY_URL, config.channel_id);
    let mut es = EventSource::connect(url, &config.secret);

    while let Some(event) = es.next().await {
        // 1. Forward to localhost
        let response = reqwest::Client::new()
            .request(event.method, format!("http://localhost:{}{}", config.port, event.path))
            .headers(event.headers)
            .body(event.body)
            .send()
            .await;

        // 2. Send response back to relay
        relay_client.send_response(config.channel_id, event.id, &response).await;

        // 3. Store in SQLite for history
        db.store_event(&event, &response).await;

        // 4. Notify UI (if open)
        app_handle.emit("webhook-event", &event);

        // 5. Native notification on error
        if response.status >= 400 {
            Notification::new("BridgeHook")
                .title(format!("{} returned {}", config.name, response.status))
                .show();
        }
    }
}
```

### SQLite Schema

```sql
CREATE TABLE services (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    port        INTEGER NOT NULL,
    path        TEXT NOT NULL,
    channel_id  TEXT NOT NULL,
    secret      TEXT NOT NULL,     -- encrypted via OS keychain
    active      BOOLEAN DEFAULT 1,
    created_at  TEXT NOT NULL
);

CREATE TABLE events (
    id              TEXT PRIMARY KEY,
    service_id      TEXT NOT NULL REFERENCES services(id),
    method          TEXT NOT NULL,
    path            TEXT NOT NULL,
    request_headers TEXT NOT NULL,   -- JSON
    request_body    TEXT,
    response_status INTEGER,
    response_headers TEXT,           -- JSON
    response_body   TEXT,
    latency_ms      INTEGER,
    error           TEXT,
    received_at     TEXT NOT NULL,
    INDEX idx_events_service (service_id, received_at DESC)
);
```

### Config File

Users can define services in a `bridgehook.yaml` in their project root:

```yaml
# bridgehook.yaml
services:
  - name: stripe-api
    port: 3000
    path: /webhook/stripe

  - name: github-hooks
    port: 3000
    path: /webhook/github

  - name: payment-service
    port: 4000
    path: /payments
```

The desktop app watches this file and auto-configures services on change.

---

## Phase 3: Full Product Features

### Webhook Buffering & Replay

When your local server is down, webhooks don't get lost:

```
Server running:     Stripe → Relay → App → localhost:3000 → 200 OK
Server stopped:     Stripe → Relay → App → localhost:3000 → connection refused
                                      ↓
                              buffer event in SQLite
                                      ↓
Server starts:      App detects port is listening
                    → replays buffered events in order
                    → marks as delivered
```

### Replay Button

Re-send any historical webhook to your local server:

```
Click [Replay] on any event
  → POST to localhost:3000/webhook/stripe
  → with exact same headers and body
  → see new response alongside original
```

### Auto-Detect Running Servers

The app periodically scans common ports:

```
Scanning: 3000, 3001, 4000, 5000, 8000, 8080...
Found:
  ● localhost:3000 — responding (Express detected via Server header)
  ● localhost:8080 — responding (unknown framework)
  ○ localhost:4000 — not listening

Suggestion: "localhost:3000 is running. Add a service?"
```

### Team Sharing (Optional Cloud Feature)

Multiple developers on same channel:

```
Developer A (London):   bridgehook.yaml → stripe-api channel: abc123
Developer B (New York): bridgehook.yaml → stripe-api channel: abc123

Both receive the same webhook.
Both can see each other's responses.
Dashboard shows: "2 bridges connected"
```

### Project Workspaces

Group services by project:

```
Workspaces:
  📁 e-commerce-app
     ├── stripe-api       :3000  /webhook/stripe
     ├── github-hooks     :3000  /webhook/github
     └── sendgrid-inbound :3000  /webhook/email

  📁 saas-platform
     ├── stripe-billing   :4000  /billing/webhook
     └── twilio-sms       :4000  /sms/incoming
```

Each workspace has its own `bridgehook.yaml` and separate event history.

---

## Monorepo Structure

pnpm workspaces for the entire project:

```
bridgehook/
├── pnpm-workspace.yaml
├── package.json                    ← root: shared scripts, lint, format
├── biome.json                      ← shared formatting/linting config
├── tsconfig.base.json              ← shared TS config
│
├── packages/
│   └── shared/                     ← shared types and constants
│       ├── package.json            ← @bridgehook/shared
│       └── src/
│           ├── types/
│           │   ├── channel.ts      ← Channel, Event, Service types
│           │   ├── relay.ts        ← Relay API request/response types
│           │   └── config.ts       ← bridgehook.yaml schema (Zod)
│           └── constants/
│               └── defaults.ts     ← default ports, timeouts, limits
│
├── apps/
│   ├── web/                        ← Phase 1: browser-only MVP
│   │   ├── package.json            ← @bridgehook/web (Vite + React)
│   │   └── src/
│   │       ├── App.tsx             ← port input, connect, event log
│   │       ├── hooks/
│   │       │   ├── useRelay.ts     ← SSE connection + event forwarding
│   │       │   └── useLocalProxy.ts ← fetch() to localhost
│   │       └── components/
│   │           ├── EventLog.tsx
│   │           ├── EventDetail.tsx
│   │           ├── ServiceCard.tsx
│   │           └── ConnectForm.tsx
│   │
│   └── desktop/                    ← Phase 2: Tauri system tray app
│       ├── package.json            ← @bridgehook/desktop
│       ├── src/                    ← React frontend (shares components with web)
│       │   ├── App.tsx
│       │   ├── views/
│       │   │   ├── Dashboard.tsx
│       │   │   ├── ServiceConfig.tsx
│       │   │   └── EventInspector.tsx
│       │   └── components/         ← imports from @bridgehook/web where possible
│       │
│       └── src-tauri/              ← Rust backend
│           ├── Cargo.toml
│           ├── tauri.conf.json
│           └── src/
│               ├── main.rs
│               ├── lib.rs          ← plugin registration, state setup
│               ├── tray.rs         ← system tray menu + icon states
│               ├── bridge.rs       ← SSE listener + reqwest forwarder (core loop)
│               ├── services.rs     ← service CRUD, config file watcher
│               ├── db.rs           ← SQLite event storage
│               ├── commands/
│               │   ├── services.rs ← add/remove/toggle service commands
│               │   ├── events.rs   ← query event history, replay
│               │   └── settings.rs ← app preferences
│               └── state.rs        ← AppState (active bridges, DB pool)
│
├── relay/                          ← Cloudflare Worker (the cloud relay)
│   ├── package.json                ← @bridgehook/relay
│   ├── wrangler.toml               ← Cloudflare config + Durable Objects binding
│   └── src/
│       ├── index.ts                ← Worker entry: route requests
│       ├── channel.ts              ← Durable Object: per-channel state + SSE
│       └── types.ts                ← imports from @bridgehook/shared
│
└── docs/                           ← landing page / documentation
    ├── package.json                ← @bridgehook/docs (Vite static site)
    └── src/
        └── index.html              ← landing page explaining the product
```

### pnpm-workspace.yaml

```yaml
packages:
  - 'packages/*'
  - 'apps/*'
  - 'relay'
  - 'docs'
```

### Package Dependencies

```
@bridgehook/shared       ← no dependencies (pure types + Zod schemas)
     ↑
     ├── @bridgehook/web         ← React, imports shared types
     ├── @bridgehook/desktop     ← React + Tauri, imports shared types + web components
     ├── @bridgehook/relay       ← Cloudflare Worker, imports shared types
     └── @bridgehook/docs        ← static site, no imports
```

### Root package.json Scripts

```json
{
  "scripts": {
    "dev:web": "pnpm --filter @bridgehook/web dev",
    "dev:desktop": "pnpm --filter @bridgehook/desktop tauri dev",
    "dev:relay": "pnpm --filter @bridgehook/relay dev",
    "build:web": "pnpm --filter @bridgehook/web build",
    "build:desktop": "pnpm --filter @bridgehook/desktop tauri build",
    "deploy:relay": "pnpm --filter @bridgehook/relay deploy",
    "deploy:web": "pnpm --filter @bridgehook/web deploy",
    "typecheck": "pnpm -r typecheck",
    "lint": "biome check .",
    "format": "biome format --write ."
  }
}
```

---

## Tech Stack Summary

| Component | Technology | Why |
|-----------|-----------|-----|
| **Relay server** | Cloudflare Worker + Durable Objects | Free, global, serverless, perfect for SSE + ephemeral state |
| **Web frontend** | Vite + React + TailwindCSS | Fast dev, same stack as desktop |
| **Desktop app** | Tauri v2 + React | Tiny binary, Rust bridge, system tray, SQLite |
| **Desktop bridge** | Rust (`reqwest` + `eventsource`) | No browser needed, runs in background |
| **Event storage** | SQLite via `tauri-plugin-sql` | Local, fast, no external DB |
| **Credential storage** | OS keychain via `tauri-plugin-store` | Channel secrets encrypted at rest |
| **Shared types** | TypeScript + Zod | Type-safe across all packages |
| **Monorepo** | pnpm workspaces | Same pattern as Hercules |
| **Linting/Format** | Biome | Fast, single tool for lint + format |
| **Config file** | YAML (`bridgehook.yaml`) | Human-readable, per-project |
| **Deployment (web)** | Cloudflare Pages | Free, auto-deploy from git |
| **Deployment (relay)** | Cloudflare Workers | Free tier: 100K req/day |

---

## Security Architecture (Desktop App)

### Channel Secrets

```
Creation flow:
  1. User clicks "Add Service"
  2. Rust generates: secret = crypto::random_bytes(32).to_hex()
  3. Rust sends to relay: POST /channels/new { secret_hash: sha256(secret) }
  4. Relay returns: { channel_id: "abc123" }
  5. Rust stores secret in OS keychain (never in SQLite, never on disk)
  6. All SSE connections include: Authorization: Bearer <secret>
```

### Path Filtering (Rust-side)

```rust
// In bridge.rs — the Rust bridge enforces path allowlist
fn is_path_allowed(event_path: &str, service: &Service) -> bool {
    event_path.starts_with(&service.path)
}

// Even if someone hijacks the SSE stream, Rust only forwards
// to the configured path prefix. /admin, /api/users, etc. are blocked.
```

### Local-Only Communication

```
Desktop app:
  Relay ──HTTPS──→ Rust backend ──HTTP──→ localhost:3000
                   (encrypted)            (local only, never leaves machine)

Web MVP:
  Relay ──HTTPS──→ Browser JS ──HTTP──→ localhost:3000
                   (encrypted)          (local only, never leaves machine)
```

The relay never communicates with localhost. It only talks to the app/browser over HTTPS. The localhost `fetch()`/`reqwest` call is entirely local.

### Auto-Expiry

```
Channel lifecycle:
  Created          → active (SSE connected)
  No connection    → 1 hour grace period (webhooks buffer)
  Grace expired    → channel deleted, URL returns 404
  App quit         → SSE disconnects, grace period starts
  App restart      → reconnects, grace period cancelled
```

---

## Development Workflow

### Getting Started

```bash
git clone https://github.com/you/bridgehook
cd bridgehook
pnpm install

# Phase 1: Web MVP
pnpm dev:web        # → http://localhost:5173
pnpm dev:relay      # → wrangler dev (local Cloudflare Worker)

# Phase 2: Desktop App
pnpm dev:desktop    # → Tauri dev window + hot reload
```

### Build & Deploy

```bash
# Deploy relay (Cloudflare Worker)
pnpm deploy:relay

# Deploy web (Cloudflare Pages)
pnpm deploy:web

# Build desktop (platform-specific installer)
pnpm build:desktop  # → .msi (Windows), .dmg (Mac), .AppImage (Linux)
```

### Phase 1 → Phase 2 Code Sharing

The web app components are reused in the desktop app:

```typescript
// apps/desktop/src/views/Dashboard.tsx
import { EventLog } from '@bridgehook/web/components/EventLog';
import { EventDetail } from '@bridgehook/web/components/EventDetail';
import { ServiceCard } from '@bridgehook/web/components/ServiceCard';

// Desktop adds: tray integration, multi-service, history from SQLite
// But the core UI components are shared
```

The only desktop-specific code is:
- `src-tauri/` (Rust backend: bridge, tray, DB, config watcher)
- `src/views/` (dashboard layout, settings view)
- Tauri IPC calls (`invoke()` for service management, event queries)

---

## Deployment

### Infrastructure (100% Free)

Everything runs on Cloudflare's free tier:

| Service | Free Tier Limits | What It Hosts |
|---------|-----------------|---------------|
| Cloudflare Pages | Unlimited sites, unlimited bandwidth, 500 builds/month | Landing page + web dashboard |
| Cloudflare Workers | 100,000 requests/day, 10ms CPU/request | Relay server |
| Durable Objects | 1M requests/month, 1GB storage | Channel state (in-memory per channel) |
| Domain (.dev) | ~$12/year | **Only cost** |

Free tier handles tens of thousands of users before you'd need to pay anything.

### Domain & Subdomain Layout

```
bridgehook.dev              → Cloudflare Pages  → docs/         (landing page)
app.bridgehook.dev          → Cloudflare Pages  → apps/web/     (web dashboard)
relay.bridgehook.dev        → Cloudflare Worker → relay/        (webhook relay API)
```

### Setup Steps

**1. Domain**

Buy `bridgehook.dev` on Cloudflare Registrar (or any registrar and point nameservers to Cloudflare). ~$12/year.

**2. Landing Page (docs)**

Create a Cloudflare Pages project:
- Connect GitHub repo
- Build command: `pnpm --filter @bridgehook/docs build`
- Output directory: `docs/dist`
- Custom domain: `bridgehook.dev`

**3. Web Dashboard (apps/web)**

Create a second Cloudflare Pages project:
- Connect same GitHub repo
- Build command: `pnpm --filter @bridgehook/web build`
- Output directory: `apps/web/dist`
- Custom domain: `app.bridgehook.dev`

**4. Relay Worker**

```toml
# relay/wrangler.toml
name = "bridgehook-relay"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[durable_objects]
bindings = [{ name = "CHANNEL", class_name = "Channel" }]

[[migrations]]
tag = "v1"
new_classes = ["Channel"]

[env.production]
routes = [{ pattern = "relay.bridgehook.dev/*", zone_name = "bridgehook.dev" }]
```

Deploy:
```bash
pnpm --filter @bridgehook/relay deploy
# runs: wrangler deploy
```

### Auto-Deploy on Git Push

All three deploy automatically when you push to `main`:

```
git push origin main
  │
  ├── Cloudflare Pages (docs)    → auto-builds → bridgehook.dev
  ├── Cloudflare Pages (web)     → auto-builds → app.bridgehook.dev
  └── GitHub Action (relay)      → deploys     → relay.bridgehook.dev
```

Cloudflare Pages auto-deploys are built-in (just connect the repo). For the Worker, add a GitHub Action:

```yaml
# .github/workflows/deploy-relay.yml
name: Deploy Relay
on:
  push:
    branches: [main]
    paths:
      - 'relay/**'
      - 'packages/shared/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @bridgehook/relay deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CF_API_TOKEN }}
```

### Desktop App Distribution

The Tauri desktop app is built and distributed separately:

```bash
pnpm build:desktop
# Outputs:
#   Windows: bridgehook-setup.msi
#   macOS:   bridgehook.dmg
#   Linux:   bridgehook.AppImage
```

Distribution options:
- **GitHub Releases** — attach binaries to tagged releases (free)
- **Landing page** — download links on `bridgehook.dev/download`
- **Tauri updater** — built-in auto-update via `tauri-plugin-updater` (checks GitHub Releases)
- **Later:** Windows Store, Homebrew tap, Snap store

GitHub Action for desktop builds:

```yaml
# .github/workflows/build-desktop.yml
name: Build Desktop
on:
  push:
    tags: ['v*']

jobs:
  build:
    strategy:
      matrix:
        os: [windows-latest, macos-latest, ubuntu-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - name: Install Rust
        uses: dtolnay/rust-toolchain@stable
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @bridgehook/desktop tauri build
      - uses: softprops/action-gh-release@v2
        with:
          files: |
            apps/desktop/src-tauri/target/release/bundle/**/*
```

### User Journey Through Deployment

```
1. Developer Googles "test webhooks locally no install"
   → lands on bridgehook.dev                    (Cloudflare Pages — docs/)

2. Clicks "Try it free →"
   → redirected to app.bridgehook.dev           (Cloudflare Pages — apps/web/)

3. Enters port 3000, clicks Connect
   → browser connects SSE to relay.bridgehook.dev  (Cloudflare Worker — relay/)
   → gets URL: relay.bridgehook.dev/hook/abc123

4. Pastes URL into Stripe webhook config
   → Stripe POSTs to relay.bridgehook.dev/hook/abc123
   → relay pushes to browser via SSE
   → browser forwards to localhost:3000
   → webhooks flowing

5. Wants it always running (no browser tab)
   → clicks "Download Desktop App" on bridgehook.dev/download
   → installs .msi / .dmg / .AppImage           (GitHub Releases)
   → system tray app, same relay URL, no tab needed
```

### Cost at Scale

| Users | Monthly Requests | Cost |
|-------|-----------------|------|
| 1-100 | ~50K | $0 (free tier) |
| 100-1K | ~500K | $0 (free tier covers 3M Workers req/month) |
| 1K-10K | ~5M | ~$5/month (Workers paid plan) |
| 10K+ | ~50M+ | ~$50/month |

The relay is stateless and lightweight — each request is a few KB. Durable Objects handle channel state in-memory with no database costs.

---

## Monetization (Optional)

The core product is free and open source. Potential paid features:

| Feature | Free | Pro |
|---------|------|-----|
| Channels | 3 concurrent | Unlimited |
| Event history | 100 events | Unlimited |
| Buffering | 10 events | 1000 events |
| Auto-expiry | 24 hours | 7 days |
| Team sharing | No | Yes |
| Custom relay domain | No | `hooks.yourcompany.com` |
| Priority relay | Shared | Dedicated |

Self-hosted relay is always an option (deploy your own Worker).
