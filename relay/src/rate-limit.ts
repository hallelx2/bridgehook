/**
 * Per-minute rate limits on the relay's abusable endpoints, counted in a
 * Durable Object per (limit, key) (./rate-limiter-do.ts): exact counts,
 * shared across every request and machine.
 *
 * History: PR #15 used the Workers Rate Limiting binding. Measured in
 * production on 2026-10-11 it never counted across separate requests (70 of
 * 70 allowed against a limit of 10), so these limits only held in
 * `wrangler dev` (HAL-2679).
 *
 * A missing RATE_LIMITER binding or a failing Durable Object allows the
 * request: self-hosters keep working, and a limiter outage does not take
 * sign-in down with it.
 */
import type { Context, MiddlewareHandler } from "hono";

/** One named limit, checked per key. */
export interface RateLimiter {
	limit(options: { key: string }): Promise<{ success: boolean }>;
}

/**
 * The limits (period 60 s each):
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
 *   RL_DEVICE_EXCHANGE 120  device token exchange, per IP. An extension polls
 *                           every 5 s (12 a minute), so ten people pairing
 *                           behind one office IP fit; still only 120 guesses a
 *                           minute against a 2^40 code space. Clients back off
 *                           on 429 (Retry-After) and keep polling.
 *   RL_CHANNEL_CREATE   10  channel and demo-channel creation, per IP
 */
export const LIMITS = {
	RL_AUTH_IP: { limit: 30, period: 60 },
	RL_AUTH_EMAIL_IP: { limit: 10, period: 60 },
	RL_SIGNIN_EMAIL: { limit: 60, period: 60 },
	RL_AUTH_MAIL: { limit: 5, period: 60 },
	RL_DEVICE: { limit: 10, period: 60 },
	RL_DEVICE_EXCHANGE: { limit: 120, period: 60 },
	RL_CHANNEL_CREATE: { limit: 10, period: 60 },
} as const;
export type LimiterName = keyof typeof LIMITS;

export type RateLimitEnv = {
	/** Durable Object namespace for RateLimiterDO (wrangler.toml). */
	RATE_LIMITER?: DurableObjectNamespace;
} & {
	/** Per-limit overrides, used by tests to inject a limiter. */
	[K in LimiterName]?: RateLimiter;
};

/**
 * Keys this isolate has seen refused, with the time their window resets.
 * A refusal cannot change before then, so later requests for that key are
 * refused here without calling the Durable Object: a flood from one key
 * costs one object call per window per isolate, and cannot overload it.
 * Bounded so a spray of distinct keys cannot grow it without limit.
 */
const BLOCKED_MAX = 10_000;
const blocked = new Map<string, number>();

function rememberBlocked(id: string, resetAt: number): void {
	if (blocked.size >= BLOCKED_MAX) {
		const now = Date.now();
		for (const [k, until] of blocked) if (until <= now) blocked.delete(k);
		// Still full of live entries: drop the oldest inserted.
		if (blocked.size >= BLOCKED_MAX) blocked.delete(blocked.keys().next().value as string);
	}
	blocked.set(id, resetAt);
}

/** Test hook: forget refusals this isolate remembers. */
export function clearBlockedCache(): void {
	blocked.clear();
}

/**
 * The limiter for a named limit: an injected override if present, otherwise
 * the Durable Object for (name, key), or undefined when there is no binding.
 */
export function limiterFor(
	env: RateLimitEnv | undefined,
	name: LimiterName,
): RateLimiter | undefined {
	const override = env?.[name];
	if (override) return override;
	const ns = env?.RATE_LIMITER;
	if (!ns) return undefined;
	const { limit, period } = LIMITS[name];
	return {
		async limit({ key }) {
			const id = `${name}:${key}`;
			const until = blocked.get(id);
			if (until !== undefined) {
				if (Date.now() < until) return { success: false };
				blocked.delete(id);
			}
			const stub = ns.get(ns.idFromName(id));
			const res = await stub.fetch(`https://rate-limiter/hit?limit=${limit}&period=${period}`, {
				method: "POST",
			});
			if (!res.ok) throw new Error(`rate limiter answered ${res.status}`);
			const out = (await res.json()) as { success: boolean; resetAt?: number };
			if (!out.success && typeof out.resetAt === "number") rememberBlocked(id, out.resetAt);
			return { success: out.success };
		},
	};
}

export const RETRY_AFTER_SECONDS = 60;

/**
 * The caller's IP. Only CF-Connecting-IP is trusted: Cloudflare sets it, and
 * X-Forwarded-For is whatever the client chose to send.
 */
export function clientIp(request: Request): string {
	return request.headers.get("cf-connecting-ip") || "unknown";
}

/**
 * True when the request may proceed. A limiter error allows the request (an
 * outage must not take sign-in down) except when the Durable Object reports
 * it is overloaded: that only happens under a flood on that key, which is
 * exactly when the limit has to hold, so it refuses.
 */
export async function allowRequest(
	limiter: RateLimiter | undefined,
	key: string,
): Promise<boolean> {
	if (!limiter) return true;
	try {
		return (await limiter.limit({ key })).success;
	} catch (err) {
		if (isOverloaded(err)) return false;
		console.error("Rate limiter error:", err);
		return true;
	}
}

/** Durable Object overload errors carry `overloaded: true` (and say so). */
export function isOverloaded(err: unknown): boolean {
	if (err && typeof err === "object" && (err as { overloaded?: unknown }).overloaded === true) {
		return true;
	}
	return /overloaded/i.test(String((err as { message?: unknown })?.message ?? err));
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
		if (!(await allowRequest(limiterFor(c.env, "RL_AUTH_IP"), `auth:${clientIp(c.req.raw)}`))) {
			return tooManyRequests(c);
		}
		if (EMAIL_KEYED_PATHS.has(c.req.path)) {
			const email = await targetEmail(c.req.raw);
			if (email) {
				const ip = clientIp(c.req.raw);
				if (
					!(await allowRequest(limiterFor(c.env, "RL_AUTH_EMAIL_IP"), `email-ip:${email}|${ip}`))
				) {
					return tooManyRequests(c);
				}
				if (
					c.req.path === PASSWORD_SIGN_IN_PATH &&
					!(await allowRequest(limiterFor(c.env, "RL_SIGNIN_EMAIL"), `signin:${email}`))
				) {
					return tooManyRequests(c);
				}
				if (
					MAIL_SENDING_PATHS.has(c.req.path) &&
					!(await allowRequest(limiterFor(c.env, "RL_AUTH_MAIL"), `mail:${email}`))
				) {
					return tooManyRequests(c);
				}
			}
		}
		return next();
	};
}

/** Limits one route per IP on the named limit, keyed by `scope`. */
export function rateLimitRoute(
	name: LimiterName,
	scope: string,
): MiddlewareHandler<{ Bindings: RateLimitEnv }> {
	return async (c, next) => {
		if (!(await allowRequest(limiterFor(c.env, name), `${scope}:${clientIp(c.req.raw)}`))) {
			return tooManyRequests(c);
		}
		return next();
	};
}
