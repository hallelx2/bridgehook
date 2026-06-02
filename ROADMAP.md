# BridgeHook Roadmap

Forward-looking plan for the work in flight. Captures the decisions made so
far so the protocol stays stable and each new client is an adapter, not a
rewrite. See [README › Clients](README.md#clients) for the user-facing summary.

Last updated: 2026-06-02.

---

## Guiding principle

The agent protocol — channel create, SSE event stream, event claim, signed
response, device-token auth — is the **stable contract** every client reuses.
Keep it clean and documented; then the browser extension, desktop app, browser
tab, SDK, and CLI are all small adapters over the same relay.

The **browser extension is the backbone**: install once, then zero code, any
localhost port, any framework, none of the browser-sandbox limits to fight.
Everything else is additive.

---

## 1. Clients — phased rollout

### Phase 1 — Browser extension *(now / shipping)*
- **Status:** redesigned (cyan + orange rebrand, new bridge-hook icons, popup
  rework), manifest fixed (valid `http://localhost/*` match pattern), packaged
  as `bridgehook-extension-v0.1.0.zip`.
- **Remaining for store submission:**
  - Set "Are you using remote code?" → **No** (all JS is bundled; this removes
    the in-depth-review delay warning).
  - Use **live** listing URLs (`bridgehook-web.pages.dev/...`) until the domain
    is purchased — the store rejects dead URLs.
  - Confirm `https://bridgehook-web.pages.dev/privacy` loads publicly.
  - Upload screenshots (4 generated, 1280×800, 24-bit, no alpha).
- Full field-by-field guide: [apps/extension/STORE_LISTING.md](apps/extension/STORE_LISTING.md).

### Phase 2 — Programmatic SDK + decorator *(next)*
One package, two unlocks:

- **Browser "no-install" mode.** A decorator/middleware (`@bridgehook` in
  Python; Express/Fastify/Hono middleware in TS) sets the CORS headers so the
  hosted dashboard can read the local API's response. The hosted dashboard
  already forwards from the browser via `forwardToLocalhost()`
  ([apps/web/src/lib/relay.ts](apps/web/src/lib/relay.ts)); the decorator is the
  missing piece that makes the local API accept the request.
- **Headless / Docker mode.** `bridgehook.connect(token)` runs *inside* the
  user's app process, opens the relay stream itself, and dispatches webhooks
  **in-process**. No browser ⇒ none of the sandbox/CORS/Local-Network rules
  apply. This is the easiest environment of all.

**Targets:** Python (FastAPI dependency/middleware, Flask `after_request`,
Django middleware) and TypeScript (Express, Fastify, Hono, Next.js route
wrapper). Each adapter is ~30–80 lines. Reuses the existing forwarding logic
and device-token auth.

**Effort:** ~3–5 days for a polished v1 (browser mode + Python + TS, 2
frameworks each), including PyPI/npm publishing.

### Phase 3 — CLI agent *(later, optional)*
A thin wrapper over the SDK's forwarding loop for headless boxes where adding
even one line of code isn't acceptable (CI runners, bridging a third-party
process you don't own). **Low priority** — the SDK already covers most server
cases. Distribute as a small binary + `bridgehook/agent` Docker image.

**Effort:** ~1–2 days, mostly reusing existing code.

---

## 2. Browser mode & the Chrome Local Network Access change

As of **Chrome 142 (Oct 28, 2025)**, Local Network Access (LNA) **replaced** the
old header-based Private Network Access. Implications for browser-tab mode:

- A **public** site (the hosted dashboard) reaching `localhost` now triggers a
  **one-time, per-origin user permission prompt** ("allow access to your local
  network / loopback"). Loopback (`127.0.0.0/8`, `::1`) is **not** exempt for a
  public origin.
- The old `Access-Control-Allow-Private-Network` / `Private-Network-Access-*`
  headers are being phased out — the gate is now the **permission prompt**.
- Ordinary **CORS** headers are still required so the dashboard can read the
  response — that's the decorator's job.
- Chrome 146+ splits this into separate "Local Network" and "Loopback Network"
  permissions; BridgeHook would request the loopback one.

**Net:** browser-tab mode is viable but means "click Allow once + add the
decorator." This is why it's an onboarding/demo tier, **not** the backbone. The
extension and desktop app are native and unaffected.

**De-risk task before building Phase 2 browser mode:** spend ~30 min testing
current-Chrome behavior — dashboard origin → `http://localhost:PORT` with the
decorator's CORS headers: does the one-time LNA prompt appear, and once allowed,
does it persist cleanly? That single test confirms the UX wording.

References:
- https://developer.chrome.com/blog/local-network-access
- https://wicg.github.io/local-network-access/
- https://chromestatus.com/feature/5152728072060928

---

## 3. Docker / headless servers

Yes — and it's the *easiest* case, because no browser means no CORS/LNA/
mixed-content rules. Two shapes:

- **Embedded SDK (preferred):** `bridgehook.connect()` in the app process,
  in-process dispatch, no localhost networking at all.
- **Sidecar CLI agent:** a long-lived process forwarding to the app's port.

**Docker gotcha:** inside a container `localhost` is the container itself.
- Embedded SDK sidesteps this (in-process dispatch).
- A sidecar must target the app's **service name** (e.g. `http://app:3000`) or
  share its network namespace (`network_mode: "service:app"`).

---

## 4. Domain migration — `bridgehook.dev`

The domain is **not purchased yet**, so the live endpoints are the Cloudflare
`*.workers.dev` / `*.pages.dev` hosts. When the domain is acquired:

- [ ] Keep `*.workers.dev` / `*.pages.dev` in the extension `host_permissions`
      until traffic is fully migrated (they are the working hosts today). The
      `relay.bridgehook.dev` / `app.bridgehook.dev` entries are harmless
      forward-compat and avoid a re-review later.
- [ ] Swap store-listing URLs (homepage, support, privacy) from
      `bridgehook-web.pages.dev` → `bridgehook.dev`.
- [ ] Update README Quickstart/Downloads URLs (`bridgehook.dev`,
      `relay.bridgehook.dev`, `docs.bridgehook.dev`) once live.
- [ ] Verify ownership in Google Search Console to set the store "Official URL".

---

## 5. Branding *(done)*

- Cyan (`#22d3ee`) + orange (`#FF5C26`) palette across web, extension, desktop.
- New bridge-arch + hook mark; regenerated Tauri icon set.
- Web favicon set generated from the mark (`favicon.svg/.ico`, PNG sizes,
  apple-touch-icon, PWA icons) and wired into the web app.
- Hero shader retuned: darker, gritty rust texture with the orange receding to a
  low ember (was too bright/loud).

---

## Open questions / future ideas

- Should the embedded SDK also expose the observability stream (so server apps
  can read their own event history programmatically)?
- Firefox/Safari behavior for browser-tab mode (Safari is stricter on localhost
  from HTTPS) — document per-browser support before promoting browser mode.
- Auto-print the live BridgeHook URL on app boot when the SDK detects a channel
  token (DX nicety for the decorator flow).
