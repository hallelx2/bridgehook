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
 *
 * Sign-in providers at launch:
 *   - Google OAuth (registered when GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET set)
 *   - GitHub OAuth (registered when GITHUB_CLIENT_ID + GITHUB_CLIENT_SECRET set)
 *   - Magic link (registered when RESEND_API_KEY set, or always in dev with the
 *     console mailer)
 *
 * Each provider is independently optional — missing env vars just drop that
 * provider out of the registered list, no startup failure. The Login page
 * checks /api/config.authProviders to decide which buttons to render.
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { magicLink } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/neon-http";
import { pickMailer } from "./email.js";

export interface AuthEnv {
	DATABASE_URL: string;
	BETTER_AUTH_SECRET?: string;
	BETTER_AUTH_URL?: string;
	AUTH_COOKIE_DOMAIN?: string;
	AUTH_TRUSTED_ORIGINS?: string; // comma-separated
	RESEND_API_KEY?: string;
	MAIL_FROM?: string;
	// OAuth provider credentials. Each pair is independent — set one or both.
	GOOGLE_CLIENT_ID?: string;
	GOOGLE_CLIENT_SECRET?: string;
	GITHUB_CLIENT_ID?: string;
	GITHUB_CLIENT_SECRET?: string;
}

// We use the returned shape opaquely (only `auth.handler(req)` and
// `auth.api.getSession(...)`); a structural any here keeps TS happy without
// fighting Better-Auth's deep generic instantiation.
// biome-ignore lint/suspicious/noExplicitAny: opaque framework type
export type Auth = any;

let cachedAuth: Auth | null | undefined;
let cachedSecret: string | undefined;

/**
 * Which sign-in methods this relay has been configured for. Surfaced via
 * /api/config so the dashboard renders the right buttons.
 *
 * `emailPassword` is true whenever auth itself is on — it's the universal
 * fallback that works without a domain or mailer. The OAuth providers and
 * magic-link light up as their respective env vars get set.
 */
export interface AvailableAuthProviders {
	emailPassword: boolean;
	google: boolean;
	github: boolean;
	magicLink: boolean;
}

export function getAvailableAuthProviders(env: AuthEnv): AvailableAuthProviders {
	return {
		// Email+password is always usable when auth is up. Verification is
		// off until RESEND_API_KEY is set — see createAuth() below.
		emailPassword: true,
		google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
		github: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
		magicLink: Boolean(env.RESEND_API_KEY),
	};
}

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

	// Build the socialProviders config object — each entry is optional and
	// only registered when both client id + secret are present. Better-Auth's
	// own logic auto-verifies email when the OAuth provider reports it as
	// verified, which is the case for both Google and GitHub.
	const socialProviders: Record<string, { clientId: string; clientSecret: string }> = {};
	if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
		socialProviders.google = {
			clientId: env.GOOGLE_CLIENT_ID,
			clientSecret: env.GOOGLE_CLIENT_SECRET,
		};
	}
	if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
		socialProviders.github = {
			clientId: env.GITHUB_CLIENT_ID,
			clientSecret: env.GITHUB_CLIENT_SECRET,
		};
	}

	const auth = betterAuth({
		secret,
		baseURL: env.BETTER_AUTH_URL,
		basePath: "/auth",
		database: drizzleAdapter(db, {
			provider: "pg",
			schema: { user, session, account, verification },
		}),
		// Email+password is the launch path because it works without a sending
		// domain. `requireEmailVerification` flips to true once RESEND_API_KEY
		// is set — existing accounts get a "please verify" banner from
		// Better-Auth's standard flow. `autoSignIn` lets sign-up create a
		// session in one round-trip so users land in /dashboard immediately.
		// Password reset is gated by mailer availability inside Better-Auth,
		// so it's a no-op until the env is configured.
		emailAndPassword: {
			enabled: true,
			autoSignIn: true,
			requireEmailVerification: Boolean(env.RESEND_API_KEY),
			minPasswordLength: 8,
			maxPasswordLength: 128,
		},
		socialProviders,
		plugins: [
			magicLink({
				sendMagicLink: async ({ email, url }) => {
					await mailer.sendMagicLink({ to: email, url, expiresInMinutes: 15 });
				},
				expiresIn: 15 * 60,
			}),
		],
		// New signups land on the free tier. The 7-day trial is retired; users
		// keep using the free quota until they hit the daily cap, at which
		// point Billing surfaces the upsell (paid tiers ship later).
		databaseHooks: {
			user: {
				create: {
					before: async (incoming: Record<string, unknown>) => {
						return {
							data: {
								...incoming,
								plan: "free",
								trialEndsAt: null,
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
