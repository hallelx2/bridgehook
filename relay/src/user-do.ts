import { SseHub } from "./sse-hub.js";

/**
 * Durable Object for per-USER SSE connections (cross-channel).
 *
 * Each instance corresponds to a single Better-Auth user id. The dashboard
 * connects to this DO via `GET /api/me/stream`; whenever a webhook lands on
 * any channel owned by that user, the worker calls `/notify` and the DO
 * fans the event out to every connected listener.
 *
 * Why a separate DO from {@link ChannelDO}: ChannelDO is per-channel and
 * powers the executor flow (one DO per channel = scoped contention). The
 * dashboard wants ambient cross-channel updates — "anything new on any of
 * my channels" — without holding N connections.
 *
 * Heartbeats: SSE intermediaries (CDNs, browser, the tab itself) often
 * idle out at 30–60 seconds. The DO writes a comment frame every
 * {@link HEARTBEAT_INTERVAL_MS} so the connection stays warm. This is
 * also what flushes CF buffers so events show up immediately on the wire.
 *
 * Hosted-mode only: self-hosted instances skip the user-stream entirely
 * (one user, no multi-channel coordination needed; the channel-level
 * polling/SSE remains the canonical path).
 */
const HEARTBEAT_INTERVAL_MS = 20_000;
/**
 * At the cap the oldest connection is closed to admit a new one (SseHub).
 * Set well above what one person keeps open (dashboard tabs, the extension,
 * a few CLIs), so eviction removes connections that are already dead rather
 * than live clients evicting each other in a reconnect loop.
 */
const MAX_SSE_CONNECTIONS_PER_USER = 32;

export class UserDO implements DurableObject {
	private hub = new SseHub({
		maxConnections: MAX_SSE_CONNECTIONS_PER_USER,
		heartbeatMs: HEARTBEAT_INTERVAL_MS,
		headers: { "Access-Control-Allow-Origin": "*" },
	});

	constructor(
		private state: DurableObjectState,
		private env: unknown,
	) {
		// Kept for future expansion (alarms / hibernation).
		void this.state;
		void this.env;
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		if (request.method === "GET" && path.endsWith("/stream")) {
			return this.hub.open(request.signal);
		}
		if (request.method === "POST" && path.endsWith("/notify")) {
			const payload = await request.text();
			const pushed = this.hub.size === 0 ? 0 : await this.hub.broadcast(payload);
			return Response.json({ pushed, connected: this.hub.size });
		}

		return new Response("Not Found", { status: 404 });
	}
}
