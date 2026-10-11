/**
 * Request body size limits.
 *
 * Every route that reads a body does it through one of two paths, both
 * capped before the body is buffered:
 *
 * - {@link readBodyLimited}: for routes that read the raw body themselves.
 *   Signed executor routes (claim, response, signed events/DELETE), where the
 *   bytes are hashed for the ECDSA signature, and webhook intake on channel
 *   hosts, which never reaches the Hono app.
 * - {@link limitApiBodies}: Hono middleware for the JSON API, auth and MCP
 *   routes, which read bodies with `c.req.json()`.
 *
 * Both reject on a declared `content-length` over the cap without reading,
 * and count bytes on chunked bodies (no content-length), stopping as soon as
 * the cap is passed. Before this, a signed route or an unauthenticated
 * device-pairing route would buffer any body up to the platform limit before
 * looking at it.
 */
import { MAX_BODY_SIZE_BYTES } from "@bridgehook/shared";
import type { MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";

/** JSON bodies on /api/* and /auth/*: settings, channel creates, pairing. */
export const API_BODY_LIMIT = 64 * 1024;
/** Billing provider webhooks carry whole subscription objects. */
export const BILLING_WEBHOOK_BODY_LIMIT = 256 * 1024;
/**
 * MCP tool calls can carry an edited webhook body for replay (up to
 * MAX_BODY_SIZE_BYTES) inside a JSON-RPC string; JSON escaping can roughly
 * double it, plus room for the envelope.
 */
export const MCP_BODY_LIMIT = 2 * MAX_BODY_SIZE_BYTES + 64 * 1024;

/** Caps for the ECDSA-signed executor routes, by what they carry. */
export const SIGNED_BODY_LIMITS = {
	/** Signed GET /api/channels/:id/events and DELETE /api/channels/:id: no body. */
	empty: 1024,
	/** POST /hook/:id/claim: `{ eventId, clientId }`. */
	claim: 4 * 1024,
	/**
	 * POST /hook/:id/response: the local server's answer, whose body (up to
	 * MAX_BODY_SIZE_BYTES, enforced after parsing) travels as a JSON string.
	 * Twice that allows for escaping; 64 KiB covers headers and fields.
	 */
	response: 2 * MAX_BODY_SIZE_BYTES + 64 * 1024,
} as const;

export type LimitedBody = { ok: true; text: string } | { ok: false };

/**
 * Reads a request body as UTF-8 text, refusing anything over `maxBytes`.
 * A declared content-length over the cap (or one that is not a number) is
 * refused without reading; otherwise the stream is read until it ends or
 * passes the cap, whichever comes first.
 */
export async function readBodyLimited(request: Request, maxBytes: number): Promise<LimitedBody> {
	const declared = request.headers.get("content-length");
	if (declared !== null) {
		const n = Number(declared);
		if (!Number.isInteger(n) || n < 0 || n > maxBytes) return { ok: false };
	}
	if (!request.body) return { ok: true, text: "" };

	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > maxBytes) {
			await reader.cancel().catch(() => {});
			return { ok: false };
		}
		chunks.push(value);
	}

	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return { ok: true, text: new TextDecoder().decode(bytes) };
}

/**
 * The cap for a relay-host path read through `c.req.*`, or null for paths
 * that read their own body through {@link readBodyLimited} with a tighter or
 * route-specific cap (signed executor routes and path-style webhook intake).
 */
export function apiBodyLimitFor(path: string): number | null {
	if (path === "/mcp") return MCP_BODY_LIMIT;
	if (path === "/api/billing/webhook") return BILLING_WEBHOOK_BODY_LIMIT;
	if (path.startsWith("/api/") || path.startsWith("/auth/")) return API_BODY_LIMIT;
	return null;
}

/** Hono middleware applying {@link apiBodyLimitFor} with a JSON 413. */
export function limitApiBodies(): MiddlewareHandler {
	const limiters = new Map<number, MiddlewareHandler>();
	return async (c, next) => {
		const maxSize = apiBodyLimitFor(c.req.path);
		if (maxSize === null) return next();
		let limiter = limiters.get(maxSize);
		if (!limiter) {
			limiter = bodyLimit({
				maxSize,
				onError: (ctx) => ctx.json({ error: "Body too large" }, 413),
			});
			limiters.set(maxSize, limiter);
		}
		return limiter(c, next);
	};
}
