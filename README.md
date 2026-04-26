<p align="center">
  <img src=".github/banner.png" alt="BridgeHook" width="800" />
</p>

<p align="center">
  <img src=".github/logo.svg" alt="bridgehook" height="48" />
</p>

<p align="center">
  <strong>An open-source webhook observability layer that runs in your browser tab.</strong>
  <br />
  <sub>No CLI. No binary. No account. Your browser is the tunnel.</sub>
</p>

<p align="center">
  <a href="#quickstart">Quickstart</a> &bull;
  <a href="#how-it-actually-works">Architecture</a> &bull;
  <a href="#observability">Observability</a> &bull;
  <a href="#prior-art--honesty">Prior Art</a> &bull;
  <a href="#self-hosting">Self-Host</a> &bull;
  <a href="#downloads">Downloads</a>
</p>

<p align="center">
  <a href="https://github.com/hallelx2/bridgehook/actions/workflows/ci.yml"><img src="https://github.com/hallelx2/bridgehook/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/hallelx2/bridgehook/actions/workflows/deploy-pages.yml"><img src="https://github.com/hallelx2/bridgehook/actions/workflows/deploy-pages.yml/badge.svg" alt="CD" /></a>
  <a href="https://github.com/hallelx2/bridgehook/releases"><img src="https://img.shields.io/github/v/release/hallelx2/bridgehook?label=release&color=FF5C26" alt="Release" /></a>
  <a href="https://github.com/hallelx2/bridgehook/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License" /></a>
  <img src="https://img.shields.io/badge/cost-%240%2Fmo-28c840" alt="Cost: $0/mo" />
  <img src="https://img.shields.io/badge/install-zero-FF5C26" alt="Zero install" />
</p>

---

## What is BridgeHook?

BridgeHook is two things in one repo:

1. **A zero-install webhook tunnel.** Open a URL, paste a port, get a public webhook endpoint that forwards to `localhost:3000`. Your browser tab is the agent — there's no binary to install, no account to create, no config file to write.
2. **A webhook observability layer.** Live event feed, replay, edit-and-replay, signature verification (Stripe / GitHub / Shopify / Clerk / Linear / Slack), pretty JSON tree, latency stats, mock-response mode, command palette, signing-secret manager. All in a single browser tab.

```
Stripe → POST → Cloudflare Worker → SSE → Your Browser → fetch() → localhost:3000
                                                ↑
                                  This is the part nobody else does.
```

Open a URL. Enter your port. Get a webhook endpoint. Done.

---

## Why we built it

Every existing tunnel makes you install something — `ngrok` binary, `cloudflared`, an npm package, an SSH client. That's fine until:

- You're on a corporate laptop that blocks installs
- You're trying to demo something in 30 seconds
- You don't want yet another background process eating CPU
- You're a junior dev who shouldn't have to learn `brew install` to test a Stripe webhook
- You want to *inspect* the traffic, not just relay it, and the inspector is paywalled

BridgeHook removes the install requirement entirely by realizing the browser is already a perfectly good tunnel agent — it can hold an SSE connection open, and modern browsers let HTTPS pages `fetch()` `http://localhost` for exactly this kind of use case.

---

## Prior art & honesty

We are not the first to relay webhooks over SSE. **[smee.io](https://smee.io)** by the Probot team has done this since 2017 and inspired a lot of the wire shape here. Smee.io is excellent — full credit. The differences:

|                              | smee.io        | BridgeHook                                           |
| ---------------------------- | -------------- | ---------------------------------------------------- |
| Public URL + SSE relay       | yes            | yes                                                  |
| Forwards to `localhost`      | via CLI install | **via browser tab — no install**                     |
| Inspector / replay UI        | minimal        | full observability layer                             |
| Signature verification       | no             | Stripe, GitHub, Shopify, Clerk, Linear, Slack        |
| Mock-response mode           | no             | yes                                                  |
| Command palette / shortcuts  | no             | yes (⌘K)                                             |
| Edge runtime                 | Heroku-style   | Cloudflare Workers + Durable Objects (free, global)  |

What's actually new in BridgeHook is the **combination**: browser-as-localhost-forwarder (only viable since browsers relaxed mixed-content rules for `localhost` ~2016) + Cloudflare Durable Objects holding the SSE (free, global, hibernating) + a polished observability UI on top. All three lined up; we shipped the product.

Other adjacent tools we admire and learned from:

- **ngrok / cloudflared / localtunnel** — install-required tunnels with the same purpose, different shape
- **webhook.site / RequestBin / Beeceptor** — capture-only inspectors that don't forward
- **Hookdeck / Svix / Convoy** — production webhook gateways for *sending*, not local dev

---

## Quickstart

**1. Open the web app**

```
https://bridgehook.dev
```

**2. Enter your port and click _Start bridge_**

```
Port:  3000
Paths: /webhook/stripe
       /webhook/github
```

**3. Copy your webhook URL**

```
https://relay.bridgehook.dev/hook/ch_9x4kf2m
```

**4. Paste it into Stripe / GitHub / Twilio.** Webhooks flow to your localhost in real time.

That's it. No install, no signup, no config files.

---

## How it actually works

The **browser sits at the intersection of the public internet and your `localhost`.** BridgeHook's JavaScript runs *inside* your browser, holds an open Server-Sent Events stream to a Cloudflare relay, and forwards each incoming webhook to localhost using `fetch()`.

```
THE INTERNET                           YOUR MACHINE
┌──────────────────────────┐          ┌──────────────────────────────┐
│  Webhook Sender          │          │  Your Browser (the agent)    │
│  (Stripe / GitHub / …)   │          │  ┌────────────────────────┐  │
│         │ POST           │          │  │  1. SSE receive        │  │
│         ▼                │   SSE    │  │  2. fetch() localhost  │  │
│  Cloudflare Worker  ─────────────────┤  │  3. POST response back │  │
│  + Durable Object        │          │  └─────────┬──────────────┘  │
│  + Neon PostgreSQL       │          │            ▼                 │
└──────────────────────────┘          │     localhost:3000           │
                                      └──────────────────────────────┘
```

A few things deserve emphasis because they are not obvious:

### 1. The browser is a real tunnel agent

ngrok ships a custom binary. cloudflared ships a custom binary. We ship a webpage. The agent is just JavaScript that:

```
POST /api/channels                    → { channelId, secret }
GET  /hook/:channelId/events?secret=  → open SSE forever
fetch("http://localhost:3000" + path) → forward webhook
POST /hook/:channelId/response        → return the result to the relay
```

That's the entire protocol. Any HTTP client can run it — browser, CLI, mobile app, a `curl` script in CI. **The agent is not browser-specific. It's just isomorphic HTTP.**

### 2. SSE in a Durable Object, not a long-lived server

Workers have a 30-second CPU limit per request. SSE held in a Worker would die. So the SSE stream lives in a per-channel **Durable Object** (`relay/src/channel-do.ts`), which can hold writers indefinitely and hibernates when idle. This is what makes "leave it open all day, free tier" actually work.

### 3. `localhost` from an HTTPS page is allowed

HTTPS pages normally can't `fetch()` `http://...` (mixed-content blocking). The exception, since ~2016 in Chrome and Firefox: **`localhost` is treated as a "potentially trustworthy origin"** under the W3C secure-contexts spec. This is the trick that makes the whole thing possible. Without it, BridgeHook wouldn't work and the browser would have no way to reach your dev server.

### 4. The relay is a dumb pipe

The relay's only jobs are: store events, hold the SSE stream, correlate request and response by ID. It does not have a key to your machine. It cannot run code on your machine. It can only deliver bytes to a browser tab that holds the channel secret. **Close the tab, the bridge dies.**

### 5. Channel secrets never leave your browser

When you create a channel, your browser generates a random secret, hashes it with SHA-256, and sends only the hash to the relay. The raw secret stays in browser memory. The relay uses constant-time hash comparison to authenticate the SSE and response endpoints. The webhook *sender* (Stripe, GitHub) never sees the secret — they just POST to a public URL and get a response back.

---

## Observability

BridgeHook isn't only a tunnel — it's a **webhook observability layer**. Every event is captured in Neon PostgreSQL with full request/response detail, then surfaced in the dashboard:

- **Live event feed** — every webhook with method, path, time, status, latency
- **Filter bar** — by query, status class (2xx/4xx/5xx/pending), and method
- **Stats panel** — throughput, p50/p95/p99 latency, success rate, error rate
- **Per-event detail** — request headers, body (JSON tree), response body, signature verification
- **Replay** — re-fire any event to localhost with one click
- **Edit & replay** — modify headers/body/method before replaying (great for bug repro)
- **Copy as cURL** — turn any captured webhook into a terminal command instantly
- **Signature verification** — Stripe, GitHub, Shopify, Clerk, Linear, Slack — paste the signing secret once, every event gets a green/red badge
- **Mock-response mode** — return canned responses without forwarding to localhost (useful when your dev server is offline)
- **Command palette** (⌘K) — replay last, copy URL, fire test request, manage secrets, toggle mock

If smee.io is "webhook tunnel," BridgeHook is **"webhook tunnel + Sentry for that webhook."** Same browser tab, no extra service.

---

## Architecture

```
bridgehook/
├── packages/shared/      Shared types, constants, Drizzle DB schema
├── apps/web/             Landing page + Dashboard (React + Vite + Tailwind)
├── apps/desktop/         System tray app (Tauri + Rust, Phase 2)
├── relay/                Cloudflare Worker + Durable Objects + Neon PostgreSQL
└── docs/                 Documentation site (React + Vite)
```

| Component   | Technology                                    | Free Tier      |
| ----------- | --------------------------------------------- | -------------- |
| Relay       | Cloudflare Workers + Durable Objects          | 100K req/day   |
| Database    | Neon PostgreSQL + Drizzle                     | 0.5 GB         |
| Web app     | Cloudflare Pages                              | Unlimited      |
| Docs site   | Cloudflare Pages                              | Unlimited      |
| Desktop     | Tauri v2 (Phase 2)                            | N/A            |

Total operating cost on the free tiers: **$0 / month**.

---

## Self-hosting

BridgeHook is fully open source. Run the entire stack yourself — same code, same features, your data:

```bash
git clone https://github.com/hallelx2/bridgehook
cd bridgehook
pnpm install

# Database
neon projects create --name bridgehook
cd relay && DATABASE_URL="your-neon-url" npx drizzle-kit push

# Configure
echo 'DATABASE_URL=your-neon-url' > relay/.dev.vars
echo 'VITE_RELAY_URL=http://localhost:8787' > apps/web/.env

# Run
pnpm dev:relay  # Terminal 1 — Cloudflare Worker on :8787
pnpm dev:web    # Terminal 2 — Vite dev server on :5173
```

Open `http://localhost:5173`. Done. Nothing you see on `bridgehook.dev` is closed-source or paywalled — every feature you can use on the hosted instance lives in this repo.

---

## Downloads

### Web app — no download needed

- **App**: [bridgehook.dev](https://bridgehook.dev)
- **Docs**: [docs.bridgehook.dev](https://docs.bridgehook.dev)

### Desktop app — Phase 2

For background operation without keeping a browser tab open. Runs in the system tray.

| Platform     | Direct download                                                     | Package manager                          |
| ------------ | ------------------------------------------------------------------- | ---------------------------------------- |
| **Windows**  | [`.msi`](https://github.com/hallelx2/bridgehook/releases/latest)     | `scoop install bridgehook`               |
| **macOS**    | [`.dmg`](https://github.com/hallelx2/bridgehook/releases/latest)     | `brew install bridgehook/tap/bridgehook` |
| **Linux**    | [`.AppImage`](https://github.com/hallelx2/bridgehook/releases/latest) | `snap install bridgehook`                |

### CLI — coming soon

The agent is just HTTP, so a CLI is a 100-line wrapper around `client-core`. Tracked in [#cli](https://github.com/hallelx2/bridgehook/issues).

```bash
# Planned distribution channels
brew install bridgehook         # macOS / Linux
scoop install bridgehook        # Windows
npm i -g @bridgehook/cli        # any Node
curl -fsSL bridgehook.dev/install.sh | sh
```

---

## Security

- **Channel secrets** — generated client-side, SHA-256 hashed before transmission, raw secret never leaves your browser
- **Constant-time auth** — secret comparison resists timing attacks
- **Path allowlist** — only approved endpoints get forwarded; everything else returns 403
- **Auto-expiry** — channels die after 24 hours and cascade-delete events
- **Rate limiting** — 60 req/min per channel, 1 MB max body, 32 KB max headers
- **Unguessable IDs** — 12-char random channel IDs, 16-char random event IDs
- **Instant kill** — close the tab, the SSE drops, the bridge stops forwarding
- **Self-hostable** — run the relay on your own Cloudflare account if you want zero third-party trust

A deeper write-up of the threat model is at [docs.bridgehook.dev/security](https://docs.bridgehook.dev/#/security-model).

---

## Contributing

We welcome contributions of every size — typo fixes, new provider signature schemes, dashboard polish, the planned CLI. See [CONTRIBUTING.md](CONTRIBUTING.md). The code is plain TypeScript with Biome for linting; no exotic toolchain.

If you're interested in tackling a specific area: open an issue first so we can scope it together.

## License

MIT — see [LICENSE](LICENSE). Use it, fork it, ship it. If you build something interesting on top, we'd love to hear about it.

---

<p align="center">
  <sub>Built on Cloudflare Workers, Durable Objects, Neon PostgreSQL, React, Vite, Tauri, and the W3C secure-contexts spec.</sub>
</p>
