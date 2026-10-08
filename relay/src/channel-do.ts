import { MAX_SSE_CONNECTIONS_PER_CHANNEL } from "@bridgehook/shared";
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
	private sseWriters: Set<WritableStreamDefaultWriter> = new Set();
	private encoder = new TextEncoder();
	private waiters = new SyncWaiters();

	constructor(
		private state: DurableObjectState,
		private env: unknown,
	) {}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		if (request.method === "GET" && path.endsWith("/events")) {
			return this.handleSSE(request);
		}

		if (request.method === "POST" && path.endsWith("/notify")) {
			return this.handleNotify(request);
		}

		if (request.method === "POST" && path.endsWith("/wait")) {
			return this.handleWait(request);
		}

		return new Response("Not Found", { status: 404 });
	}

	private handleSSE(request: Request): Response {
		// Enforce per-channel connection cap to prevent resource exhaustion
		if (this.sseWriters.size >= MAX_SSE_CONNECTIONS_PER_CHANNEL) {
			return new Response("Too many connections", {
				status: 429,
				headers: { "Access-Control-Allow-Origin": "*" },
			});
		}

		const { readable, writable } = new TransformStream();
		const writer = writable.getWriter();
		this.sseWriters.add(writer);

		// Send connected event (best-effort)
		writer
			.write(this.encoder.encode(`data: ${JSON.stringify({ type: "connected" })}\n\n`))
			.catch((err) => console.error("SSE initial write failed:", err));

		// Cleanup on disconnect
		request.signal.addEventListener("abort", () => {
			this.sseWriters.delete(writer);
			writer.close().catch(() => {
				/* already closed */
			});
		});

		return new Response(readable, {
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				"Access-Control-Allow-Origin": "*",
			},
		});
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

		if (this.sseWriters.size === 0) {
			return new Response(JSON.stringify({ pushed: 0 }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}

		const message = this.encoder.encode(`data: ${payload}\n\n`);

		// Fan out in parallel — a slow client must not block others.
		// Remove writers whose write rejects (client disconnected).
		const writers = Array.from(this.sseWriters);
		const results = await Promise.allSettled(writers.map((w) => w.write(message)));

		let pushed = 0;
		results.forEach((r, i) => {
			if (r.status === "fulfilled") {
				pushed++;
			} else {
				const w = writers[i];
				this.sseWriters.delete(w);
				console.error("SSE writer failed, removed:", r.reason);
				w.close().catch(() => {
					/* already closed */
				});
			}
		});

		return new Response(JSON.stringify({ pushed, connected: this.sseWriters.size }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
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
