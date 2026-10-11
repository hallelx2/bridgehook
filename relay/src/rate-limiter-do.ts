/**
 * A fixed-window rate-limit counter, one Durable Object per (limit, key).
 *
 * Why not the Workers Rate Limiting binding: measured 2026-10-11 (HAL-2679),
 * it counted within one request but never across separate requests in
 * production (70 of 70 allowed against a limit of 10), because its counters
 * are cached per machine and separate requests land on different machines.
 * A Durable Object is one instance per name, and its requests run one at a
 * time, so the count is exact.
 *
 *   POST /hit?limit=10&period=60  →  { success, remaining, resetAt }
 *
 * The window starts at the first hit and lasts `period` seconds; at most
 * `limit` hits succeed in it. Once over, the counter stops writing, so a
 * flood costs one storage write per window, not one per request. An alarm
 * deletes the state after the window, so idle keys hold nothing.
 */

interface Window {
	start: number;
	count: number;
	periodMs: number;
}

const KEY = "window";

export class RateLimiterDO implements DurableObject {
	constructor(
		private state: DurableObjectState,
		private env: unknown,
		private now: () => number = Date.now,
	) {
		void this.env;
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const limit = Number(url.searchParams.get("limit"));
		const period = Number(url.searchParams.get("period"));
		if (
			request.method !== "POST" ||
			!Number.isInteger(limit) ||
			limit < 0 ||
			!Number.isInteger(period) ||
			period <= 0
		) {
			return Response.json(
				{ error: "Expected POST /hit?limit=<n>&period=<seconds>" },
				{ status: 400 },
			);
		}

		const now = this.now();
		const periodMs = period * 1000;
		let window = (await this.state.storage.get<Window>(KEY)) ?? null;
		const fresh = !window || now >= window.start + window.periodMs;
		if (!window || fresh) window = { start: now, count: 0, periodMs };

		window.count++;
		const success = window.count <= limit;
		// Write while counting up to the first refusal; after that the outcome
		// cannot change until the window ends, so skip the write.
		if (window.count <= limit + 1) await this.state.storage.put(KEY, window);
		if (fresh) await this.state.storage.setAlarm(window.start + periodMs + 1000);

		return Response.json({
			success,
			remaining: Math.max(0, limit - window.count),
			resetAt: window.start + periodMs,
		});
	}

	async alarm(): Promise<void> {
		const window = await this.state.storage.get<Window>(KEY);
		if (!window || this.now() >= window.start + window.periodMs) {
			await this.state.storage.deleteAll();
		}
	}
}
