import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
	API_BODY_LIMIT,
	BILLING_WEBHOOK_BODY_LIMIT,
	MCP_BODY_LIMIT,
	SIGNED_BODY_LIMITS,
	apiBodyLimitFor,
	limitApiBodies,
	readBodyLimited,
} from "./body-limit.js";

const enc = new TextEncoder();

// A body stream that records how many chunks were pulled, so a test can prove
// an oversized body was rejected without being read to the end.
function trackedStream(chunks: Uint8Array[]) {
	const state = { pulled: 0 };
	// highWaterMark 0: the stream pulls only when someone reads, not eagerly
	// to fill its queue, so `pulled` counts real reads.
	const stream = new ReadableStream<Uint8Array>(
		{
			pull(controller) {
				if (state.pulled >= chunks.length) {
					controller.close();
					return;
				}
				controller.enqueue(chunks[state.pulled++]);
			},
		},
		{ highWaterMark: 0 },
	);
	return { stream, state };
}

function post(body: BodyInit | null, headers: Record<string, string> = {}) {
	return new Request("https://relay.example/x", {
		method: "POST",
		body,
		headers,
		// @ts-expect-error Node needs duplex for stream bodies
		duplex: "half",
	});
}

describe("readBodyLimited", () => {
	it("rejects on a declared content-length over the cap without reading", async () => {
		const { stream, state } = trackedStream([enc.encode("x".repeat(10))]);
		const res = await readBodyLimited(post(stream, { "content-length": "20000000" }), 4096);
		expect(res.ok).toBe(false);
		expect(state.pulled).toBe(0);
	});

	it("stops reading a chunked body as soon as it passes the cap", async () => {
		const chunk = enc.encode("y".repeat(1024));
		const { stream, state } = trackedStream(Array.from({ length: 100 }, () => chunk));
		const res = await readBodyLimited(post(stream), 4096);
		expect(res.ok).toBe(false);
		expect(state.pulled).toBeLessThanOrEqual(6);
	});

	it("returns the exact text under the cap, including UTF-8 split across chunks", async () => {
		const bytes = enc.encode('{"name":"Àdé ✓"}');
		const { stream } = trackedStream([bytes.slice(0, 11), bytes.slice(11)]);
		const res = await readBodyLimited(post(stream), 4096);
		expect(res).toEqual({ ok: true, text: '{"name":"Àdé ✓"}' });
	});

	it("accepts a body of exactly the cap and an empty body", async () => {
		const res = await readBodyLimited(post("z".repeat(4096)), 4096);
		expect(res.ok && res.text.length).toBe(4096);
		expect(await readBodyLimited(post(null), 4096)).toEqual({ ok: true, text: "" });
	});

	it("treats a malformed content-length as too large", async () => {
		const res = await readBodyLimited(post("abc", { "content-length": "lots" }), 4096);
		expect(res.ok).toBe(false);
	});
});

describe("apiBodyLimitFor", () => {
	it("caps each route family", () => {
		expect(apiBodyLimitFor("/api/channels")).toBe(API_BODY_LIMIT);
		expect(apiBodyLimitFor("/api/me/devices/self-register")).toBe(API_BODY_LIMIT);
		expect(apiBodyLimitFor("/auth/device/start")).toBe(API_BODY_LIMIT);
		expect(apiBodyLimitFor("/auth/sign-in/email")).toBe(API_BODY_LIMIT);
		expect(apiBodyLimitFor("/api/billing/webhook")).toBe(BILLING_WEBHOOK_BODY_LIMIT);
		expect(apiBodyLimitFor("/mcp")).toBe(MCP_BODY_LIMIT);
	});

	it("leaves routes that read their own bodies to their own caps", () => {
		expect(apiBodyLimitFor("/hook/abc123/claim")).toBeNull();
		expect(apiBodyLimitFor("/hook/abc123/response")).toBeNull();
		expect(apiBodyLimitFor("/abc123/stripe/webhook")).toBeNull();
	});

	it("fits a 1 MiB control-character body serialised as the executor sends it", async () => {
		// JSON.stringify writes NUL as \u0000 (6 bytes): the worst case for a
		// response body the relay accepts after parsing.
		const payload = JSON.stringify({
			eventId: "e".repeat(32),
			status: 200,
			headers: { "content-type": "application/octet-stream" },
			body: "\u0000".repeat(1_048_576),
			latencyMs: 12,
		});
		expect(payload.length).toBeGreaterThan(6_000_000);
		expect(payload.length).toBeLessThanOrEqual(SIGNED_BODY_LIMITS.response);
		const read = await readBodyLimited(post(payload), SIGNED_BODY_LIMITS.response);
		expect(read.ok).toBe(true);
		expect(MCP_BODY_LIMIT).toBeGreaterThanOrEqual(SIGNED_BODY_LIMITS.response);
	});

	it("sizes the signed-route caps around the payload they carry", () => {
		expect(SIGNED_BODY_LIMITS.empty).toBeLessThanOrEqual(1024);
		expect(SIGNED_BODY_LIMITS.claim).toBeLessThanOrEqual(4096);
		// A response carries a stored body of up to 1 MiB as a JSON string.
		expect(SIGNED_BODY_LIMITS.response).toBeGreaterThan(1_048_576);
	});
});

describe("limitApiBodies middleware", () => {
	const app = new Hono();
	app.use("*", limitApiBodies());
	app.post("/api/echo", async (c) => c.json({ got: await c.req.json() }));
	app.post("/hook/abc123/claim", async (c) => c.json({ len: (await c.req.text()).length }));

	it("returns 413 JSON for an oversized API body", async () => {
		const big = JSON.stringify({ pad: "p".repeat(API_BODY_LIMIT) });
		const res = await app.request("/api/echo", {
			method: "POST",
			body: big,
			headers: { "content-type": "application/json" },
		});
		expect(res.status).toBe(413);
		expect(await res.json()).toEqual({ error: "Body too large" });
	});

	it("passes a normal body through to the handler", async () => {
		const res = await app.request("/api/echo", {
			method: "POST",
			body: JSON.stringify({ a: 1 }),
			headers: { "content-type": "application/json" },
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ got: { a: 1 } });
	});

	it("does not cap routes that enforce their own limit", async () => {
		const res = await app.request("/hook/abc123/claim", {
			method: "POST",
			body: "q".repeat(API_BODY_LIMIT + 10),
		});
		expect(res.status).toBe(200);
	});
});
