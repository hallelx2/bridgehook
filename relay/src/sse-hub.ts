/**
 * The Server-Sent Events connections a Durable Object holds (per user in
 * UserDO, per channel in ChannelDO), and how dead ones are let go.
 *
 * A client that goes away is not reliably reported: the request's abort
 * signal does not always cross the Worker → Durable Object hop, and a write
 * to a stream nobody reads does not reject, it stays pending. Before this
 * hub (HAL-2722) such connections stayed counted forever, so a user whose
 * extension had restarted eight times could no longer open a live stream
 * ("Too many connections") until the next deploy, and one pending write held
 * up every notify and heartbeat for the others. Now:
 *
 * - every write has a deadline; a connection that misses it is dropped;
 * - a cancelled stream is noticed through the writer's `closed` promise as
 *   well as the abort signal;
 * - at the cap the oldest connection is closed to make room, because a
 *   client that is connecting is the one most likely to be alive;
 * - a heartbeat runs while anything is connected, so dead connections are
 *   found within one interval even when no webhook arrives.
 */

export interface SseHubOptions {
	/** Most open connections; the oldest is closed to admit a new one. */
	maxConnections: number;
	/** A write that has not completed by then marks its connection dead. */
	writeTimeoutMs?: number;
	/** Comment frame interval while anything is connected; 0 disables. */
	heartbeatMs?: number;
	/** CORS for the stream response. */
	headers?: Record<string, string>;
}

const encoder = new TextEncoder();
const CONNECTED = encoder.encode(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
const HEARTBEAT = encoder.encode(": heartbeat\n\n");

interface Connection {
	writer: WritableStreamDefaultWriter<Uint8Array>;
}

export class SseHub {
	private connections = new Set<Connection>();
	private heartbeat: ReturnType<typeof setInterval> | null = null;
	private readonly writeTimeoutMs: number;
	private readonly heartbeatMs: number;

	constructor(private readonly opts: SseHubOptions) {
		this.writeTimeoutMs = opts.writeTimeoutMs ?? 10_000;
		this.heartbeatMs = opts.heartbeatMs ?? 20_000;
	}

	get size(): number {
		return this.connections.size;
	}

	/** Opens a stream for a client; `signal` is the client's request signal. */
	open(signal?: AbortSignal): Response {
		while (this.connections.size >= this.opts.maxConnections) {
			const oldest = this.connections.values().next().value;
			if (!oldest) break;
			this.drop(oldest, "evicted for a newer connection");
		}

		const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
		const conn: Connection = { writer: writable.getWriter() };
		this.connections.add(conn);

		conn.writer.closed.then(
			() => this.forget(conn),
			() => this.forget(conn),
		);
		signal?.addEventListener("abort", () => this.drop(conn, "client aborted"));

		void this.write(conn, CONNECTED);
		this.startHeartbeat();

		return new Response(readable, {
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				"X-Accel-Buffering": "no",
				...(this.opts.headers ?? {}),
			},
		});
	}

	/** Sends one `data:` frame to every connection; resolves with how many took it. */
	async broadcast(payload: string): Promise<number> {
		return this.fanOut(encoder.encode(`data: ${payload}\n\n`));
	}

	private async fanOut(frame: Uint8Array): Promise<number> {
		const results = await Promise.all(Array.from(this.connections, (c) => this.write(c, frame)));
		return results.filter(Boolean).length;
	}

	/** True when the write completed in time; otherwise the connection is dropped. */
	private async write(conn: Connection, frame: Uint8Array): Promise<boolean> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const deadline = new Promise<"timeout">((resolve) => {
			timer = setTimeout(() => resolve("timeout"), this.writeTimeoutMs);
		});
		try {
			const outcome = await Promise.race([
				conn.writer.write(frame).then(() => "ok" as const),
				deadline,
			]);
			if (outcome === "timeout") {
				this.drop(conn, "write timed out");
				return false;
			}
			return true;
		} catch {
			this.drop(conn, "write failed");
			return false;
		} finally {
			clearTimeout(timer);
		}
	}

	private drop(conn: Connection, _reason: string): void {
		if (!this.connections.has(conn)) return;
		this.forget(conn);
		// abort() rejects pending writes, so nothing stays awaited on it.
		conn.writer.abort(_reason).catch(() => {
			/* already closed */
		});
	}

	private forget(conn: Connection): void {
		this.connections.delete(conn);
		if (this.connections.size === 0) this.stopHeartbeat();
	}

	private startHeartbeat(): void {
		if (this.heartbeat !== null || this.heartbeatMs <= 0) return;
		this.heartbeat = setInterval(() => {
			void this.fanOut(HEARTBEAT);
		}, this.heartbeatMs);
	}

	private stopHeartbeat(): void {
		if (this.heartbeat !== null) {
			clearInterval(this.heartbeat);
			this.heartbeat = null;
		}
	}
}
