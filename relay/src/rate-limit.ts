/**
 * Per-minute rate limits on the relay's abusable endpoints, using Cloudflare's
 * Workers Rate Limiting binding (configured in wrangler.toml). Each `limit()`
 * call is a single counter step at the edge: no KV read-modify-write race and
 * no KV write per request.
 *
 * The binding counts per Cloudflare location and is eventually consistent,
 * so these limits bound abuse rather than enforce exact quotas. Exact
 * per-user quotas stay in D1/KV (see access.ts and checkHourlyQuota).
 *
 * A missing or failing binding allows the request: self-hosters and
 * `wrangler dev` without the binding keep working, and an outage of the
 * limiter does not take sign-in down with it.
 */
import type { Context, MiddlewareHandler } from "hono";

/** The shape of a Workers Rate Limiting binding. */
export interface RateLimiter {
	limit(options: { key: string }): Promise<{ success: boolean }>;
}

/**
 * Bindings, each with its own limit in wrangler.toml (period 60 s):
 *   RL_AUTH_IP          30  every POST under /auth/ (sign-in, sign-up, resets,
 *                           magic links), per IP
 *   RL_AUTH_EMAIL_IP    10  email-keyed auth routes, per (target email, IP):
 *                           one attacker guessing one account
 *   RL_SIGNIN_EMAIL     60  password sign-in only, per target email: guessing
 *                           spread across many IPs. Generous on purpose, so
 *                           locking someone out takes a sustained 60/min from
 *                           the victim's Cloudflare location
 *   RL_AUTH_MAIL         5  mail-sending routes only (magic link, reset,
 *                           verification), per target email: stops inbox
 *                           bombing, and cannot block password sign-in
 *   RL_DEVICE           10  device pairing start and approve, per IP and route
 *   RL_DEVICE_EXCHANGE  30  device token exchange, per IP (an extension polls
 *                           every 5 s, 12 a minute)
 *   RL_CHANNEL_CREATE   10  channel and demo-channel creation, per IP
 */
export interface RateLimitEnv {
	RL_AUTH_IP?: RateLimiter;
	RL_AUTH_EMAIL_IP?: RateLimiter;
	RL_SIGNIN_EMAIL?: RateLimiter;
	RL_AUTH_MAIL?: RateLimiter;
	RL_DEVICE?: RateLimiter;
	RL_DEVICE_EXCHANGE?: RateLimiter;
	RL_CHANNEL_CREATE?: RateLimiter;
}

export const RETRY_AFTER_SECONDS = 60;

/**
 * The caller's IP. Only CF-Connecting-IP is trusted: Cloudflare sets it, and
 * X-Forwarded-For is whatever the client chose to send.
 */
export function clientIp(request: Request): string {
	return request.headers.get("cf-connecting-ip") || "unknown";
}

/** True when the request may proceed. */
export async function allowRequest(
	limiter: RateLimiter | undefined,
	key: string,
): Promise<boolean> {
	if (!limiter) return true;
	try {
		return (await limiter.limit({ key })).success;
	} catch (err) {
		console.error("Rate limiter error:", err);
		return true;
	}
}

export function tooManyRequests(c: Context) {
	return c.json({ error: "Too many requests. Try again in a minute." }, 429, {
		"Retry-After": String(RETRY_AFTER_SECONDS),
	});
}

const PASSWORD_SIGN_IN_PATH = "/auth/sign-in/email";
/** Better-Auth routes that send mail to the email in their body. */
const MAIL_SENDING_PATHS = new Set([
	"/auth/sign-in/magic-link",
	"/auth/request-password-reset",
	"/auth/forget-password",
	"/auth/send-verification-email",
]);
/** Better-Auth routes whose JSON body names a target account by email. */
const EMAIL_KEYED_PATHS = new Set([
	PASSWORD_SIGN_IN_PATH,
	"/auth/sign-up/email",
	...MAIL_SENDING_PATHS,
]);

async function targetEmail(request: Request): Promise<string | null> {
	try {
		// A clone, so the body is still unread when Better-Auth handles it.
		// Better-Auth accepts form posts as well as JSON on sign-in and
		// sign-up, so read the email from either; otherwise a form-encoded
		// guess would skip the per-email limits.
		const type = request.headers.get("content-type")?.toLowerCase() ?? "";
		let raw: unknown;
		if (
			type.includes("application/x-www-form-urlencoded") ||
			type.includes("multipart/form-data")
		) {
			raw = (await request.clone().formData()).get("email");
		} else {
			raw = ((await request.clone().json()) as { email?: unknown } | null)?.email;
		}
		const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
		return email.length > 0 ? email : null;
	} catch {
		return null;
	}
}

/**
 * Limits every POST under /auth/ (Better-Auth: sign-in, sign-up, resets,
 * magic links, verification mail) per IP; where the body names a target
 * email, also per (email, IP), and per email on separate counters for
 * password sign-in and for mail sends (see {@link RateLimitEnv}). Keeping
 * those apart means flooding one cannot lock a user out of the other.
 * Device pairing under /auth/device/ has its own limits
 * ({@link rateLimitRoute}); reads such as get-session are not limited.
 */
export function rateLimitAuth(): MiddlewareHandler<{ Bindings: RateLimitEnv }> {
	return async (c, next) => {
		if (c.req.method !== "POST" || c.req.path.startsWith("/auth/device/")) return next();
		if (!(await allowRequest(c.env?.RL_AUTH_IP, `auth:${clientIp(c.req.raw)}`))) {
			return tooManyRequests(c);
		}
		if (EMAIL_KEYED_PATHS.has(c.req.path)) {
			const email = await targetEmail(c.req.raw);
			if (email) {
				const ip = clientIp(c.req.raw);
				if (!(await allowRequest(c.env?.RL_AUTH_EMAIL_IP, `email-ip:${email}|${ip}`))) {
					return tooManyRequests(c);
				}
				if (
					c.req.path === PASSWORD_SIGN_IN_PATH &&
					!(await allowRequest(c.env?.RL_SIGNIN_EMAIL, `signin:${email}`))
				) {
					return tooManyRequests(c);
				}
				if (
					MAIL_SENDING_PATHS.has(c.req.path) &&
					!(await allowRequest(c.env?.RL_AUTH_MAIL, `mail:${email}`))
				) {
					return tooManyRequests(c);
				}
			}
		}
		return next();
	};
}

/** Limits one route per IP on the named binding, keyed by `scope`. */
export function rateLimitRoute(
	binding: keyof RateLimitEnv,
	scope: string,
): MiddlewareHandler<{ Bindings: RateLimitEnv }> {
	return async (c, next) => {
		if (!(await allowRequest(c.env?.[binding], `${scope}:${clientIp(c.req.raw)}`))) {
			return tooManyRequests(c);
		}
		return next();
	};
}
