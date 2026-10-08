/**
 * Ordered delivery for the no-install executor (a dashboard tab).
 *
 * The same algorithm as the extension's bridge loop, so a tab and the
 * extension behave identically:
 *   • drain the channel's queue (`?pending=1`) oldest first, page by page,
 *     so webhooks that arrived while no tab was open are delivered in order
 *   • claim each event before forwarding, refreshing the claim while the
 *     local handler works, so exactly one executor forwards it
 *   • local server down → stop at that event and retry later; outages never
 *     count against the event
 *   • local server up but blocking cross-origin reads (no CORS) → stop and
 *     tell the user how to allow it; the event stays queued
 *   • local server up but this event keeps failing → after MAX_ATTEMPTS
 *     record status 0 and move on, so one payload cannot block the queue
 *
 * Framework-free so it can be unit-tested with fake dependencies.
 */

export const MAX_ATTEMPTS = 3;
export const CLAIM_HEARTBEAT_MS = 20_000;

export interface QueuedEvent {
	id: string;
	method: string;
	path: string;
}

export interface ForwardResult {
	status: number;
	headers: Record<string, string>;
	body: string;
	latencyMs: number;
}

/** What happened when the tab tried to reach the local server. */
export type ForwardOutcome =
	| { kind: "response"; result: ForwardResult }
	| { kind: "down"; message: string }
	| { kind: "cors"; message: string }
	| { kind: "failed"; message: string; latencyMs: number };

export type LocalhostState = "ok" | "down" | "cors";

export interface DrainDeps<E extends QueuedEvent> {
	fetchPending(after: string | null): Promise<{ events: E[]; nextCursor: string | null }>;
	/** True when this executor holds the claim (new or refreshed). */
	claim(eventId: string): Promise<boolean>;
	forward(event: E): Promise<ForwardOutcome>;
	report(event: E, result: ForwardResult): Promise<void>;
	onDelivered?(event: E, result: ForwardResult): void;
	onSkipped?(event: E, message: string): void;
	onLocalhost?(state: LocalhostState, message?: string): void;
	setTimer?(fn: () => void, ms: number): unknown;
	clearTimer?(handle: unknown): void;
}

type StepResult = "done" | "skipped" | "retry";

export class QueueDrainer<E extends QueuedEvent> {
	private running = false;
	private again = false;
	private stopped = false;
	private handled = new Set<string>();
	private attempts = new Map<string, number>();
	private localhost: LocalhostState = "ok";

	constructor(private readonly deps: DrainDeps<E>) {}

	stop(): void {
		this.stopped = true;
	}

	get localhostState(): LocalhostState {
		return this.localhost;
	}

	/**
	 * Run a drain pass now, or once more after the current one finishes.
	 * Resolves to false when the pass stopped on a local-server problem (the
	 * caller should retry sooner), true otherwise.
	 */
	async wake(): Promise<boolean> {
		if (this.stopped) return true;
		if (this.running) {
			this.again = true;
			return true;
		}
		this.running = true;
		let ok = true;
		try {
			do {
				this.again = false;
				ok = await this.pass();
			} while (this.again && ok && !this.stopped);
		} finally {
			this.running = false;
		}
		return ok;
	}

	private async pass(): Promise<boolean> {
		let after: string | null = null;
		do {
			if (this.stopped) return true;
			const page = await this.deps.fetchPending(after);
			for (const evt of page.events) {
				if (this.stopped) return true;
				if ((await this.step(evt)) === "retry") return false;
			}
			after = page.nextCursor;
		} while (after);
		this.setLocalhost("ok");
		return true;
	}

	private async step(evt: E): Promise<StepResult> {
		if (this.handled.has(evt.id)) return "skipped";
		// Not marked handled when another executor holds it: if that claim
		// goes stale, a later pass takes it over.
		if (!(await this.deps.claim(evt.id))) return "skipped";

		const setTimer = this.deps.setTimer ?? ((fn, ms) => setInterval(fn, ms));
		const clearTimer =
			this.deps.clearTimer ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));
		const heartbeat = setTimer(() => {
			this.deps.claim(evt.id).catch(() => {});
		}, CLAIM_HEARTBEAT_MS);
		let outcome: ForwardOutcome;
		try {
			outcome = await this.deps.forward(evt);
		} finally {
			clearTimer(heartbeat);
		}

		switch (outcome.kind) {
			case "response": {
				this.handled.add(evt.id);
				this.attempts.delete(evt.id);
				this.setLocalhost("ok");
				await this.deps.report(evt, outcome.result).catch(() => {});
				this.deps.onDelivered?.(evt, outcome.result);
				return "done";
			}
			case "down":
				this.setLocalhost("down", outcome.message);
				return "retry";
			case "cors":
				this.setLocalhost("cors", outcome.message);
				return "retry";
			case "failed": {
				const tries = (this.attempts.get(evt.id) ?? 0) + 1;
				if (tries < MAX_ATTEMPTS) {
					this.attempts.set(evt.id, tries);
					return "retry";
				}
				// The server is up but this event fails every time: record it
				// and move on rather than block every newer webhook behind it.
				this.attempts.delete(evt.id);
				this.handled.add(evt.id);
				const message = `Forwarding failed ${MAX_ATTEMPTS} times while your local server was up. Last error: ${outcome.message}`;
				await this.deps
					.report(evt, {
						status: 0,
						headers: {},
						body: `BridgeHook: ${message}`,
						latencyMs: outcome.latencyMs,
					})
					.catch(() => {});
				this.deps.onSkipped?.(evt, message);
				return "done";
			}
		}
	}

	private setLocalhost(state: LocalhostState, message?: string): void {
		if (state === this.localhost && state === "ok") return;
		this.localhost = state;
		this.deps.onLocalhost?.(state, message);
	}
}
