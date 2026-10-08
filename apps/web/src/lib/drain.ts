/**
 * Ordered delivery for the no-install executor (a dashboard tab).
 *
 * The extension's bridge loop, made strict enough for an executor that can
 * vanish at any moment (a tab):
 *   • drain the channel's queue (`?pending=1`) oldest first, page by page,
 *     so webhooks that arrived while no executor ran go out in order
 *   • claim each event before forwarding and refresh the claim while the
 *     local handler works, so exactly one executor forwards it; a claim held
 *     elsewhere stops the pass there (order beats throughput) until that
 *     executor answers or its claim goes stale
 *   • while the local server is down or blocks CORS, probe it before
 *     claiming, so a tab that cannot deliver never holds the queue against
 *     an executor that can (the extension needs no CORS)
 *   • local server down or no CORS → stop at that event and retry later;
 *     outages never count against the event
 *   • local server up but this event keeps failing → after MAX_ATTEMPTS
 *     record status 0 and move on, so one payload cannot block the queue; a
 *     handler that times out is recorded at once (it may still be running)
 *   • a delivered answer is reported until the relay accepts it, never by
 *     calling the handler again
 *
 * Framework-free so it can be unit-tested with fake dependencies.
 */

export const MAX_ATTEMPTS = 3;
export const CLAIM_HEARTBEAT_MS = 20_000;
/** Report attempts per pass before the drain stops and retries later. */
export const REPORT_ATTEMPTS = 3;

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
	| { kind: "failed"; message: string; latencyMs: number }
	| { kind: "timeout"; message: string; latencyMs: number };

export type LocalhostState = "ok" | "down" | "cors";

/**
 * How a pass ended. `idle`: nothing left for this executor. `retry`: stopped
 * on a local-server or relay problem, try again soon. `blocked`: another
 * executor holds the oldest event, look again once its claim could be stale.
 */
export type PassResult = "idle" | "retry" | "blocked";

export interface DrainDeps<E extends QueuedEvent> {
	fetchPending(after: string | null): Promise<{ events: E[]; nextCursor: string | null }>;
	/** True when this executor holds the claim (new or refreshed). */
	claim(eventId: string): Promise<boolean>;
	/**
	 * Can this executor deliver right now, without sending the event? Checked
	 * before claiming while the server is down/blocking or after a failure.
	 */
	probe?(event: E): Promise<{ state: LocalhostState; message?: string }>;
	forward(event: E): Promise<ForwardOutcome>;
	/** Store the answer on the relay; rejects when the relay did not accept it. */
	report(event: E, result: ForwardResult): Promise<void>;
	onDelivered?(event: E, result: ForwardResult): void;
	onSkipped?(event: E, message: string): void;
	onLocalhost?(state: LocalhostState, message?: string): void;
	setTimer?(fn: () => void, ms: number): unknown;
	clearTimer?(handle: unknown): void;
	sleep?(ms: number): Promise<void>;
}

type StepResult = "next" | "retry" | "blocked";

/** An answer that reached this tab but not yet the relay. */
interface Unreported {
	result: ForwardResult;
	/** Set when the answer records a skipped event (status 0). */
	skipped?: string;
}

export class QueueDrainer<E extends QueuedEvent> {
	private running = false;
	private again = false;
	private stopped = false;
	private handled = new Set<string>();
	private attempts = new Map<string, number>();
	private unreported = new Map<string, Unreported>();
	private localhost: LocalhostState = "ok";

	constructor(private readonly deps: DrainDeps<E>) {}

	/** No new work starts; a forward already under way still reports. */
	stop(): void {
		this.stopped = true;
	}

	get localhostState(): LocalhostState {
		return this.localhost;
	}

	/** Run a drain pass now, or once more after the current one finishes. */
	async wake(): Promise<PassResult> {
		if (this.stopped) return "idle";
		if (this.running) {
			this.again = true;
			return "idle";
		}
		this.running = true;
		let result: PassResult = "idle";
		try {
			do {
				this.again = false;
				result = await this.pass();
			} while (this.again && result === "idle" && !this.stopped);
		} finally {
			this.running = false;
		}
		return result;
	}

	private async pass(): Promise<PassResult> {
		let after: string | null = null;
		let open = 0;
		do {
			if (this.stopped) return "idle";
			const page = await this.deps.fetchPending(after);
			for (const evt of page.events) {
				if (this.stopped) return "idle";
				if (!this.handled.has(evt.id)) open++;
				const r = await this.step(evt);
				if (r !== "next") return r;
			}
			after = page.nextCursor;
		} while (after);
		// Nothing was waiting: whatever the server's last state, no webhook is
		// held up by it.
		if (open === 0) this.setLocalhost("ok");
		return "idle";
	}

	private async step(evt: E): Promise<StepResult> {
		if (this.handled.has(evt.id)) return "next";

		// Answered earlier but the relay never took the report: send that
		// answer again, never the webhook.
		const owed = this.unreported.get(evt.id);
		if (owed) return (await this.settle(evt, owed)) ? "next" : "retry";

		if (this.deps.probe && (this.localhost !== "ok" || this.attempts.has(evt.id))) {
			const probe = await this.deps.probe(evt);
			if (probe.state !== "ok") {
				this.setLocalhost(probe.state, probe.message);
				return "retry";
			}
		}

		// Another executor holds it: stop here so nothing newer overtakes it.
		if (!(await this.deps.claim(evt.id))) return "blocked";

		let lost = false;
		const setTimer = this.deps.setTimer ?? ((fn, ms) => setInterval(fn, ms));
		const clearTimer =
			this.deps.clearTimer ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));
		const heartbeat = setTimer(() => {
			this.deps
				.claim(evt.id)
				.then((held) => {
					if (!held) lost = true;
				})
				.catch(() => {});
		}, CLAIM_HEARTBEAT_MS);
		let outcome: ForwardOutcome;
		try {
			outcome = await this.deps.forward(evt);
		} finally {
			clearTimer(heartbeat);
		}

		if (lost) {
			// The claim went stale and another executor took the event; its
			// answer is the one the relay keeps.
			this.handled.add(evt.id);
			this.attempts.delete(evt.id);
			return "next";
		}

		switch (outcome.kind) {
			case "response":
				this.attempts.delete(evt.id);
				this.setLocalhost("ok");
				return (await this.settle(evt, { result: outcome.result })) ? "next" : "retry";
			case "down":
				this.setLocalhost("down", outcome.message);
				return "retry";
			case "cors":
				this.setLocalhost("cors", outcome.message);
				return "retry";
			case "timeout":
				// The handler may still be running (a breakpoint): sending it
				// again would run it twice. Record the timeout instead.
				this.attempts.delete(evt.id);
				return (await this.settle(evt, terminal(outcome.message, outcome.latencyMs)))
					? "next"
					: "retry";
			case "failed": {
				const tries = (this.attempts.get(evt.id) ?? 0) + 1;
				if (tries < MAX_ATTEMPTS) {
					this.attempts.set(evt.id, tries);
					return "retry";
				}
				// The server is up but this event fails every time: record it
				// and move on rather than block every newer webhook behind it.
				this.attempts.delete(evt.id);
				const message = `Forwarding failed ${MAX_ATTEMPTS} times while your local server was up. Last error: ${outcome.message}`;
				return (await this.settle(evt, terminal(message, outcome.latencyMs))) ? "next" : "retry";
			}
		}
	}

	/** Report an answer; on success the event is done, otherwise it is owed. */
	private async settle(evt: E, answer: Unreported): Promise<boolean> {
		const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
		for (let i = 0; i < REPORT_ATTEMPTS; i++) {
			try {
				await this.deps.report(evt, answer.result);
				this.unreported.delete(evt.id);
				this.handled.add(evt.id);
				if (answer.skipped) this.deps.onSkipped?.(evt, answer.skipped);
				else this.deps.onDelivered?.(evt, answer.result);
				return true;
			} catch {
				if (i < REPORT_ATTEMPTS - 1) await sleep(500 * 3 ** i);
			}
		}
		this.unreported.set(evt.id, answer);
		return false;
	}

	private setLocalhost(state: LocalhostState, message?: string): void {
		if (state === this.localhost && state === "ok") return;
		this.localhost = state;
		this.deps.onLocalhost?.(state, message);
	}
}

function terminal(message: string, latencyMs: number): Unreported {
	return {
		result: { status: 0, headers: {}, body: `BridgeHook: ${message}`, latencyMs },
		skipped: message,
	};
}
