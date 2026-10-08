import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	TEST_PROVIDERS,
	buildTestEvent,
	githubSignature,
	standardWebhooksSignature,
	stripeSignature,
} from "./test-events.js";

describe("provider signatures match the providers' reference algorithms", () => {
	const body = '{"hello":"world"}';

	it("Stripe v1", async () => {
		const expect1 = createHmac("sha256", "whsec_test").update(`1700000000.${body}`).digest("hex");
		expect(await stripeSignature("whsec_test", body, 1700000000)).toBe(
			`t=1700000000,v1=${expect1}`,
		);
	});

	it("GitHub sha256", async () => {
		const ref = createHmac("sha256", "s3cret").update(body).digest("hex");
		expect(await githubSignature("s3cret", body)).toBe(`sha256=${ref}`);
	});

	it("Standard Webhooks (OpenAI) with a whsec_ base64 key", async () => {
		const keyB64 = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
		const ref = createHmac("sha256", Buffer.from(keyB64, "base64"))
			.update(`wh_1.1700000000.${body}`)
			.digest("base64");
		expect(await standardWebhooksSignature(`whsec_${keyB64}`, "wh_1", 1700000000, body)).toBe(
			`v1,${ref}`,
		);
	});
});

describe("buildTestEvent", () => {
	it("builds valid JSON for every provider", async () => {
		for (const p of TEST_PROVIDERS) {
			const e = await buildTestEvent(p);
			expect(() => JSON.parse(e.body)).not.toThrow();
			expect(e.headers["content-type"]).toBe("application/json");
			expect(e.signed).toBe(false);
		}
	});

	it("signs Stripe when given a secret, verifiable with the reference HMAC", async () => {
		const e = await buildTestEvent("stripe", { secret: "whsec_abc", now: 1_700_000_000_000 });
		const [t, v1] = e.headers["stripe-signature"].split(",").map((x) => x.split("=")[1]);
		expect(t).toBe("1700000000");
		expect(v1).toBe(createHmac("sha256", "whsec_abc").update(`${t}.${e.body}`).digest("hex"));
		expect(e.signed).toBe(true);
	});

	it("OpenAI carries Standard Webhooks headers", async () => {
		const keyB64 = Buffer.from("k".repeat(32)).toString("base64");
		const e = await buildTestEvent("openai", {
			type: "batch.completed",
			secret: `whsec_${keyB64}`,
		});
		expect(e.headers["webhook-id"]).toMatch(/^wh_/);
		expect(e.headers["webhook-signature"]).toMatch(/^v1,/);
		expect(JSON.parse(e.body).type).toBe("batch.completed");
	});

	it("signs ElevenLabs like the SDK's constructEvent verifies (t=…,v0=hex HMAC of t.body)", async () => {
		const e = await buildTestEvent("elevenlabs", { secret: "wsec_el", now: 1_700_000_000_000 });
		const parts = Object.fromEntries(
			e.headers["elevenlabs-signature"].split(",").map((p) => p.split("=")),
		);
		expect(parts.t).toBe("1700000000");
		expect(parts.v0).toBe(
			createHmac("sha256", "wsec_el").update(`${parts.t}.${e.body}`).digest("hex"),
		);
	});

	it("Vapi tool-calls carries a toolCallId and says what it expects back", async () => {
		const e = await buildTestEvent("vapi");
		const id = JSON.parse(e.body).message.toolCallList[0].id;
		expect(e.description).toContain(id);
	});
});
