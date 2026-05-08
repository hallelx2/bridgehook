/**
 * Polar billing — direct REST integration (no SDK).
 *
 * Why direct REST: cleaner Cloudflare Workers footprint, predictable
 * bundle size, no concerns about Node-only dependencies leaking through.
 * Polar's API is small enough that the wrappers below cover everything
 * we need. Auth is a single bearer header.
 *
 * All functions return null when POLAR_ACCESS_TOKEN is unset — that's
 * the self-host invariant. Callers should `if (polar) ...` and 503
 * /api/me/billing/* paths in self-host mode.
 *
 * Webhook signatures use the standardwebhooks.com format: signed value
 * is `${webhook-id}.${webhook-timestamp}.${rawBody}`, HMAC-SHA256 with
 * the webhook secret, base64-encoded, prefixed with `v1,`. Multiple
 * signatures may appear in the header separated by spaces.
 */

const POLAR_API = "https://api.polar.sh/v1";

export interface PolarEnv {
	POLAR_ACCESS_TOKEN?: string;
	POLAR_WEBHOOK_SECRET?: string;
	POLAR_PRODUCT_ID_HOBBY?: string;
	POLAR_PRODUCT_ID_PRO?: string;
	POLAR_PRODUCT_ID_TEAM?: string;
	WEB_URL?: string;
}

export interface PolarClient {
	token: string;
	productIds: { hobby?: string; pro?: string; team?: string };
}

export function createPolarClient(env: PolarEnv): PolarClient | null {
	if (!env.POLAR_ACCESS_TOKEN) return null;
	return {
		token: env.POLAR_ACCESS_TOKEN,
		productIds: {
			hobby: env.POLAR_PRODUCT_ID_HOBBY,
			pro: env.POLAR_PRODUCT_ID_PRO,
			team: env.POLAR_PRODUCT_ID_TEAM,
		},
	};
}

async function polarFetch<T>(polar: PolarClient, path: string, init: RequestInit = {}): Promise<T> {
	const res = await fetch(`${POLAR_API}${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${polar.token}`,
			"Content-Type": "application/json",
			Accept: "application/json",
			...init.headers,
		},
	});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		throw new Error(`Polar ${path} → ${res.status}${text ? `: ${text}` : ""}`);
	}
	return (await res.json()) as T;
}

// ── Checkout ──────────────────────────────────────────────────────────────

export interface CheckoutSession {
	id: string;
	url: string;
}

/**
 * Create a hosted checkout session. The customer lands on Polar's checkout
 * page; on success Polar redirects to successUrl. The webhook
 * (subscription.created) is what actually flips users.plan.
 */
export async function createCheckoutSession(
	polar: PolarClient,
	args: {
		productId: string;
		customerEmail: string;
		customerExternalId: string; // our user.id — Polar attaches it as metadata
		successUrl: string;
	},
): Promise<CheckoutSession> {
	const data = await polarFetch<{ id: string; url: string }>(polar, "/checkouts/", {
		method: "POST",
		body: JSON.stringify({
			products: [args.productId],
			customer_email: args.customerEmail,
			customer_external_id: args.customerExternalId,
			success_url: args.successUrl,
			metadata: { userId: args.customerExternalId },
		}),
	});
	return { id: data.id, url: data.url };
}

// ── Customer Portal ───────────────────────────────────────────────────────

/**
 * Create a one-time portal session URL the user can visit to manage their
 * subscription, payment method, and invoices. Returns null if the customer
 * doesn't exist on Polar yet (no checkout completed).
 */
export async function createCustomerPortalUrl(
	polar: PolarClient,
	customerExternalId: string,
): Promise<string | null> {
	// Polar's customer-sessions endpoint takes a customer_external_id.
	try {
		const data = await polarFetch<{ customer_portal_url: string }>(polar, "/customer-sessions/", {
			method: "POST",
			body: JSON.stringify({ customer_external_id: customerExternalId }),
		});
		return data.customer_portal_url;
	} catch {
		return null;
	}
}

// ── Webhook signature verification ────────────────────────────────────────

/**
 * Verify a standardwebhooks.com-format signature.
 *
 * Headers (all required):
 *   webhook-id        — unique event id
 *   webhook-timestamp — unix seconds (string)
 *   webhook-signature — space-separated list of "v1,<base64-sig>" entries
 *
 * Signature input: `${webhookId}.${timestamp}.${rawBody}`
 * Algorithm: HMAC-SHA256 with the webhook secret as key.
 */
export async function verifyPolarWebhook(
	rawBody: string,
	headers: Headers,
	secret: string,
): Promise<boolean> {
	const id = headers.get("webhook-id");
	const ts = headers.get("webhook-timestamp");
	const sigHeader = headers.get("webhook-signature");
	if (!id || !ts || !sigHeader) return false;

	// Reject events older than 5 minutes (replay protection).
	const tsSec = Number(ts);
	if (!Number.isFinite(tsSec)) return false;
	const ageMs = Math.abs(Date.now() - tsSec * 1000);
	if (ageMs > 5 * 60 * 1000) return false;

	const signedValue = `${id}.${ts}.${rawBody}`;

	// Polar's webhook secret is typically prefixed with "whsec_" + base64.
	// The actual key bytes are the base64-decoded portion.
	const cleanSecret = secret.startsWith("whsec_") ? secret.slice(6) : secret;
	const keyBytes = base64ToBytes(cleanSecret);

	const key = await crypto.subtle.importKey(
		"raw",
		keyBytes,
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const expectedSigBuf = await crypto.subtle.sign(
		"HMAC",
		key,
		new TextEncoder().encode(signedValue),
	);
	const expectedSig = bytesToBase64(new Uint8Array(expectedSigBuf));

	// Header may carry multiple signatures (key rotation); accept any match.
	const sigs = sigHeader.split(" ").map((s) => {
		const m = s.match(/^v1,(.+)$/);
		return m ? m[1] : "";
	});
	for (const sig of sigs) {
		if (sig && constantTimeEqual(sig, expectedSig)) return true;
	}
	return false;
}

function constantTimeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let mismatch = 0;
	for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return mismatch === 0;
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
	const bin = atob(b64);
	const buf = new ArrayBuffer(bin.length);
	const out = new Uint8Array(buf);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

function bytesToBase64(bytes: Uint8Array): string {
	let s = "";
	for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
	return btoa(s);
}

// ── Tier resolution ───────────────────────────────────────────────────────

/**
 * Map a Polar product id back to our internal plan. Returns null when the
 * product id isn't one we recognize (e.g. operator misconfigured env vars).
 */
export function resolvePlanFromProduct(
	polar: PolarClient,
	productId: string,
): "hobby" | "pro" | "team" | null {
	if (polar.productIds.hobby === productId) return "hobby";
	if (polar.productIds.pro === productId) return "pro";
	if (polar.productIds.team === productId) return "team";
	return null;
}
