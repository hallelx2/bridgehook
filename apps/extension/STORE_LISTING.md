# Chrome Web Store listing — BridgeHook

Copy-paste content for the Developer Dashboard. Derived from the actual
manifest, code, and /privacy page.

---

## Store listing tab

**Title** — `BridgeHook` (auto, from package)

**Summary** — `Webhook testing for apps built with AI: a permanent URL per local port, forwarded to localhost, queued while you're offline.` (set in the dashboard; max 132 characters)

> ⚠️ **Rejected once (3 Jun 2026, "Yellow Argon" — Spam / excessive keywords).**
> Cause: the old description listed many provider brand names
> (Stripe, Paystack, GitHub, …), which Chrome reads as keyword stuffing.
> The description below names no providers or AI products. Do **not** re-add a brand-name list.

**Description** (max 16,000), for v0.2.0:

```
BridgeHook is webhook testing for apps built with AI, and for the coding agents building them.

Every local port gets a permanent public URL. Webhooks sent to it are received by the BridgeHook relay and this extension delivers them to the server on your own machine (http://localhost:PORT), then records your server's answer. No CLI, no tunnel process, no firewall changes, and no CORS changes to your server.

WHY BRIDGEHOOK
• A URL you set once: the same port always keeps the same URL.
• Nothing lost while you're away: webhooks that arrive while your computer is off wait in a queue and are delivered in order when you're back.
• See your side: every request with your server's status, body and timing, and replay any of them.
• Replies for agent and voice tools: in sync mode the sender receives your local server's actual reply.
• Built for coding agents: BridgeHook includes an MCP server, so an AI coding assistant can send signed test webhooks to your handler, read what it returned, fix the code and try again.
• Several ports at once, with status on the toolbar badge.

HOW IT WORKS
1. Sign in and add the port your dev server listens on. You get a permanent URL.
2. Point your webhook provider at that URL.
3. Keep Chrome open. Webhooks are forwarded to your server and its answer is recorded, or returned to the sender in sync mode.

No extension? The BridgeHook dashboard can also forward from a browser tab.

PRIVACY
The extension talks to only two places: your own localhost (to deliver each webhook) and the BridgeHook relay (to receive events and report your server's answers). It does not read, modify, or inject into any website you browse. No analytics and no ad trackers. Full policy: https://app.bridgehook.dev/privacy
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

> bridgehook.dev is live (2026-10-07), but the apex does not serve a page yet
> (HAL-2400). Use the `app.` host for every listing URL until it does.

- **Official URL** — verify `bridgehook.dev` in Search Console, then select it.
- **Homepage URL** — `https://app.bridgehook.dev`
- **Support URL** — `https://docs.bridgehook.dev`

---

## Privacy tab

**Privacy policy URL** — `https://app.bridgehook.dev/privacy` *(live, checked 2026-10-08).*

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
• https://relay.bridgehook.dev/* (and the older https://bridgehook-relay.halleluyaholudele.workers.dev/* address of the same relay) — to read the queue of incoming webhooks and to report the local server's response back.
• https://app.bridgehook.dev/* — the BridgeHook dashboard, where the extension sends the user to sign in or view events. The extension reads nothing from its pages.
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

1. **Remote code: No.**
2. Listing URLs (homepage, support, privacy) use `app.bridgehook.dev` /
   `docs.bridgehook.dev`; confirm each loads publicly.
3. Update the Summary and Description above, and replace the screenshots with the
   current popup and dashboard.
4. Upload the rebuilt `bridgehook-extension-v0.2.0.zip` (HAL-2385).
