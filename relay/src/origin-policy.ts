/**
 * Cross-origin policy for the relay.
 *
 * The session cookie is `SameSite=None` while the dashboard and relay live on
 * different sites (pages.dev → workers.dev), so the browser attaches it to
 * requests from *any* page. Two layers keep a third-party page from acting as
 * the signed-in user:
 *
 *   1. CORS — only trusted origins get `Access-Control-Allow-Credentials`.
 *      Everyone else gets `Access-Control-Allow-Origin: *` without
 *      credentials: public routes (webhook intake, channel info, self-host
 *      dashboards) keep working, but the browser refuses to expose a
 *      credentialed response or send a credentialed preflighted request.
 *
 *   2. Origin guard — CORS only stops *reading*. A cross-site form or
 *      `text/plain` POST is a "simple" request: no preflight, the cookie is
 *      attached, and the handler runs. So any state-changing request that
 *      carries the session cookie must come from a trusted origin (or from a
 *      browser extension, whose access is governed by its host permissions).
 *
 * Trusted origins = `AUTH_TRUSTED_ORIGINS` (comma-separated) plus the origins
 * of `WEB_URL` and `BETTER_AUTH_URL`. An entry may use one leading wildcard
 * label, e.g. `https://*.bridgehook-web.pages.dev` for Pages previews.
 *
 * Self-host mode (no `BETTER_AUTH_SECRET`) has no session to protect, so any
 * origin gets credentialed CORS there and the guard never fires.
 */
import type { MiddlewareHandler } from "hono";

export interface OriginPolicyEnv {
	BETTER_AUTH_SECRET?: string;
	AUTH_TRUSTED_ORIGINS?: string;
	WEB_URL?: string;
	BETTER_AUTH_URL?: string;
}

const ALLOW_METHODS = "GET, POST, PATCH, PUT, DELETE, OPTIONS";
const ALLOW_HEADERS = "Content-Type, Authorization, X-BH-Timestamp, X-BH-Signature";
const MAX_AGE = "86400";
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Paths that never act on the session: public webhook intake (and its
 * ECDSA-signed claim/response siblings) and the signature-verified Polar
 * webhook. Browsers posting test webhooks from arbitrary pages must not be
 * refused just because the user also happens to hold a relay cookie.
 */
const GUARD_EXEMPT_PREFIXES = ["/hook/", "/api/billing/webhook"];

/** Better-Auth session cookie, with or without the `__Secure-` prefix. */
const SESSION_COOKIE_RE = /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=/;

function toOrigin(raw: string): string | null {
	try {
		const u = new URL(raw.trim());
		if (u.protocol !== "https:" && u.protocol !== "http:") return null;
		return u.origin;
	} catch {
		return null;
	}
}

/** Exact origins plus `scheme://*.suffix` patterns; `any` trusts everything. */
export interface TrustedOrigins {
	any: boolean;
	exact: Set<string>;
	wildcards: { scheme: string; suffix: string }[];
	has(origin: string): boolean;
}

const WILDCARD_RE = /^(https?):\/\/\*\.([a-z0-9.-]+?)\/?$/i;

export function trustedOrigins(env: OriginPolicyEnv): TrustedOrigins {
	const any = !env.BETTER_AUTH_SECRET;
	const exact = new Set<string>();
	const wildcards: { scheme: string; suffix: string }[] = [];
	for (const raw of (env.AUTH_TRUSTED_ORIGINS ?? "").split(",")) {
		const entry = raw.trim();
		if (!entry) continue;
		const w = entry.match(WILDCARD_RE);
		if (w) {
			wildcards.push({ scheme: w[1].toLowerCase(), suffix: `.${w[2].toLowerCase()}` });
			continue;
		}
		const o = toOrigin(entry);
		if (o) exact.add(o);
	}
	for (const raw of [env.WEB_URL, env.BETTER_AUTH_URL]) {
		if (!raw) continue;
		const o = toOrigin(raw);
		if (o) exact.add(o);
	}
	return {
		any,
		exact,
		wildcards,
		has(origin: string): boolean {
			if (exact.has(origin)) return true;
			const o = toOrigin(origin);
			if (!o || o !== origin) return false;
			const u = new URL(o);
			const scheme = u.protocol.slice(0, -1);
			return wildcards.some((w) => {
				if (w.scheme !== scheme || !u.hostname.endsWith(w.suffix)) return false;
				// Exactly one extra label: `*.x.dev` matches `a.x.dev`, not `a.b.x.dev`.
				const label = u.hostname.slice(0, -w.suffix.length);
				return label.length > 0 && !label.includes(".");
			});
		},
	};
}

export function isExtensionOrigin(origin: string): boolean {
	return origin.startsWith("chrome-extension://") || origin.startsWith("moz-extension://");
}

/** Headers for a response to `origin`; `null` origin means non-browser caller. */
export function corsHeaders(
	origin: string | null,
	trusted: TrustedOrigins,
): Record<string, string> {
	if (origin && (trusted.any || trusted.has(origin))) {
		return {
			"Access-Control-Allow-Origin": origin,
			"Access-Control-Allow-Credentials": "true",
			Vary: "Origin",
		};
	}
	return { "Access-Control-Allow-Origin": "*", Vary: "Origin" };
}

export type GuardVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Decide whether a request may proceed. Only state-changing requests that
 * carry the session cookie are inspected; everything else passes.
 */
export function checkOrigin(
	req: { method: string; path: string; origin: string | null; cookie: string | null },
	trusted: TrustedOrigins,
): GuardVerdict {
	if (trusted.any) return { ok: true };
	if (!UNSAFE_METHODS.has(req.method.toUpperCase())) return { ok: true };
	if (GUARD_EXEMPT_PREFIXES.some((p) => req.path.startsWith(p))) return { ok: true };
	if (!req.cookie || !SESSION_COOKIE_RE.test(req.cookie)) return { ok: true };
	// Modern browsers send Origin on every cross-origin unsafe request, so a
	// missing Origin means a non-browser client presenting its own cookie.
	if (req.origin === null) return { ok: true };
	if (trusted.has(req.origin)) return { ok: true };
	if (isExtensionOrigin(req.origin)) return { ok: true };
	return { ok: false, reason: "Cross-origin request with session cookie refused" };
}

export function originPolicy(): MiddlewareHandler<{ Bindings: OriginPolicyEnv }> {
	return async (c, next) => {
		const trusted = trustedOrigins(c.env);
		const origin = c.req.header("origin") ?? null;
		const base = corsHeaders(origin, trusted);

		if (c.req.method === "OPTIONS") {
			return new Response(null, {
				status: 204,
				headers: {
					...base,
					"Access-Control-Allow-Methods": ALLOW_METHODS,
					"Access-Control-Allow-Headers": ALLOW_HEADERS,
					"Access-Control-Max-Age": MAX_AGE,
				},
			});
		}

		const verdict = checkOrigin(
			{
				method: c.req.method,
				path: c.req.path,
				origin,
				cookie: c.req.header("cookie") ?? null,
			},
			trusted,
		);
		if (!verdict.ok) {
			return new Response(JSON.stringify({ error: verdict.reason }), {
				status: 403,
				headers: { ...base, "Content-Type": "application/json" },
			});
		}

		await next();
		// Responses proxied from a Durable Object (the SSE streams) carry
		// immutable headers; re-wrap before stamping CORS onto them.
		try {
			for (const [k, v] of Object.entries(base)) c.res.headers.set(k, v);
		} catch {
			c.res = new Response(c.res.body, c.res);
			for (const [k, v] of Object.entries(base)) c.res.headers.set(k, v);
		}
	};
}
