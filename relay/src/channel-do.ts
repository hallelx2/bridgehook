import { MAX_SSE_CONNECTIONS_PER_CHANNEL } from "@bridgehook/shared";
import { SseHub } from "./sse-hub.js";
import { type SyncResult, SyncWaiters, clampSyncTimeout } from "./sync.js";

/**
 * Durable Object per channel: SSE connections, and sync-mode waiters.
 *
 * This DO holds the SSE writer references in memory. Because a Durable Object
 * is a single persistent instance per ID, all requests for the same channel
 * hit the same instance — SSE connections and webhook pushes share state.
 *
 * The Worker routes:
 *   GET  /hook/:channelId/events   → DO (SSE stream)
 *   POST /hook/:channelId/notify   → DO (push event to SSE listeners)
 *   POST /wait {eventId, timeoutMs} → DO (sync mode: resolve with localhost's
 *                                     response once an executor reports it)
 */
export class ChannelDO implements DurableObject {
	private hub = new SseHub({
		maxConnections: MAX_SSE_CONNECTIONS_PER_CHANNEL,
		headers: { "Access-Control-Allow-Origin": "*" },
	});
	private waiters = new SyncWaiters();

	constructor(
		private state: DurableObjectState,
		private env: unknown,
	) {}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		if (request.method === "GET" && path.endsWith("/events")) {
			return this.hub.open(request.signal);
		}

		if (request.method === "POST" && path.endsWith("/notify")) {
			return this.handleNotify(request);
		}

		if (request.method === "POST" && path.endsWith("/wait")) {
			return this.handleWait(request);
		}

		return new Response("Not Found", { status: 404 });
	}

	private async handleWait(request: Request): Promise<Response> {
		const body = (await request.json().catch(() => null)) as {
			eventId?: unknown;
			timeoutMs?: unknown;
		} | null;
		const timeoutMs = clampSyncTimeout(body?.timeoutMs);
		if (typeof body?.eventId !== "string" || timeoutMs === null) {
			return Response.json({ error: "eventId and timeoutMs required" }, { status: 400 });
		}
		return Response.json(await this.waiters.wait(body.eventId, timeoutMs));
	}

	private async handleNotify(request: Request): Promise<Response> {
		const payload = await request.text();

		// A response notification settles any sync waiter for that event,
		// whether or not anyone is watching the SSE stream.
		this.settleWaiter(payload);

		const pushed = this.hub.size === 0 ? 0 : await this.hub.broadcast(payload);
		return Response.json({ pushed, connected: this.hub.size });
	}

	private settleWaiter(payload: string): void {
		let msg: { type?: unknown; eventId?: unknown; sync?: unknown };
		try {
			msg = JSON.parse(payload);
		} catch {
			return;
		}
		if (msg.type !== "response" || typeof msg.eventId !== "string") return;
		const r = msg.sync as Partial<SyncResult> | undefined;
		if (!r || typeof r.status !== "number") return;
		this.waiters.settle(msg.eventId, {
			status: r.status,
			headers: r.headers && typeof r.headers === "object" ? r.headers : {},
			body: typeof r.body === "string" ? r.body : "",
			latencyMs: typeof r.latencyMs === "number" ? r.latencyMs : 0,
		});
	}
}
