/**
 * Access layer — single source of truth for "what is this user allowed to do?"
 *
 * Every write-facing route (channel create, device pair, event replay) calls
 * one of the `check*` helpers, which combine three signals:
 *
 *   1. Plan tier (`users.plan`) — drives the limits read from {@link PLANS}
 *   2. Trial state (`users.trialEndsAt`) — past-trial users on `trialing`
 *      flip to read-only
 *   3. Subscription status (`subscriptions.status`) — `canceled` / `revoked`
 *      drops a paid user back to read-only as a safety net (the webhook
 *      should also have flipped `users.plan` back to `trialing`, but races
 *      happen)
 *
 * Self-host instances never reach this code — `getOrCreateSelfHostUser`
 * writes `plan = "selfhost"` which has Infinity limits and is treated as
 * never-read-only here for defense in depth.
 */
import { PLANS, type PlanId } from "@bridgehook/shared";
import { channels, devices, subscriptions, user } from "@bridgehook/shared/db/schema";
import { and, count, eq, isNull } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/neon-http";

type DB = ReturnType<typeof drizzle>;

export interface UserAccess {
	userId: string;
	/** Effective tier — falls back to `trialing` for unknown values. */
	plan: PlanId;
	/** True when the user can sign in / view but not create / replay. */
	readOnly: boolean;
	/** Why the lock applies (when it does). */
	reason: ReadOnlyReason | null;
	limits: (typeof PLANS)[PlanId]["limits"];
	subscription: {
		status: string;
		provider: string;
		cancelAtPeriodEnd: boolean;
		currentPeriodEnd: Date;
	} | null;
	trialEndsAt: Date | null;
}

export type ReadOnlyReason = "trial-expired" | "subscription-canceled";

export type AccessCheck = { ok: true } | { ok: false; status: 402; error: string };

/**
 * Resolve a user's access state from the DB. Returns null when the user row
 * is missing (caller should 404 / 401).
 */
export async function loadUserAccess(db: DB, userId: string): Promise<UserAccess | null> {
	const [u] = await db
		.select({
			id: user.id,
			plan: user.plan,
			trialEndsAt: user.trialEndsAt,
		})
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);
	if (!u) return null;

	const [sub] = await db
		.select({
			status: subscriptions.status,
			provider: subscriptions.provider,
			cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
			currentPeriodEnd: subscriptions.currentPeriodEnd,
		})
		.from(subscriptions)
		.where(eq(subscriptions.userId, userId))
		.limit(1);

	const plan = normalizePlan(u.plan);
	const limits = PLANS[plan].limits;

	let readOnly = false;
	let reason: ReadOnlyReason | null = null;

	if (plan === "selfhost") {
		// Always full access. Defensive: even if a future migration writes
		// odd state, the implicit user keeps working.
		readOnly = false;
	} else if (plan === "trialing") {
		// Past-trial users with no active sub flip to read-only. The webhook
		// only resets to `trialing` on `canceled`/`revoked`, so a freshly-
		// trialing user here is genuinely on a trial.
		if (!u.trialEndsAt || u.trialEndsAt.getTime() <= Date.now()) {
			readOnly = true;
			reason = "trial-expired";
		}
	} else {
		// Paid plan (hobby/pro/team). past_due is left functional — Polar's
		// dunning will eventually flip status to canceled, which we lock on.
		if (sub && (sub.status === "canceled" || sub.status === "revoked")) {
			readOnly = true;
			reason = "subscription-canceled";
		}
	}

	return {
		userId,
		plan,
		readOnly,
		reason,
		limits,
		subscription: sub
			? {
					status: sub.status,
					provider: sub.provider,
					cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
					currentPeriodEnd: sub.currentPeriodEnd,
				}
			: null,
		trialEndsAt: u.trialEndsAt,
	};
}

/**
 * Map a DB `plan` string to a known {@link PlanId}, with a backwards-compat
 * shim: pre-multi-tier deployments wrote `"active"` for self-host users.
 * Anything unrecognized falls back to `trialing` (fail-closed).
 */
export function normalizePlan(raw: string): PlanId {
	if (raw === "active") return "selfhost"; // legacy self-host marker
	if (
		raw === "trialing" ||
		raw === "hobby" ||
		raw === "pro" ||
		raw === "team" ||
		raw === "selfhost"
	) {
		return raw;
	}
	return "trialing";
}

// ── Quota / lock checks ──────────────────────────────────────────────────

export async function checkChannelCreate(db: DB, access: UserAccess): Promise<AccessCheck> {
	if (access.readOnly) return readOnly(access);
	if (Number.isFinite(access.limits.maxChannels)) {
		const n = await countActiveChannels(db, access.userId);
		if (n >= access.limits.maxChannels) {
			return {
				ok: false,
				status: 402,
				error: `Channel quota reached (${access.limits.maxChannels} on ${PLANS[access.plan].name}). Upgrade to add more.`,
			};
		}
	}
	return { ok: true };
}

export async function checkDevicePair(db: DB, access: UserAccess): Promise<AccessCheck> {
	if (access.readOnly) return readOnly(access);
	if (Number.isFinite(access.limits.maxDevices)) {
		const n = await countActiveDevices(db, access.userId);
		if (n >= access.limits.maxDevices) {
			return {
				ok: false,
				status: 402,
				error: `Device quota reached (${access.limits.maxDevices} on ${PLANS[access.plan].name}). Revoke a device or upgrade to add more.`,
			};
		}
	}
	return { ok: true };
}

export function checkReplay(access: UserAccess): AccessCheck {
	if (access.readOnly) return readOnly(access);
	return { ok: true };
}

function readOnly(access: UserAccess): AccessCheck {
	const message =
		access.reason === "trial-expired"
			? "Trial ended. Subscribe to keep using BridgeHook."
			: access.reason === "subscription-canceled"
				? "Subscription canceled. Resubscribe from the Billing page to restore access."
				: "Account is read-only.";
	return { ok: false, status: 402, error: message };
}

// ── Counters ─────────────────────────────────────────────────────────────

async function countActiveChannels(db: DB, userId: string): Promise<number> {
	const [{ n }] = await db.select({ n: count() }).from(channels).where(eq(channels.userId, userId));
	return Number(n);
}

async function countActiveDevices(db: DB, userId: string): Promise<number> {
	const [{ n }] = await db
		.select({ n: count() })
		.from(devices)
		.where(and(eq(devices.userId, userId), isNull(devices.revokedAt)));
	return Number(n);
}

// ── JSON-safe serializer ─────────────────────────────────────────────────

/**
 * `Number.POSITIVE_INFINITY` doesn't survive `JSON.stringify` (becomes `null`).
 * Use this when echoing limits over the wire to keep the type honest.
 */
export function finiteOrNull(n: number): number | null {
	return Number.isFinite(n) ? n : null;
}
