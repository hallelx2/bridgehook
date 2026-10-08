/**
 * Realistic sample webhooks for `send_test_event`, so a coding agent can drive
 * a local handler end to end without a provider account. When the caller
 * passes the endpoint's signing secret, the request is signed exactly the way
 * the provider signs it, so the handler's signature verification is exercised
 * too.
 */

export const TEST_PROVIDERS = [
	"stripe",
	"github",
	"openai",
	"elevenlabs",
	"vapi",
	"generic",
] as const;
export type TestProvider = (typeof TEST_PROVIDERS)[number];

export interface TestEvent {
	method: "POST";
	headers: Record<string, string>;
	body: string;
	/** What was sent, for the agent's benefit. */
	description: string;
	signed: boolean;
}

const enc = new TextEncoder();

async function hmac(key: Uint8Array, data: string): Promise<Uint8Array> {
	// Copy into a plain ArrayBuffer-backed view, as WebCrypto's types require.
	const k = await crypto.subtle.importKey(
		"raw",
		new Uint8Array(key),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
}
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
function b64decode(s: string): Uint8Array {
	const bin = atob(s);
	return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
const rid = (prefix: string) => `${prefix}${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;

/** Stripe: `Stripe-Signature: t=<unix>,v1=HMAC_SHA256(secret, "<t>.<body>")`. */
export async function stripeSignature(secret: string, body: string, t: number): Promise<string> {
	return `t=${t},v1=${hex(await hmac(enc.encode(secret), `${t}.${body}`))}`;
}

/** GitHub: `X-Hub-Signature-256: sha256=HMAC_SHA256(secret, body)`. */
export async function githubSignature(secret: string, body: string): Promise<string> {
	return `sha256=${hex(await hmac(enc.encode(secret), body))}`;
}

/**
 * Standard Webhooks (OpenAI): `webhook-signature: v1,base64(HMAC_SHA256(key,
 * "<id>.<ts>.<body>"))` where key is the base64 part of `whsec_…`.
 */
export async function standardWebhooksSignature(
	secret: string,
	id: string,
	ts: number,
	body: string,
): Promise<string> {
	let key: Uint8Array;
	try {
		key = b64decode(secret.startsWith("whsec_") ? secret.slice(6) : secret);
	} catch {
		throw new Error("OpenAI signing secret must be a whsec_… key (base64 after the prefix)");
	}
	return `v1,${b64(await hmac(key, `${id}.${ts}.${body}`))}`;
}

export async function buildTestEvent(
	provider: TestProvider,
	opts: { type?: string; secret?: string; now?: number } = {},
): Promise<TestEvent> {
	const now = Math.floor((opts.now ?? Date.now()) / 1000);
	const json = { "content-type": "application/json", "user-agent": "BridgeHook-Test/1.0" };

	switch (provider) {
		case "stripe": {
			const type = opts.type ?? "checkout.session.completed";
			const body = JSON.stringify({
				id: rid("evt_test_"),
				object: "event",
				api_version: "2025-09-30.clover",
				created: now,
				type,
				livemode: false,
				data: {
					object: {
						id: rid("cs_test_"),
						object: "checkout.session",
						amount_total: 2000,
						currency: "usd",
						customer_email: "test@example.com",
						payment_status: "paid",
						status: "complete",
					},
				},
			});
			const headers: Record<string, string> = {
				...json,
				"user-agent": "Stripe/1.0 (+https://stripe.com/docs/webhooks)",
			};
			if (opts.secret) headers["stripe-signature"] = await stripeSignature(opts.secret, body, now);
			return {
				method: "POST",
				headers,
				body,
				description: `Stripe ${type}`,
				signed: !!opts.secret,
			};
		}
		case "github": {
			const type = opts.type ?? "push";
			const body = JSON.stringify({
				ref: "refs/heads/main",
				before: "0000000000000000000000000000000000000000",
				after: hex(crypto.getRandomValues(new Uint8Array(20))),
				repository: { id: 1, full_name: "octo-org/hello-world", private: false },
				pusher: { name: "octocat", email: "octocat@github.com" },
				commits: [
					{ id: "abc123", message: "Test commit from BridgeHook", author: { name: "octocat" } },
				],
			});
			const headers: Record<string, string> = {
				...json,
				"user-agent": "GitHub-Hookshot/bridgehook",
				"x-github-event": type,
				"x-github-delivery": crypto.randomUUID(),
			};
			if (opts.secret) headers["x-hub-signature-256"] = await githubSignature(opts.secret, body);
			return {
				method: "POST",
				headers,
				body,
				description: `GitHub ${type}`,
				signed: !!opts.secret,
			};
		}
		case "openai": {
			const type = opts.type ?? "response.completed";
			const id = rid("wh_");
			const body = JSON.stringify({
				id: rid("evt_"),
				object: "event",
				created_at: now,
				type,
				data: { id: type.startsWith("batch.") ? rid("batch_") : rid("resp_") },
			});
			const headers: Record<string, string> = {
				...json,
				"user-agent": "OpenAI/1.0 (+https://platform.openai.com/docs/webhooks)",
				"webhook-id": id,
				"webhook-timestamp": String(now),
			};
			if (opts.secret) {
				headers["webhook-signature"] = await standardWebhooksSignature(opts.secret, id, now, body);
			}
			return {
				method: "POST",
				headers,
				body,
				description: `OpenAI ${type} (Standard Webhooks)`,
				signed: !!opts.secret,
			};
		}
		case "elevenlabs": {
			const type = opts.type ?? "post_call_transcription";
			const body = JSON.stringify({
				type,
				event_timestamp: now,
				data: {
					agent_id: rid("agent_"),
					conversation_id: rid("conv_"),
					status: "done",
					transcript: [
						{ role: "agent", message: "Hi! How can I help you today?", time_in_call_secs: 0 },
						{
							role: "user",
							message: "I'd like to book a table for two tonight.",
							time_in_call_secs: 3,
						},
					],
					metadata: { call_duration_secs: 42 },
					analysis: {
						call_successful: "success",
						transcript_summary: "Caller booked a table for two.",
					},
				},
			});
			const headers: Record<string, string> = { ...json, "user-agent": "ElevenLabs/1.0" };
			if (opts.secret) {
				headers["elevenlabs-signature"] =
					`t=${now},v0=${hex(await hmac(enc.encode(opts.secret), `${now}.${body}`))}`;
			}
			return {
				method: "POST",
				headers,
				body,
				description: `ElevenLabs ${type}`,
				signed: !!opts.secret,
			};
		}
		case "vapi": {
			const toolCallId = rid("call_");
			const body = JSON.stringify({
				message: {
					type: opts.type ?? "tool-calls",
					timestamp: now * 1000,
					call: { id: rid("call-"), type: "webCall" },
					toolCallList: [
						{
							id: toolCallId,
							type: "function",
							function: { name: "get_weather", arguments: { city: "Lagos" } },
						},
					],
				},
			});
			const headers: Record<string, string> = { ...json, "user-agent": "Vapi/1.0" };
			if (opts.secret) headers["x-vapi-secret"] = opts.secret;
			return {
				method: "POST",
				headers,
				body,
				description: `Vapi ${opts.type ?? "tool-calls"} (expects {"results":[{"toolCallId":"${toolCallId}","result":…}]})`,
				signed: !!opts.secret,
			};
		}
		default: {
			const body = JSON.stringify({
				event: opts.type ?? "test.event",
				id: rid("evt_"),
				created: now,
			});
			return {
				method: "POST",
				headers: json,
				body,
				description: "Generic JSON test event",
				signed: false,
			};
		}
	}
}
