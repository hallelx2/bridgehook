import { describe, expect, it } from "vitest";
import { pollDeviceExchange } from "./pairing.js";

// A scripted relay: each poll takes the next response (or throws a network error).
function harness(script, { deadlineMs = 15 * 60_000 } = {}) {
	let clock = 0;
	const sleeps = [];
	const calls = [];
	const responses = [...script];
	return {
		sleeps,
		calls,
		run: () =>
			pollDeviceExchange({
				relayUrl: "https://relay.example",
				deviceCode: "DV-ABCD-EFGH",
				intervalMs: 5000,
				deadline: deadlineMs,
				now: () => clock,
				sleep: async (ms) => {
					sleeps.push(ms);
					clock += ms;
				},
				fetchImpl: async (url, init) => {
					calls.push({ url, body: JSON.parse(init.body) });
					const next = responses.shift() ?? { status: 202 };
					if (next === "network") throw new TypeError("Failed to fetch");
					return new Response(next.body ? JSON.stringify(next.body) : "", {
						status: next.status,
						headers: next.headers ?? {},
					});
				},
			}),
	};
}

const minted = {
	token: "dvc_x",
	deviceId: "dev_x",
	userId: "usr_x",
	label: "Chrome",
	kind: "extension",
};

describe("pollDeviceExchange", () => {
	it("polls every interval while pending and returns the minted device", async () => {
		const h = harness([{ status: 202 }, { status: 202 }, { status: 200, body: minted }]);
		expect(await h.run()).toEqual(minted);
		expect(h.sleeps).toEqual([5000, 5000, 5000]);
		expect(h.calls[0]).toEqual({
			url: "https://relay.example/auth/device/exchange",
			body: { code: "DV-ABCD-EFGH" },
		});
	});

	it("waits Retry-After on 429 and keeps polling instead of aborting", async () => {
		const h = harness([
			{ status: 429, headers: { "Retry-After": "30" } },
			{ status: 202 },
			{ status: 200, body: minted },
		]);
		expect(await h.run()).toEqual(minted);
		expect(h.sleeps).toEqual([5000, 30_000, 5000]);
	});

	it("backs off on server errors and network failures, then succeeds", async () => {
		const h = harness([{ status: 503 }, "network", { status: 500 }, { status: 200, body: minted }]);
		expect(await h.run()).toEqual(minted);
		expect(h.sleeps).toEqual([5000, 10_000, 20_000, 40_000]);
	});

	it("stops on 410 with a clear message", async () => {
		const h = harness([{ status: 202 }, { status: 410, body: { error: "Code expired" } }]);
		await expect(h.run()).rejects.toThrow("Pairing code expired or already used");
	});

	it("stops on other client errors with the relay's message", async () => {
		const h = harness([{ status: 402, body: { error: "Device quota reached" } }]);
		await expect(h.run()).rejects.toThrow(/Device exchange failed \(402\).*Device quota reached/);
	});

	it("times out at the deadline without sleeping past it", async () => {
		const h = harness([], { deadlineMs: 12_000 });
		await expect(h.run()).rejects.toThrow("Pairing timed out. Try again.");
		expect(h.sleeps.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(12_000);
	});
});
