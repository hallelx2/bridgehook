/**
 * Sync response mode.
 *
 * An async channel (the default) answers every webhook with 202 at once and
 * delivers it to localhost later. A sync channel holds the sender's request
 * open until an executor reports what localhost answered, then returns that
 * status, headers and body to the sender. Voice and agent platforms need
 * this: their tool-call webhooks use the reply mid-conversation. It also
 * carries GET verification handshakes (`?hub.challenge=…`).
 *
 * The wait lives in the channel's Durable Object: intake and
 * `POST /hook/:id/response` both reach the same instance, so a waiter
 * registered by intake is settled by the response notification.
 */

export type ResponseMode = "async" | "sync";

export const SYNC_TIMEOUT_DEFAULT_MS = 25_000;
export const SYNC_TIMEOUT_MIN_MS = 1_000;
/** Below the platform's request limits; Vapi's longest tool timeout is 120 s. */
export const SYNC_TIMEOUT_MAX_MS = 100_000;

export function isResponseMode(v: unknown): v is ResponseMode {
	return v === "async" || v === "sync";
}

export function clampSyncTimeout(v: unknown): number | null {
	if (typeof v !== "number" || !Number.isFinite(v)) return null;
	return Math.min(SYNC_TIMEOUT_MAX_MS, Math.max(SYNC_TIMEOUT_MIN_MS, Math.round(v)));
}

/** What an executor reported for one event. */
export interface SyncResult {
	status: number;
	headers: Record<string, string>;
	body: string;
	latencyMs: number;
}

export type SyncOutcome = { kind: "response"; result: SyncResult } | { kind: "timeout" };

/**
 * Headers the relay must not copy from localhost's response onto its own:
 * hop-by-hop headers, and framing the Worker recomputes for the body it sends.
 */
const DROP_HEADERS = new Set([
	"connection",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"te",
	"trailer",
	"transfer-encoding",
	"upgrade",
	"content-length",
	"content-encoding",
	// A channel owner's server must never set cookies on a BridgeHook host:
	// on the relay host they would land beside the session, and on channel
	// hosts they could be scoped to the parent domain.
	"set-cookie",
	"set-cookie2",
]);

/**
 * Applied to every sync reply. The body comes from a channel owner's server
 * and is shown to whoever sent the request, possibly a person's browser:
 * these stop it from running script or being sniffed into something
 * executable, whatever its content type. Server-to-server senders ignore them.
 */
export const SYNC_SAFETY_HEADERS: Record<string, string> = {
	"Content-Security-Policy": "sandbox; default-src 'none'",
	"X-Content-Type-Options": "nosniff",
	"Cross-Origin-Resource-Policy": "cross-origin",
};

export function senderHeaders(headers: Record<string, string>): Headers {
	const out = new Headers();
	for (const [k, v] of Object.entries(headers)) {
		if (typeof v !== "string" || DROP_HEADERS.has(k.toLowerCase())) continue;
		try {
			out.append(k, v);
		} catch {
			// Invalid header name or value from the local server: skip it.
		}
	}
	return out;
}

/**
 * The response a sync channel sends back to the webhook sender.
 *
 * Status 0 means the executor could not get an answer from localhost (it is
 * down, or the payload failed three times): the sender gets 502 so its own
 * retry logic runs. A timeout is 504; the event stays queued either way.
 */
export function syncResponse(
	outcome: SyncOutcome,
	eventId: string,
	method: string,
	corsOrigin = "*",
): Response {
	if (outcome.kind === "timeout") {
		return Response.json(
			{
				error: "Your local server did not answer in time",
				eventId,
				hint: "Is the BridgeHook extension (or a dashboard tab) running for this URL? The event stays queued and will still be delivered.",
			},
			{
				status: 504,
				headers: { "Access-Control-Allow-Origin": corsOrigin, "X-BridgeHook-Event-Id": eventId },
			},
		);
	}
	const { result } = outcome;
	// 1xx cannot be a final response (Response() throws on it); anything
	// outside HTTP's range means the executor could not reach localhost.
	if (!Number.isInteger(result.status) || result.status < 200 || result.status > 599) {
		return Response.json(
			{
				error: "Your local server could not be reached",
				eventId,
				detail: result.body.slice(0, 500),
			},
			{
				status: 502,
				headers: { "Access-Control-Allow-Origin": corsOrigin, "X-BridgeHook-Event-Id": eventId },
			},
		);
	}
	const headers = senderHeaders(result.headers);
	for (const [k, v] of Object.entries(SYNC_SAFETY_HEADERS)) headers.set(k, v);
	headers.set("X-BridgeHook-Event-Id", eventId);
	if (!headers.has("access-control-allow-origin"))
		headers.set("Access-Control-Allow-Origin", corsOrigin);
	// Statuses that must not carry a body (Response() throws otherwise).
	const noBody =
		method === "HEAD" || result.status === 204 || result.status === 205 || result.status === 304;
	return new Response(noBody ? null : result.body, { status: result.status, headers });
}

/**
 * Waiters keyed by event id, plus a short memory of results that arrived
 * before their waiter (a fast executor can answer before intake's wait
 * request reaches the Durable Object).
 */
export class SyncWaiters {
	private waiters = new Map<string, Array<(o: SyncOutcome) => void>>();
	private early = new Map<string, { result: SyncResult; at: number }>();

	constructor(
		private readonly earlyTtlMs = 120_000,
		private readonly now: () => number = Date.now,
	) {}

	wait(eventId: string, timeoutMs: number): Promise<SyncOutcome> {
		this.prune();
		const ready = this.early.get(eventId);
		if (ready) {
			this.early.delete(eventId);
			return Promise.resolve({ kind: "response", result: ready.result });
		}
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				this.remove(eventId, finish);
				resolve({ kind: "timeout" });
			}, timeoutMs);
			const finish = (o: SyncOutcome) => {
				clearTimeout(timer);
				resolve(o);
			};
			const list = this.waiters.get(eventId) ?? [];
			list.push(finish);
			this.waiters.set(eventId, list);
		});
	}

	settle(eventId: string, result: SyncResult): void {
		const list = this.waiters.get(eventId);
		if (list && list.length > 0) {
			this.waiters.delete(eventId);
			for (const finish of list) finish({ kind: "response", result });
			return;
		}
		this.prune();
		this.early.set(eventId, { result, at: this.now() });
	}

	get pending(): number {
		let n = 0;
		for (const list of this.waiters.values()) n += list.length;
		return n;
	}

	private remove(eventId: string, finish: (o: SyncOutcome) => void): void {
		const list = this.waiters.get(eventId);
		if (!list) return;
		const rest = list.filter((f) => f !== finish);
		if (rest.length > 0) this.waiters.set(eventId, rest);
		else this.waiters.delete(eventId);
	}

	private prune(): void {
		const cutoff = this.now() - this.earlyTtlMs;
		for (const [id, v] of this.early) if (v.at < cutoff) this.early.delete(id);
	}
}
