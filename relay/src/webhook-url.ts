/**
 * Webhook URL shape.
 *
 * A channel's public URL is `https://<relay host>/<channelId>`, e.g.
 * `https://relay.bridgehook.dev/2324radf23r`. Anything after the id is the
 * path forwarded to localhost: `…/2324radf23r/stripe/webhook` arrives at
 * `http://localhost:<port>/stripe/webhook`.
 *
 * `/hook/<channelId>` is kept as a back-compat alias for URLs handed out
 * before this shape existed. The executor control endpoints
 * (`/hook/<id>/claim`, `/hook/<id>/response`) are not webhook URLs and are
 * unaffected.
 */

/** Channel id format: lowercase alphanumeric, 1–24 chars. */
export const CHANNEL_ID_RE = /^[a-z0-9]{1,24}$/;

/**
 * First path segments the relay uses for its own routes. A channel id can
 * never equal one of these (ids are 12 random hex chars, so this only guards
 * against hand-typed URLs reaching a webhook handler).
 */
export const RESERVED_SEGMENTS = new Set(["api", "auth", "hook", "health"]);

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

/** Canonical public URL for a channel on the relay that served `requestUrl`. */
export function buildWebhookUrl(channelId: string, requestUrl: URL): string {
	return `${requestUrl.origin}/${channelId}`;
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
