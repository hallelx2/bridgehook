import { describe, expect, it, vi } from "vitest";
import {
	SYNC_TIMEOUT_MAX_MS,
	SYNC_TIMEOUT_MIN_MS,
	SyncWaiters,
	clampSyncTimeout,
	senderHeaders,
	syncResponse,
} from "./sync.js";

const result = (status: number, body = "ok", headers: Record<string, string> = {}) => ({
	status,
	headers,
	body,
	latencyMs: 12,
});

describe("SyncWaiters", () => {
	it("resolves a waiter when its event is settled", async () => {
		const w = new SyncWaiters();
		const p = w.wait("e1", 5_000);
		w.settle("e1", result(200, "hi"));
		await expect(p).resolves.toEqual({ kind: "response", result: result(200, "hi") });
		expect(w.pending).toBe(0);
	});

	it("keeps a result that arrives before the waiter", async () => {
		const w = new SyncWaiters();
		w.settle("e2", result(201));
		await expect(w.wait("e2", 5_000)).resolves.toMatchObject({ kind: "response" });
	});

	it("times out and forgets the waiter", async () => {
		vi.useFakeTimers();
		const w = new SyncWaiters();
		const p = w.wait("e3", 1_000);
		vi.advanceTimersByTime(1_001);
		await expect(p).resolves.toEqual({ kind: "timeout" });
		expect(w.pending).toBe(0);
		vi.useRealTimers();
	});

	it("settles every waiter for the same event", async () => {
		const w = new SyncWaiters();
		const a = w.wait("e4", 5_000);
		const b = w.wait("e4", 5_000);
		w.settle("e4", result(200));
		await expect(Promise.all([a, b])).resolves.toHaveLength(2);
	});

	it("drops early results after their TTL", async () => {
		vi.useFakeTimers();
		let t = 0;
		const w = new SyncWaiters(100, () => t);
		w.settle("e5", result(200));
		t = 1_000;
		const p = w.wait("e5", 50);
		vi.advanceTimersByTime(60);
		await expect(p).resolves.toEqual({ kind: "timeout" });
		vi.useRealTimers();
	});
});

describe("clampSyncTimeout", () => {
	it("clamps into range and rejects non-numbers", () => {
		expect(clampSyncTimeout(5)).toBe(SYNC_TIMEOUT_MIN_MS);
		expect(clampSyncTimeout(10_000_000)).toBe(SYNC_TIMEOUT_MAX_MS);
		expect(clampSyncTimeout(30_000.4)).toBe(30_000);
		expect(clampSyncTimeout("30")).toBeNull();
		expect(clampSyncTimeout(Number.NaN)).toBeNull();
	});
});

describe("senderHeaders", () => {
	it("drops hop-by-hop and framing headers, keeps the rest", () => {
		const h = senderHeaders({
			"content-type": "application/json",
			"content-length": "99",
			"content-encoding": "gzip",
			connection: "keep-alive",
			"transfer-encoding": "chunked",
			"x-custom": "1",
		});
		expect([...h.keys()].sort()).toEqual(["content-type", "x-custom"]);
	});

	it("skips invalid header names instead of throwing", () => {
		expect(() => senderHeaders({ "bad header": "x", ok: "y" })).not.toThrow();
		expect(senderHeaders({ "bad header": "x", ok: "y" }).get("ok")).toBe("y");
	});
});

describe("syncResponse", () => {
	it("returns localhost's status, headers and body", async () => {
		const res = syncResponse(
			{
				kind: "response",
				result: result(201, '{"ok":true}', { "content-type": "application/json", "x-a": "1" }),
			},
			"evt1",
			"POST",
		);
		expect(res.status).toBe(201);
		expect(res.headers.get("x-a")).toBe("1");
		expect(res.headers.get("x-bridgehook-event-id")).toBe("evt1");
		expect(await res.text()).toBe('{"ok":true}');
	});

	it("echoes a verification challenge body unchanged", async () => {
		const res = syncResponse(
			{ kind: "response", result: result(200, "abc123", { "content-type": "text/plain" }) },
			"e",
			"GET",
		);
		expect(await res.text()).toBe("abc123");
	});

	it("504 on timeout, 502 when localhost could not be reached", async () => {
		expect(syncResponse({ kind: "timeout" }, "e", "POST").status).toBe(504);
		expect(
			syncResponse({ kind: "response", result: result(0, "refused") }, "e", "POST").status,
		).toBe(502);
	});

	it("sends no body for HEAD and 204", async () => {
		expect(
			await syncResponse({ kind: "response", result: result(200, "x") }, "e", "HEAD").text(),
		).toBe("");
		expect(
			await syncResponse({ kind: "response", result: result(204, "x") }, "e", "POST").text(),
		).toBe("");
	});
});
