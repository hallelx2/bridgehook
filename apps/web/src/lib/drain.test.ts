import { describe, expect, it } from "vitest";
import {
	type DrainDeps,
	type ForwardOutcome,
	MAX_ATTEMPTS,
	QueueDrainer,
	type QueuedEvent,
} from "./drain";

type Ev = QueuedEvent & { n: number };
const ev = (n: number): Ev => ({ id: `e${n}`, method: "POST", path: `/n/${n}`, n });
const ok = (n = 200): ForwardOutcome => ({
	kind: "response",
	result: { status: n, headers: {}, body: "ok", latencyMs: 1 },
});

/** In-memory relay: pending queue in arrival order, claims, reports. */
function fakeRelay(count: number, pageSize = 10) {
	const pending = Array.from({ length: count }, (_, i) => ev(i));
	const reported: { id: string; status: number }[] = [];
	const claimedBy = new Map<string, string>();
	return {
		pending,
		reported,
		claimedBy,
		deps(
			forward: (e: Ev) => Promise<ForwardOutcome>,
			me = "tab",
		): DrainDeps<Ev> & { log: string[] } {
			const log: string[] = [];
			return {
				log,
				// Keyset cursor (the relay pages by received_at, id): the cursor is
				// the last id returned; the next page starts after it.
				async fetchPending(after) {
					const from = after ? pending.findIndex((e) => e.id === after) + 1 : 0;
					const live = pending.slice(from).filter((e) => !reported.some((r) => r.id === e.id));
					const page = live.slice(0, pageSize);
					const next = live.length > pageSize ? page[page.length - 1].id : null;
					return { events: page, nextCursor: next };
				},
				async claim(id) {
					const holder = claimedBy.get(id);
					if (!holder || holder === me) {
						claimedBy.set(id, me);
						return true;
					}
					return false;
				},
				forward,
				async report(e, r) {
					reported.push({ id: e.id, status: r.status });
				},
				onLocalhost: (s) => log.push(`localhost:${s}`),
				setTimer: () => 0,
				clearTimer: () => {},
			};
		},
	};
}

describe("QueueDrainer", () => {
	it("drains a multi-page backlog in arrival order, exactly once", async () => {
		const relay = fakeRelay(35, 10);
		const seen: number[] = [];
		const d = new QueueDrainer(
			relay.deps(async (e) => {
				seen.push(e.n);
				return ok();
			}),
		);
		expect(await d.wake()).toBe("idle");
		expect(seen).toEqual(Array.from({ length: 35 }, (_, i) => i));
		expect(relay.reported).toHaveLength(35);
	});

	it("stops at the first event when localhost is down and resumes in order", async () => {
		const relay = fakeRelay(5);
		let up = false;
		const seen: number[] = [];
		const deps = relay.deps(async (e) => {
			if (!up) return { kind: "down", message: "refused" };
			seen.push(e.n);
			return ok();
		});
		const d = new QueueDrainer(deps);
		expect(await d.wake()).toBe("retry");
		expect(relay.reported).toHaveLength(0);
		expect(d.localhostState).toBe("down");
		up = true;
		expect(await d.wake()).toBe("idle");
		expect(seen).toEqual([0, 1, 2, 3, 4]);
		expect(deps.log).toEqual(["localhost:down", "localhost:ok"]);
	});

	it("outages never count against an event's attempts", async () => {
		const relay = fakeRelay(1);
		let calls = 0;
		const d = new QueueDrainer(
			relay.deps(async () => (++calls <= 10 ? { kind: "down", message: "x" } : ok())),
		);
		for (let i = 0; i < 10; i++) await d.wake();
		expect(relay.reported).toHaveLength(0);
		await d.wake();
		expect(relay.reported).toEqual([{ id: "e0", status: 200 }]);
	});

	it("CORS-blocked keeps the event queued and reports the state", async () => {
		const relay = fakeRelay(2);
		const deps = relay.deps(async () => ({ kind: "cors", message: "no CORS" }));
		const d = new QueueDrainer(deps);
		expect(await d.wake()).toBe("retry");
		expect(relay.reported).toHaveLength(0);
		expect(d.localhostState).toBe("cors");
	});

	it(`skips a poison event after ${MAX_ATTEMPTS} failures and delivers the rest in order`, async () => {
		const relay = fakeRelay(3);
		const seen: number[] = [];
		let poisonTries = 0;
		const d = new QueueDrainer(
			relay.deps(async (e) => {
				if (e.n === 0) {
					poisonTries++;
					return { kind: "failed", message: "socket hang up", latencyMs: 2 };
				}
				seen.push(e.n);
				return ok();
			}),
		);
		for (let i = 0; i < MAX_ATTEMPTS; i++) await d.wake();
		expect(poisonTries).toBe(MAX_ATTEMPTS);
		expect(relay.reported[0]).toEqual({ id: "e0", status: 0 });
		expect(seen).toEqual([1, 2]);
	});

	it("stops at an event another executor holds, so nothing overtakes it", async () => {
		const relay = fakeRelay(2);
		relay.claimedBy.set("e0", "extension");
		const seen: number[] = [];
		const deps = relay.deps(async (e) => {
			seen.push(e.n);
			return ok();
		});
		const d = new QueueDrainer(deps);
		expect(await d.wake()).toBe("blocked");
		expect(seen).toEqual([]);
		relay.claimedBy.delete("e0");
		expect(await d.wake()).toBe("idle");
		expect(seen).toEqual([0, 1]);
	});

	it("while localhost is down it probes instead of claiming, leaving the queue to others", async () => {
		const relay = fakeRelay(1);
		let up = false;
		let claims = 0;
		const deps = relay.deps(async () => (up ? ok() : { kind: "down", message: "refused" }));
		const claim = deps.claim.bind(deps);
		deps.claim = async (id) => {
			claims++;
			return claim(id);
		};
		deps.probe = async () => (up ? { state: "ok" } : { state: "down", message: "refused" });
		const d = new QueueDrainer(deps);
		await d.wake();
		expect(claims).toBe(1);
		for (let i = 0; i < 5; i++) await d.wake();
		expect(claims).toBe(1);
		up = true;
		expect(await d.wake()).toBe("idle");
		expect(relay.reported).toEqual([{ id: "e0", status: 200 }]);
	});

	it("a probe that finds CORS blocked reports it without claiming", async () => {
		const relay = fakeRelay(1);
		const deps = relay.deps(async () => ({ kind: "cors", message: "no CORS" }));
		const d = new QueueDrainer(deps);
		await d.wake();
		relay.claimedBy.clear();
		deps.probe = async () => ({ state: "cors", message: "no CORS" });
		expect(await d.wake()).toBe("retry");
		expect(relay.claimedBy.size).toBe(0);
	});

	it("a report the relay rejects is re-sent, never the webhook", async () => {
		const relay = fakeRelay(2);
		let forwards = 0;
		let relayUp = false;
		const deps = relay.deps(async () => {
			forwards++;
			return ok();
		});
		const report = deps.report.bind(deps);
		deps.report = async (e, r) => {
			if (!relayUp) throw new Error("503");
			return report(e, r);
		};
		const d = new QueueDrainer(deps);
		expect(await d.wake()).toBe("retry");
		expect(forwards).toBe(1);
		expect(relay.reported).toHaveLength(0);
		relayUp = true;
		expect(await d.wake()).toBe("idle");
		expect(forwards).toBe(2);
		expect(relay.reported.map((r) => r.id)).toEqual(["e0", "e1"]);
	});

	it("a timed-out handler is recorded once, not sent again", async () => {
		const relay = fakeRelay(1);
		let forwards = 0;
		const skipped: string[] = [];
		const deps = relay.deps(async () => {
			forwards++;
			return { kind: "timeout", message: "no answer in 5 minutes", latencyMs: 300000 };
		});
		deps.onSkipped = (_e, m) => skipped.push(m);
		const d = new QueueDrainer(deps);
		expect(await d.wake()).toBe("idle");
		expect(forwards).toBe(1);
		expect(relay.reported).toEqual([{ id: "e0", status: 0 }]);
		expect(skipped[0]).toMatch(/5 minutes/);
	});

	it("a claim lost mid-forward is not reported over the new holder", async () => {
		const relay = fakeRelay(1);
		let beat: (() => void) | null = null;
		const deps = relay.deps(async () => {
			relay.claimedBy.set("e0", "extension");
			beat?.();
			await new Promise((r) => setTimeout(r, 0));
			return ok();
		});
		deps.setTimer = (fn) => {
			beat = fn;
			return 1;
		};
		const d = new QueueDrainer(deps);
		expect(await d.wake()).toBe("idle");
		expect(relay.reported).toHaveLength(0);
	});

	it("a pass blocked by another executor does not clear a down state", async () => {
		const relay = fakeRelay(1);
		const deps = relay.deps(async () => ({ kind: "down", message: "refused" }));
		const d = new QueueDrainer(deps);
		await d.wake();
		relay.claimedBy.set("e0", "extension");
		deps.probe = async () => ({ state: "ok" });
		expect(await d.wake()).toBe("blocked");
		expect(d.localhostState).toBe("down");
	});

	it("a wake during a pass schedules exactly one more pass", async () => {
		const relay = fakeRelay(1);
		let passes = 0;
		const deps = relay.deps(async () => ok());
		const orig = deps.fetchPending.bind(deps);
		deps.fetchPending = async (a) => {
			passes++;
			return orig(a);
		};
		const d = new QueueDrainer(deps);
		const first = d.wake();
		d.wake();
		d.wake();
		await first;
		expect(passes).toBe(2);
	});
});
