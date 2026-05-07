import { TRIAL_DAYS } from "@bridgehook/shared";
import { account, session, user, verification } from "@bridgehook/shared/db/schema";
import { neon } from "@neondatabase/serverless";
/**
 * Better-Auth factory.
 *
 * Returns `null` if BETTER_AUTH_SECRET is unset — that's the load-bearing
 * self-host invariant. Every route that consults Better-Auth wraps the call
 * with `if (auth)`; self-hosted instances see a resolved `null` and skip
 * auth entirely.
 *
 * Cross-subdomain cookies: when AUTH_COOKIE_DOMAIN is set (e.g. ".bridgehook.dev"),
 * the session cookie is readable from app.bridgehook.dev and relay.bridgehook.dev.
 * Self-hosters set their own domain or leave it unset for same-origin only.
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/neon-http";
import { pickMailer } from "./email.js";
import { addDays } from "./time.js";

export interface AuthEnv {
	DATABASE_URL: string;
	BETTER_AUTH_SECRET?: string;
	BETTER_AUTH_URL?: string;
	AUTH_COOKIE_DOMAIN?: string;
	AUTH_TRUSTED_ORIGINS?: string; // comma-separated
	RESEND_API_KEY?: string;
	MAIL_FROM?: string;
}

// We use the returned shape opaquely (only `auth.handler(req)` and
// `auth.api.getSession(...)`); a structural any here keeps TS happy without
// fighting Better-Auth's deep generic instantiation.
// biome-ignore lint/suspicious/noExplicitAny: opaque framework type
export type Auth = any;

let cachedAuth: Auth | null | undefined;
let cachedSecret: string | undefined;

/**
 * Lazily construct the Better-Auth handler. Memoized per Worker isolate so
 * we don't pay the (small) construction cost on every request.
 *
 * Returns `null` in self-host mode — callers should `if (auth) ...`.
 */
export function createAuth(env: AuthEnv): Auth | null {
	const secret = env.BETTER_AUTH_SECRET;
	if (!secret) return null;

	if (cachedAuth !== undefined && cachedSecret === secret) {
		return cachedAuth;
	}

	const sql = neon(env.DATABASE_URL);
	const db = drizzle(sql, { schema: { user, session, account, verification } });
	const mailer = pickMailer(env);

	const trustedOrigins = (env.AUTH_TRUSTED_ORIGINS ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);

	const auth = betterAuth({
		secret,
		baseURL: env.BETTER_AUTH_URL,
		basePath: "/auth",
		database: drizzleAdapter(db, {
			provider: "pg",
			schema: { user, session, account, verification },
		}),
		// Disable email/password — magic-link only at launch.
		emailAndPassword: { enabled: false },
		plugins: [
			magicLink({
				sendMagicLink: async ({ email, url }) => {
					await mailer.sendMagicLink({ to: email, url, expiresInMinutes: 15 });
				},
				expiresIn: 15 * 60,
			}),
		],
		// First-time signups get a 7-day trial.
		databaseHooks: {
			user: {
				create: {
					before: async (incoming: Record<string, unknown>) => {
						return {
							data: {
								...incoming,
								plan: "trialing",
								trialEndsAt: addDays(new Date(), TRIAL_DAYS),
							},
						};
					},
				},
			},
		},
		advanced: env.AUTH_COOKIE_DOMAIN
			? {
					crossSubDomainCookies: {
						enabled: true,
						domain: env.AUTH_COOKIE_DOMAIN,
					},
					useSecureCookies: true,
				}
			: { useSecureCookies: true },
		trustedOrigins: trustedOrigins.length > 0 ? trustedOrigins : undefined,
	});

	cachedAuth = auth;
	cachedSecret = secret;
	return auth;
}

/**
 * Resolve the current session from a Request. Returns null when auth is
 * disabled (self-host) or no valid session cookie is present.
 */
export async function getSessionUser(
	auth: Auth | null,
	request: Request,
): Promise<{ id: string; email: string } | null> {
	if (!auth) return null;
	try {
		const result = await auth.api.getSession({ headers: request.headers });
		if (!result?.user) return null;
		return { id: result.user.id, email: result.user.email };
	} catch (err) {
		console.error("getSessionUser error:", err);
		return null;
	}
}
