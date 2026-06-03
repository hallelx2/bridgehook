# Chrome Web Store listing — BridgeHook

Copy-paste content for the Developer Dashboard. Derived from the actual
manifest, code, and /privacy page.

---

## Store listing tab

**Title** — `BridgeHook` (auto, from package)

**Summary** — `Forward webhooks from the cloud to your localhost — no CLI, no tunnel, no install.` (auto, from package)

> ⚠️ **Rejected once (3 Jun 2026, "Yellow Argon" — Spam / excessive keywords).**
> Cause: the old description listed many provider brand names
> (Stripe, Paystack, GitHub, …), which Chrome reads as keyword stuffing.
> The description below removes that list. Do **not** re-add a brand-name list.

**Description** (max 16,000):

```
BridgeHook delivers real webhooks from the internet straight to a server running on your own machine — no CLI to install, no tunnel to keep running, no firewall changes.

Point your webhook provider at the unique URL BridgeHook gives you. We receive the request on our relay and the extension forwards it to your local development server (http://localhost:PORT) in milliseconds, then sends your server's response back. You build and debug webhook integrations locally, exactly as they behave in production.

WHY BRIDGEHOOK
• Zero install friction — it's a browser extension, not a binary or a tunnel daemon.
• Stable URL — your endpoint stays the same across restarts, so you set it once.
• Real-time — incoming requests stream over a live connection and forward instantly.
• Inspect and replay — see each request's method, headers, and body, and replay any one against your local server.
• Multiple services at once — bridge several local ports in parallel.
• Status at a glance — the toolbar badge shows active bridges, errors, and limits.

HOW IT WORKS
1. Sign in and create a channel — you get a stable public URL.
2. Point your provider at that URL.
3. Keep the extension running. Incoming requests are forwarded to your local server and the response goes back to the sender.

PRIVACY
The extension talks to only two places: your own localhost (to forward the request) and the BridgeHook relay (to receive events and report responses). It does not read, modify, or inject into any website you browse. No analytics and no ad trackers. Full policy: https://bridgehook-web.pages.dev/privacy
```

**Category** — `Developer Tools`

**Language** — `English (United States)`

---

## Graphic assets

| Asset | Spec | What to use |
|---|---|---|
| **Store icon** (required) | 128×128 | Upload `apps/extension/icons/icon-128.png` — already exactly 128×128. |
| **Screenshots** (≥1 required, up to 5) | 1280×800 or 640×400, **24-bit PNG (no alpha)** or JPEG | See suggestions below. |
| Small promo tile (optional) | 440×280, no alpha | Logo + tagline on solid bg. |
| Marquee promo tile (optional) | 1400×560, no alpha | Only needed for featuring. |

**Screenshot ideas (pick up to 5):**
1. The extension **popup** showing one or more connected services (cyan status dots).
2. The **dashboard** event list with live incoming webhooks.
3. An **event detail** view (method, headers, body, response).
4. The **add-service / channel creation** flow.
5. The landing hero (the cyan/orange shader) for a clean branded shot.

> Tip: export at exactly 1280×800. If you screenshot a smaller window, pad onto a 1280×800 solid-color canvas. Must be **no alpha channel** — flatten before exporting.

---

## Additional fields

> ⚠️ **bridgehook.dev is not purchased yet.** Until it is, every URL here must
> point at the **live Cloudflare Pages domain** (`bridgehook-web.pages.dev`),
> not `bridgehook.dev` — the store rejects dead URLs. Swap them all over once
> the domain is live.

- **Official URL** — skip for now (you can't verify a domain you don't own yet).
- **Homepage URL** — `https://bridgehook-web.pages.dev`
- **Support URL** — `https://bridgehook-web.pages.dev`  (or a dedicated support/contact page — `mailto:` is not accepted here, use an https page)

---

## Privacy tab

**Privacy policy URL** — `https://bridgehook-web.pages.dev/privacy`  *(this is the live page today; switch to `https://bridgehook.dev/privacy` after you buy the domain. Confirm it loads publicly before submitting.)*

### Single purpose description
```
BridgeHook forwards webhooks received by the BridgeHook cloud relay to a development server running on the user's own computer (localhost), so developers can test webhook integrations locally without installing a CLI or a tunnel. The extension's only function is to relay these HTTP requests between our service and the user's localhost and to show their delivery status.
```

### Permission justifications

**storage**
```
Stores the user's bridge configuration locally via chrome.storage: the localhost ports and channel labels they choose to forward, the current connection status, and the session/device token that authenticates the extension to the BridgeHook relay. No browsing data is stored, and the extension stores nothing remotely beyond what the user explicitly configures.
```

**notifications**
```
Shows a desktop notification when a webhook cannot reach the user's local server (for example the dev server is offline / connection refused) or when a plan limit is reached, so the developer knows delivery has stopped while they are working in another tab. Notifications are triggered only by the user's own webhook traffic.
```

**alarms**
```
The Manifest V3 service worker uses chrome.alarms to periodically re-establish the relay connection and keep the webhook event stream alive after Chrome suspends the worker. Without it, MV3 would idle the worker and webhooks would stop being forwarded until the popup was reopened.
```

**Host permission justification**
```
BridgeHook forwards webhooks from our relay to the user's own machine, so it needs:
• http://localhost/* — to deliver each received webhook to the local development server the user is bridging (on any port they choose).
• https://bridgehook-relay.halleluyaholudele.workers.dev/* and https://relay.bridgehook.dev/* — to open the authenticated event stream that delivers incoming webhooks and to report the local server's response back. (The workers.dev host is the current relay; the bridgehook.dev host is the production domain we are migrating to.)
The extension does not request access to, read, or inject into any third-party website the user visits.
```

### Are you using remote code?
**Select: `No, I am not using remote code.`**
> All JavaScript is bundled in the package (`background.js`, `popup.js`). There are no external `<script>` tags, no `eval`, no `importScripts`, and no remotely-hosted modules. The extension fetches webhook *data* over the network — that is data, not code. (Selecting "Yes" is what triggers the in-depth-review delay warning you saw.)

### Data usage — checkboxes to tick
- ☑ **Personally identifiable information** — the extension displays/holds the signed-in account email.
- ☑ **Authentication information** — it holds a session/device token to authenticate to the relay.
- ☐ Everything else (health, financial, personal communications, location, web history, user activity, website content) — **leave unchecked**. The extension does not read pages you browse.

### Certifications — tick all three (all required)
- ☑ I do not sell or transfer user data to third parties, apart from the approved use cases.
- ☑ I do not use or transfer user data for purposes unrelated to my item's single purpose.
- ☑ I do not use or transfer user data to determine creditworthiness or for lending purposes.

---

## Before you click "Submit for review"

1. **Switch "remote code" to No** (biggest win — removes the in-depth-review warning).
2. **Keep the `*.workers.dev` / `*.pages.dev` hosts** — these are the live endpoints
   until `bridgehook.dev` is purchased. Do NOT strip them. (The `relay.bridgehook.dev`
   / `app.bridgehook.dev` entries are harmless forward-compat; leave them so you don't
   need a re-review when the domain goes live.)
3. Verify the privacy URL is **live and public** — today that's
   `https://bridgehook-web.pages.dev/privacy`.
4. All listing URLs (homepage, support, privacy) must use `bridgehook-web.pages.dev`
   for now, since `bridgehook.dev` does not resolve yet.
5. Upload the rebuilt `bridgehook-extension-v0.1.0.zip` (redesigned popup + valid localhost pattern).
```
```
