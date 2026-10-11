import { describe, expect, it } from "vitest";
import { RateLimiterDO } from "./rate-limiter-do.js";

// DurableObjectState stand-in: the storage calls the DO uses, plus a clock.
function harness(startMs = 1_000_000) {
	let now = startMs;
	const data = new Map<string, unknown>();
	let alarm: number | null = null;
	const state = {
		storage: {
			get: async (k: string) => data.get(k),
			put: async (k: string, v: unknown) => {
				data.set(k, v);
			},
			deleteAll: async () => {
				data.clear();
			},
			setAlarm: async (t: number) => {
				alarm = t;
			},
			getAlarm: async () => alarm,
		},
	};
	const limiter = new RateLimiterDO(state as unknown as DurableObjectState, {}, () => now);
	const hit = async (limit: number, period: number) => {
		const res = await limiter.fetch(
			new Request(`https://rate-limiter/hit?limit=${limit}&period=${period}`, { method: "POST" }),
		);
		return (await res.json()) as { success: boolean; remaining: number; resetAt: number };
	};
	return {
		hit,
		advance: (ms: number) => {
			now += ms;
		},
		alarmAt: () => alarm,
		fireAlarm: () => limiter.alarm(),
		stored: () => data.size,
	};
}

describe("RateLimiterDO", () => {
	it("allows the limit within a window, then refuses", async () => {
		const h = harness();
		const results = [];
		for (let i = 0; i < 5; i++) results.push((await h.hit(3, 60)).success);
		expect(results).toEqual([true, true, true, false, false]);
	});

	it("reports what is left and when the window resets", async () => {
		const h = harness(1_000_000);
		expect(await h.hit(3, 60)).toEqual({ success: true, remaining: 2, resetAt: 1_060_000 });
		expect(await h.hit(3, 60)).toEqual({ success: true, remaining: 1, resetAt: 1_060_000 });
	});

	it("starts a fresh window once the period has passed", async () => {
		const h = harness();
		for (let i = 0; i < 4; i++) await h.hit(3, 60);
		expect((await h.hit(3, 60)).success).toBe(false);
		h.advance(60_000);
		expect((await h.hit(3, 60)).success).toBe(true);
	});

	it("keeps refusing for the rest of the window however many calls arrive", async () => {
		const h = harness();
		for (let i = 0; i < 3; i++) await h.hit(3, 60);
		for (let i = 0; i < 50; i++) expect((await h.hit(3, 60)).success).toBe(false);
		h.advance(59_000);
		expect((await h.hit(3, 60)).success).toBe(false);
	});

	it("schedules cleanup after the window and clears state when it fires", async () => {
		const h = harness(1_000_000);
		await h.hit(3, 60);
		expect(h.alarmAt()).toBe(1_061_000);
		expect(h.stored()).toBe(1);
		h.advance(61_000);
		await h.fireAlarm();
		expect(h.stored()).toBe(0);
	});

	it("does not clear a window that is still running when an old alarm fires", async () => {
		const h = harness(1_000_000);
		await h.hit(3, 60);
		h.advance(61_000);
		await h.hit(3, 60); // a new window starts at 1_061_000
		await h.fireAlarm();
		expect(h.stored()).toBe(1);
	});

	it("rejects malformed requests", async () => {
		const h = harness();
		const limiter = new RateLimiterDO(
			{ storage: {} } as unknown as DurableObjectState,
			{},
			() => 0,
		);
		void h;
		const bad = await limiter.fetch(
			new Request("https://rate-limiter/hit?limit=abc&period=60", { method: "POST" }),
		);
		expect(bad.status).toBe(400);
	});
});
