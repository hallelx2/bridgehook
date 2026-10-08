/**
 * Webhook URL shape.
 *
 * The URL people paste into a provider is the channel's own host:
 * `https://<channelId>.<TUNNEL_DOMAIN>`, e.g. `https://34565sdfq344s.bridgehook.dev`.
 * The path is forwarded to localhost unchanged: `…bridgehook.dev/stripe/webhook`
 * arrives at `http://localhost:<port>/stripe/webhook`.
 *
 * The relay's own host (`relay.<TUNNEL_DOMAIN>`) is internal plumbing: the
 * API, claims, responses and the live stream. It also accepts webhooks at
 * `/<channelId>[/path]` and the older `/hook/<channelId>`, so links handed
 * out before the subdomain form keep working, and so self-hosted relays
 * without wildcard DNS (no TUNNEL_DOMAIN) still have a URL to give out.
 * The executor control endpoints (`/hook/<id>/claim`, `/hook/<id>/response`)
 * are not webhook URLs.
 */

/** Channel id format: lowercase alphanumeric, 1–24 chars. */
export const CHANNEL_ID_RE = /^[a-z0-9]{1,24}$/;

/**
 * First path segments the relay uses for its own routes. A channel id can
 * never equal one of these (ids are 12 random hex chars, so this only guards
 * against hand-typed URLs reaching a webhook handler).
 */
export const RESERVED_SEGMENTS = new Set(["api", "auth", "hook", "health", "mcp"]);

/** Methods a webhook URL accepts; anything else is not forwarded. */
export const WEBHOOK_METHODS = ["POST", "PUT", "PATCH", "DELETE"] as const;

export function isWebhookMethod(method: string): boolean {
	return (WEBHOOK_METHODS as readonly string[]).includes(method.toUpperCase());
}

export interface ChannelPath {
	channelId: string;
	/** Path forwarded to localhost; always starts with `/`. */
	forwardPath: string;
}

/**
 * Parse a request path as a webhook URL, or `null` when it isn't one.
 *
 *   "/2324radf23r"                → { channelId, forwardPath: "/" }
 *   "/2324radf23r/stripe/webhook" → { channelId, forwardPath: "/stripe/webhook" }
 *   "/hook/2324radf23r"           → { channelId, forwardPath: "/" }   (alias)
 *   "/hook/2324radf23r/claim"     → null  (executor control endpoint)
 *   "/api/channels"               → null  (reserved)
 */
export function parseChannelPath(pathname: string): ChannelPath | null {
	const segments = pathname.split("/");
	// segments[0] is "" because pathname starts with "/".
	const first = segments[1] ?? "";

	if (first === "hook") {
		const id = segments[2] ?? "";
		if (!CHANNEL_ID_RE.test(id) || segments.length > 3) return null;
		return { channelId: id, forwardPath: "/" };
	}

	if (!CHANNEL_ID_RE.test(first) || RESERVED_SEGMENTS.has(first)) return null;
	const rest = segments.slice(2).join("/");
	return { channelId: first, forwardPath: `/${rest}` };
}

/**
 * Subdomain labels under TUNNEL_DOMAIN that are first-party hosts or mail
 * plumbing, never channels. Channel ids are 12 random hex chars, so none can
 * collide; this guards hand-typed and future hosts.
 */
export const RESERVED_LABELS = new Set([
	"relay",
	"app",
	"docs",
	"www",
	"api",
	"admin",
	"status",
	"blog",
	"mail",
	"support",
	"help",
	"cf-bounce",
]);

export type TunnelHost =
	| { kind: "channel"; channelId: string }
	| { kind: "reserved"; label: string }
	/** Under TUNNEL_DOMAIN but neither a channel nor a reserved label. */
	| { kind: "zone" }
	| { kind: "other" };

/**
 * Classify a request's Host against TUNNEL_DOMAIN.
 *
 *   "34565sdfq344s.bridgehook.dev"  → channel
 *   "relay.bridgehook.dev"          → reserved (the relay itself)
 *   "foo-bar.bridgehook.dev", "x.y.bridgehook.dev"
 *                                   → zone (in the domain, not a channel)
 *   "bridgehook.dev", other domains, or no TUNNEL_DOMAIN → other
 *
 * Ports and a trailing dot are ignored; comparison is case-insensitive.
 */
export function classifyHost(rawHost: string | null, tunnelDomain: string | undefined): TunnelHost {
	if (!rawHost || !tunnelDomain) return { kind: "other" };
	let host = rawHost.split(":")[0].toLowerCase();
	if (host.endsWith(".")) host = host.slice(0, -1);
	const apex = tunnelDomain.toLowerCase().replace(/\.$/, "");
	if (!host.endsWith(`.${apex}`)) return { kind: "other" };
	const label = host.slice(0, -apex.length - 1);
	if (!label || label.includes(".")) return { kind: "zone" };
	if (RESERVED_LABELS.has(label)) return { kind: "reserved", label };
	if (!CHANNEL_ID_RE.test(label)) return { kind: "zone" };
	return { kind: "channel", channelId: label };
}

/**
 * The URL to show for a channel: its own subdomain when the relay has a
 * TUNNEL_DOMAIN and was reached over HTTPS (production), the path form on
 * whatever host served the request otherwise (local dev, self-host without
 * wildcard DNS).
 */
export function buildWebhookUrl(
	channelId: string,
	requestUrl: URL,
	tunnelDomain?: string | null,
): string {
	if (tunnelDomain && requestUrl.protocol === "https:") {
		return `https://${channelId}.${tunnelDomain.toLowerCase()}`;
	}
	return `${requestUrl.origin}/${channelId}`;
}

/** BridgeHook's own session cookies, with or without the `__Secure-` prefix. */
const OWN_COOKIE_RE = /^(?:__Secure-)?better-auth\./;

/**
 * Remove BridgeHook session cookies from a webhook's Cookie header before it
 * is stored and shown to the channel owner. A browser that holds a BridgeHook
 * session and is made to post to someone else's channel must not hand that
 * owner its session. Returns null when nothing is left.
 */
export function stripOwnCookies(cookieHeader: string): string | null {
	const kept = cookieHeader
		.split(";")
		.map((p) => p.trim())
		.filter((p) => p && !OWN_COOKIE_RE.test(p.split("=")[0].trim()));
	return kept.length > 0 ? kept.join("; ") : null;
}

/**
 * Match a forwarded path (no query string) against a channel's allow-list.
 * An empty list or a `/` entry allows everything; otherwise an entry matches
 * itself and anything below it (`/webhook` allows `/webhook/stripe`, not
 * `/webhooks`). Trailing slashes on entries are ignored.
 */
export function isPathAllowed(forwardPath: string, allowedPaths: string[]): boolean {
	if (allowedPaths.length === 0) return true;
	return allowedPaths.some((raw) => {
		const p = raw.length > 1 ? raw.replace(/\/+$/, "") : raw;
		if (p === "/") return true;
		return forwardPath === p || forwardPath.startsWith(`${p}/`);
	});
}
