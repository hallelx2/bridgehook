/**
 * Client-side API helpers for talking to the relay server.
 * All DB operations happen server-side on the relay — the client
 * only makes fetch() calls and connects via SSE.
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
	// Generate a secret client-side, hash it, send hash to server
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

	// Store secret locally
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

/** Fetch historical events for a channel */
export async function getEvents(channelId: string, limit = 50): Promise<WebhookEventData[]> {
	const res = await fetch(`${RELAY_URL}/api/channels/${channelId}/events?limit=${limit}`);
	if (!res.ok) throw new Error(`Failed to get events: ${res.status}`);
	return res.json();
}

/** Connect to SSE stream for real-time events */
export function connectSSE(
	channelId: string,
	onEvent: (event: SSEEvent) => void,
	onError?: (error: Event) => void,
): () => void {
	const source = new EventSource(`${RELAY_URL}/hook/${channelId}/events`);

	source.onmessage = (msg) => {
		const data = JSON.parse(msg.data) as SSEEvent;
		onEvent(data);
	};

	source.onerror = (err) => {
		onError?.(err);
	};

	return () => source.close();
}

/**
 * Forward a webhook event to localhost.
 * This runs CLIENT-SIDE in the browser — the browser IS the bridge.
 */
export async function forwardToLocalhost(
	event: SSEWebhookEvent,
	port: number,
): Promise<{ status: number; headers: Record<string, string>; body: string; latencyMs: number }> {
	const start = performance.now();

	// Strip the /hook/:channelId prefix to get the actual path
	const localPath = event.path.replace(/^\/hook\/[a-z0-9]+/, "") || "/";

	const response = await fetch(`http://localhost:${port}${localPath}`, {
		method: event.method,
		headers: event.headers,
		body: event.body || undefined,
	});

	const latencyMs = Math.round(performance.now() - start);
	const body = await response.text();
	const headers: Record<string, string> = {};
	response.headers.forEach((v, k) => {
		headers[k] = v;
	});

	return { status: response.status, headers, body, latencyMs };
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
