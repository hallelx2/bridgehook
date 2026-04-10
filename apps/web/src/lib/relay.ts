/**
 * Client-side API helpers for talking to the relay server.
 * All DB operations happen server-side on the relay — the client
 * only makes fetch() calls.
 *
 * Uses polling (not SSE) because Cloudflare Workers free tier
 * kills idle connections after ~30s. Polling every 2s is reliable.
 */

const RELAY_URL = import.meta.env.VITE_RELAY_URL || "http://localhost:8787";

export interface ChannelInfo {
	channelId: string;
	port: number;
	expiresAt: string;
	webhookUrl: string;
}

export interface WebhookEventData {
	id: string;
	channelId: string;
	method: string;
	path: string;
	requestHeaders: string;
	requestBody: string | null;
	responseStatus: number | null;
	responseHeaders: string | null;
	responseBody: string | null;
	latencyMs: number | null;
	error: string | null;
	receivedAt: string;
}

export interface SSEWebhookEvent {
	type: "webhook";
	id: string;
	channelId: string;
	method: string;
	path: string;
	headers: Record<string, string>;
	body: string;
	receivedAt: string;
}

export interface SSEResponseEvent {
	type: "response";
	eventId: string;
	status: number;
	latencyMs: number;
}

export type SSEEvent =
	| { type: "connected"; channelId: string }
	| SSEWebhookEvent
	| SSEResponseEvent;

/** Create a new channel on the relay (server-side persists to Neon) */
export async function createChannel(port: number, allowedPaths: string[]): Promise<ChannelInfo> {
	const secret = crypto.randomUUID();
	const encoder = new TextEncoder();
	const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
	const secretHash = Array.from(new Uint8Array(hashBuffer))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");

	const res = await fetch(`${RELAY_URL}/api/channels`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ secretHash, port, allowedPaths }),
	});

	if (!res.ok) throw new Error(`Failed to create channel: ${res.status}`);
	const data = await res.json();

	localStorage.setItem(`bh_secret_${data.channelId}`, secret);
	return data;
}

/** Fetch channel info */
export async function getChannel(channelId: string): Promise<ChannelInfo | null> {
	const res = await fetch(`${RELAY_URL}/api/channels/${channelId}`);
	if (res.status === 404) return null;
	if (!res.ok) throw new Error(`Failed to get channel: ${res.status}`);
	return res.json();
}

/** Delete a channel */
export async function deleteChannel(channelId: string): Promise<void> {
	await fetch(`${RELAY_URL}/api/channels/${channelId}`, { method: "DELETE" });
	localStorage.removeItem(`bh_secret_${channelId}`);
}

/** Fetch events for a channel (used for both initial load and polling) */
export async function getEvents(channelId: string, limit = 50): Promise<WebhookEventData[]> {
	const res = await fetch(`${RELAY_URL}/api/channels/${channelId}/events?limit=${limit}`);
	if (!res.ok) throw new Error(`Failed to get events: ${res.status}`);
	return res.json();
}

/**
 * Poll for new events every `intervalMs`.
 * Returns a cleanup function to stop polling.
 * Calls `onNewEvents` only when new events are detected (by comparing IDs).
 */
export function pollEvents(
	channelId: string,
	onNewEvents: (events: WebhookEventData[]) => void,
	onError?: (error: Error) => void,
	intervalMs = 2000,
): () => void {
	let lastSeenId: string | null = null;
	let stopped = false;

	async function poll() {
		if (stopped) return;
		try {
			const events = await getEvents(channelId, 50);
			// Events come newest-first from the API
			if (events.length > 0 && events[0].id !== lastSeenId) {
				lastSeenId = events[0].id;
				onNewEvents(events);
			}
		} catch (err) {
			onError?.(err as Error);
		}
		if (!stopped) {
			setTimeout(poll, intervalMs);
		}
	}

	// Start polling
	poll();

	// Also fire a "connected" callback immediately
	onNewEvents([]);

	return () => {
		stopped = true;
	};
}

/**
 * Forward a webhook event to localhost.
 * This runs CLIENT-SIDE in the browser — the browser IS the bridge.
 */
export async function forwardToLocalhost(
	event: SSEWebhookEvent | WebhookEventData,
	port: number,
): Promise<{ status: number; headers: Record<string, string>; body: string; latencyMs: number }> {
	const start = performance.now();

	// Determine path and headers based on event type
	const eventPath =
		"headers" in event && typeof event.headers === "object" && !Array.isArray(event.headers)
			? event.path.replace(/^\/hook\/[a-z0-9]+/, "") || "/"
			: event.path.replace(/^\/hook\/[a-z0-9]+/, "") || "/";

	const rawHeaders: Record<string, string> =
		"requestHeaders" in event ? JSON.parse(event.requestHeaders || "{}") : event.headers;

	// Strip headers that break localhost forwarding
	const skipHeaders = new Set([
		"host",
		"cf-ray",
		"cf-connecting-ip",
		"cf-ipcountry",
		"cf-visitor",
		"x-real-ip",
		"x-forwarded-proto",
		"x-forwarded-for",
		"connection",
		"accept-encoding",
	]);
	const headers: Record<string, string> = {};
	for (const [k, v] of Object.entries(rawHeaders)) {
		if (!skipHeaders.has(k.toLowerCase())) {
			headers[k] = v;
		}
	}

	const body = "requestBody" in event ? event.requestBody : event.body;
	const method = event.method;

	const response = await fetch(`http://localhost:${port}${eventPath}`, {
		method,
		headers,
		body: body || undefined,
	});

	const latencyMs = Math.round(performance.now() - start);
	const respBody = await response.text();
	const respHeaders: Record<string, string> = {};
	response.headers.forEach((v, k) => {
		respHeaders[k] = v;
	});

	return { status: response.status, headers: respHeaders, body: respBody, latencyMs };
}

/** Send the local response back to the relay (server stores it in Neon) */
export async function sendResponse(
	channelId: string,
	eventId: string,
	response: { status: number; headers: Record<string, string>; body: string; latencyMs: number },
): Promise<void> {
	await fetch(`${RELAY_URL}/hook/${channelId}/response`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			eventId,
			...response,
		}),
	});
}

export { RELAY_URL };
