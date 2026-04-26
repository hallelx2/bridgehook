/**
 * Client-side signature verification for popular webhook providers.
 *
 * All crypto runs via SubtleCrypto — no deps. The user pastes their signing
 * secret once, we store it in localStorage, and every incoming event that
 * matches a known header pattern gets a green/red validity badge.
 */

export type ProviderId = "stripe" | "github" | "shopify" | "slack" | "unknown";

export interface SignatureInfo {
	provider: ProviderId;
	signatureHeader: string | null; // header name, e.g. "stripe-signature"
	signatureValue: string | null; // raw header value
}

/**
 * Identify the webhook provider by looking at the request headers.
 * Returns "unknown" if no known signature header is present.
 */
export function detectProvider(headers: Record<string, string>): SignatureInfo {
	const lower: Record<string, string> = {};
	for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;

	if (lower["stripe-signature"]) {
		return {
			provider: "stripe",
			signatureHeader: "stripe-signature",
			signatureValue: lower["stripe-signature"],
		};
	}
	if (lower["x-hub-signature-256"]) {
		return {
			provider: "github",
			signatureHeader: "x-hub-signature-256",
			signatureValue: lower["x-hub-signature-256"],
		};
	}
	if (lower["x-shopify-hmac-sha256"]) {
		return {
			provider: "shopify",
			signatureHeader: "x-shopify-hmac-sha256",
			signatureValue: lower["x-shopify-hmac-sha256"],
		};
	}
	if (lower["x-slack-signature"]) {
		return {
			provider: "slack",
			signatureHeader: "x-slack-signature",
			signatureValue: lower["x-slack-signature"],
		};
	}
	return { provider: "unknown", signatureHeader: null, signatureValue: null };
}

async function hmacSha256(secret: string, payload: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
	return Array.from(new Uint8Array(sig))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) {
		diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return diff === 0;
}

/** Verify a Stripe signature: `t=<timestamp>,v1=<signature>` over `${t}.${body}`. */
async function verifyStripe(body: string, header: string, secret: string): Promise<boolean> {
	const parts = Object.fromEntries(
		header.split(",").map((p) => {
			const [k, ...rest] = p.split("=");
			return [k.trim(), rest.join("=").trim()];
		}),
	);
	const t = parts.t;
	const v1 = parts.v1;
	if (!t || !v1) return false;
	const expected = await hmacSha256(secret, `${t}.${body}`);
	return timingSafeEqual(expected, v1);
}

/** Verify a GitHub signature: `sha256=<hex>` over the raw body. */
async function verifyGithub(body: string, header: string, secret: string): Promise<boolean> {
	if (!header.startsWith("sha256=")) return false;
	const sig = header.slice(7);
	const expected = await hmacSha256(secret, body);
	return timingSafeEqual(expected, sig);
}

/** Verify a Shopify signature: base64 HMAC-SHA256 over the raw body. */
async function verifyShopify(body: string, header: string, secret: string): Promise<boolean> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
	const expected = btoa(String.fromCharCode(...new Uint8Array(sig)));
	return timingSafeEqual(expected, header.trim());
}

/**
 * Verify a signature given a provider + raw body + secret.
 * Returns:
 *  - true / false for known providers with the expected headers
 *  - null when the provider isn't supported or a required piece is missing
 */
export async function verifySignature(
	info: SignatureInfo,
	body: string | null,
	secret: string | null,
): Promise<boolean | null> {
	if (!secret || !info.signatureValue || body === null) return null;
	try {
		switch (info.provider) {
			case "stripe":
				return await verifyStripe(body, info.signatureValue, secret);
			case "github":
				return await verifyGithub(body, info.signatureValue, secret);
			case "shopify":
				return await verifyShopify(body, info.signatureValue, secret);
			default:
				return null;
		}
	} catch {
		return null;
	}
}

export function providerDisplayName(provider: ProviderId): string {
	return {
		stripe: "Stripe",
		github: "GitHub",
		shopify: "Shopify",
		slack: "Slack",
		unknown: "Unknown",
	}[provider];
}
