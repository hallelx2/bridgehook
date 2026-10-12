import { describe, expect, it } from "vitest";
import { SseHub } from "./sse-hub.js";

const decoder = new TextDecoder();

/** A client that keeps reading its stream, collecting what arrives. */
function reader(res: Response) {
	const r = (res.body as ReadableStream<Uint8Array>).getReader();
	const got: string[] = [];
	let closed = false;
	const loop = (async () => {
		try {
			for (;;) {
				const { value, done } = await r.read();
				if (done) break;
				got.push(decoder.decode(value));
			}
		} catch {
			/* aborted */
		}
		closed = true;
	})();
	return {
		got,
		cancel: () => r.cancel(),
		closed: () => closed,
		loop,
	};
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

describe("SseHub", () => {
	it("sends connected, then broadcasts to every reading client", async () => {
		const hub = new SseHub({ maxConnections: 4, heartbeatMs: 0 });
		const a = reader(hub.open());
		const b = reader(hub.open());
		expect(await hub.broadcast('{"type":"webhook"}')).toBe(2);
		await tick();
		for (const c of [a, b]) {
			expect(c.got.join("")).toContain('"type":"connected"');
			expect(c.got.join("")).toContain('data: {"type":"webhook"}');
		}
	});

	it("forgets a client that cancelled its stream", async () => {
		const hub = new SseHub({ maxConnections: 4, heartbeatMs: 0 });
		const a = reader(hub.open());
		await tick();
		await a.cancel();
		await hub.broadcast("{}");
		await tick();
		expect(hub.size).toBe(0);
	});

	it("drops a client that stopped reading, without holding up the others", async () => {
		const hub = new SseHub({ maxConnections: 4, writeTimeoutMs: 50, heartbeatMs: 0 });
		hub.open(); // never read: its writes stay pending
		const live = reader(hub.open());
		const started = Date.now();
		const pushed = await hub.broadcast('{"n":1}');
		expect(Date.now() - started).toBeLessThan(1000);
		expect(pushed).toBe(1);
		expect(hub.size).toBe(1);
		await tick();
		expect(live.got.join("")).toContain('{"n":1}');
	});

	it("never refuses a new client at the cap: the oldest makes room", async () => {
		const hub = new SseHub({ maxConnections: 2, heartbeatMs: 0 });
		const first = reader(hub.open());
		reader(hub.open());
		const newest = reader(hub.open());
		expect(hub.size).toBe(2);
		await tick(10);
		expect(first.closed()).toBe(true);
		expect(await hub.broadcast('{"x":1}')).toBe(2);
		await tick();
		expect(newest.got.join("")).toContain('{"x":1}');
	});

	it("drops a client on abort", async () => {
		const hub = new SseHub({ maxConnections: 4, heartbeatMs: 0 });
		const ctl = new AbortController();
		reader(hub.open(ctl.signal));
		expect(hub.size).toBe(1);
		ctl.abort();
		expect(hub.size).toBe(0);
	});

	it("heartbeats find a dead client even when nothing is broadcast", async () => {
		const hub = new SseHub({ maxConnections: 4, writeTimeoutMs: 30, heartbeatMs: 20 });
		hub.open(); // never read
		const live = reader(hub.open());
		await tick(200);
		expect(hub.size).toBe(1);
		expect(live.got.join("")).toContain(": heartbeat");
		await live.cancel();
		await tick(100);
		expect(hub.size).toBe(0);
	});
});
