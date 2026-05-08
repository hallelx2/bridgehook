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
const MAX_SSE_CONNECTIONS_PER_USER = 8;

export class UserDO implements DurableObject {
	private sseWriters: Set<WritableStreamDefaultWriter> = new Set();
	private encoder = new TextEncoder();
	private heartbeatHandle: ReturnType<typeof setInterval> | null = null;

	constructor(
		private state: DurableObjectState,
		private env: unknown,
	) {
		// Touch references so TS doesn't complain about unused params; the
		// state/env objects are kept for future expansion (alarms / hibernation).
		void this.state;
		void this.env;
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		if (request.method === "GET" && path.endsWith("/stream")) {
			return this.handleSSE(request);
		}
		if (request.method === "POST" && path.endsWith("/notify")) {
			return this.handleNotify(request);
		}

		return new Response("Not Found", { status: 404 });
	}

	private handleSSE(request: Request): Response {
		if (this.sseWriters.size >= MAX_SSE_CONNECTIONS_PER_USER) {
			return new Response("Too many connections", {
				status: 429,
				headers: { "Access-Control-Allow-Origin": "*" },
			});
		}

		const { readable, writable } = new TransformStream();
		const writer = writable.getWriter();
		this.sseWriters.add(writer);

		// Initial frame so the client confirms it's connected.
		writer
			.write(this.encoder.encode(`data: ${JSON.stringify({ type: "connected" })}\n\n`))
			.catch((err) => console.error("UserDO initial write failed:", err));

		// Start heartbeat on first connection. The interval ticks in the DO
		// isolate's event loop and writes a comment frame to every writer —
		// dead writers fall out via the same cleanup path as real notifies.
		if (this.heartbeatHandle === null) {
			this.heartbeatHandle = setInterval(() => {
				this.heartbeat().catch((err) => console.error("heartbeat error:", err));
			}, HEARTBEAT_INTERVAL_MS);
		}

		request.signal.addEventListener("abort", () => {
			this.sseWriters.delete(writer);
			writer.close().catch(() => {
				/* already closed */
			});
			if (this.sseWriters.size === 0 && this.heartbeatHandle !== null) {
				clearInterval(this.heartbeatHandle);
				this.heartbeatHandle = null;
			}
		});

		return new Response(readable, {
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				"Access-Control-Allow-Origin": "*",
				"X-Accel-Buffering": "no",
			},
		});
	}

	private async handleNotify(request: Request): Promise<Response> {
		if (this.sseWriters.size === 0) {
			return new Response(JSON.stringify({ pushed: 0 }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			});
		}
		const payload = await request.text();
		const message = this.encoder.encode(`data: ${payload}\n\n`);
		const pushed = await this.fanOut(message);
		return new Response(JSON.stringify({ pushed, connected: this.sseWriters.size }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	}

	private async heartbeat(): Promise<void> {
		if (this.sseWriters.size === 0) return;
		// SSE comment frame — ignored by EventSource clients but keeps the
		// stream alive across intermediaries.
		const frame = this.encoder.encode(": heartbeat\n\n");
		await this.fanOut(frame);
	}

	private async fanOut(message: Uint8Array): Promise<number> {
		const writers = Array.from(this.sseWriters);
		const results = await Promise.allSettled(writers.map((w) => w.write(message)));
		let pushed = 0;
		results.forEach((r, i) => {
			if (r.status === "fulfilled") {
				pushed++;
			} else {
				const w = writers[i];
				this.sseWriters.delete(w);
				w.close().catch(() => {
					/* already closed */
				});
			}
		});
		return pushed;
	}
}
