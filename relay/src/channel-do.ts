/**
 * Durable Object for per-channel SSE connections.
 *
 * This DO holds the SSE writer references in memory. Because a Durable Object
 * is a single persistent instance per ID, all requests for the same channel
 * hit the same instance — SSE connections and webhook pushes share state.
 *
 * The Worker routes:
 *   GET  /hook/:channelId/events   → DO (SSE stream)
 *   POST /hook/:channelId/notify   → DO (push event to SSE listeners)
 */
export class ChannelDO implements DurableObject {
	private sseWriters: Set<WritableStreamDefaultWriter> = new Set();
	private encoder = new TextEncoder();

	constructor(
		private state: DurableObjectState,
		private env: unknown,
	) {}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		// SSE stream — client connects here
		if (request.method === "GET" && path.endsWith("/events")) {
			return this.handleSSE(request);
		}

		// Notify — Worker calls this after storing an event in Neon
		if (request.method === "POST" && path.endsWith("/notify")) {
			return this.handleNotify(request);
		}

		return new Response("Not Found", { status: 404 });
	}

	private handleSSE(request: Request): Response {
		const { readable, writable } = new TransformStream();
		const writer = writable.getWriter();
		this.sseWriters.add(writer);

		// Send connected event
		writer.write(this.encoder.encode(`data: ${JSON.stringify({ type: "connected" })}\n\n`));

		// Cleanup on disconnect
		request.signal.addEventListener("abort", () => {
			this.sseWriters.delete(writer);
			writer.close().catch(() => {});
		});

		return new Response(readable, {
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				"Access-Control-Allow-Origin": "*",
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

		let pushed = 0;
		for (const writer of this.sseWriters) {
			try {
				await writer.write(message);
				pushed++;
			} catch {
				this.sseWriters.delete(writer);
			}
		}

		return new Response(JSON.stringify({ pushed, connected: this.sseWriters.size }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	}
}
