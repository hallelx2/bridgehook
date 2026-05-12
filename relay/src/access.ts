/**
 * Access layer — single source of truth for "what is this user allowed to do?"
 *
 * Every write-facing route (channel create, device pair, event replay) calls
 * one of the `check*` helpers, which combine three signals:
 *
 *   1. Plan tier (`users.plan`) — drives the limits read from {@link PLANS}
 *   2. Trial state (`users.trialEndsAt`) — past-trial users on `trialing`
 *      flip to read-only (legacy; new signups go straight to `free`)
 *   3. Subscription status (`subscriptions.status`) — `canceled` / `revoked`
 *      drops a paid user back to read-only as a safety net (the webhook
 *      should also have flipped `users.plan`, but races happen)
 *
 * Free-tier users (`free`) never flip to read-only — they have a daily event
 * cap enforced separately at webhook intake via {@link checkDailyEventCap}.
 *
 * Self-host instances never reach this code — `getOrCreateSelfHostUser`
 * writes `plan = "selfhost"` which has Infinity limits and is treated as
 * never-read-only here for defense in depth.
 */
import { PLANS, type PlanId } from "@bridgehook/shared";
import { events, channels, devices, subscriptions, user } from "@bridgehook/shared/db/schema";
import { and, count, eq, gte, isNull } from "drizzle-orm";
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

	if (plan === "selfhost" || plan === "free") {
		// Always full access (within plan limits — the daily cap is its own
		// gate). Free has no time-based lock; the daily counter resets at
		// UTC midnight, so the only "no" answer is "you hit the cap today."
		readOnly = false;
	} else if (plan === "trialing") {
		// Legacy users from the old 7-day trial flow. Past-trial users with
		// no active sub flip to read-only — same shape as before.
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
		raw === "free" ||
		raw === "trialing" ||
		raw === "hobby" ||
		raw === "pro" ||
		raw === "team" ||
		raw === "selfhost"
	) {
		return raw;
	}
	return "free"; // fail-open to a working free account, not a locked trial
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

// ── Daily event cap (free-tier rate limit) ───────────────────────────────
//
// Two views into "events received today":
//   • `dailyEventCapKey()` + KV — fast, eventually consistent, used in the
//     hot path at webhook intake. Read-then-write is racy, but at 10/day
//     resolution the rare off-by-one is acceptable.
//   • `loadDailyEventCount()` — exact DB count, used by /api/me so the
//     dashboard shows the true "5/10 today" number.
//
// Both bucket by UTC date, so users in any timezone see the cap roll over
// at midnight UTC. (Local-time buckets aren't worth the complexity at this
// scale — and would hand attackers a 24h window with two date buckets.)

const ONE_DAY_SECONDS = 86_400;
const KV_TTL_SLACK_SECONDS = 3_600;

export function utcDateString(now: Date = new Date()): string {
	return now.toISOString().slice(0, 10); // YYYY-MM-DD
}

export function dailyEventCapKey(userId: string, date: string = utcDateString()): string {
	return `events:${userId}:${date}`;
}

/** Authoritative count for /api/me (DB). */
export async function loadDailyEventCount(db: DB, userId: string): Promise<number> {
	const dayStart = new Date(`${utcDateString()}T00:00:00.000Z`);
	const [{ n }] = await db
		.select({ n: count() })
		.from(events)
		.innerJoin(channels, eq(events.channelId, channels.id))
		.where(and(eq(channels.userId, userId), gte(events.receivedAt, dayStart)));
	return Number(n);
}

/**
 * Hot-path check + increment for the daily event cap. Returns ok when the
 * user is under-cap and the counter has been bumped; not-ok when the cap
 * is reached.
 *
 * The KV access is best-effort: when RATE_LIMIT is unbound (e.g. dev
 * without a KV namespace), we let the request through rather than block
 * everyone. The DB-backed count in /api/me is the audit trail; this is
 * just an admission control.
 */
export async function checkDailyEventCap(
	kv: KVNamespace | undefined,
	access: UserAccess,
): Promise<AccessCheck> {
	const cap = access.limits.eventsPerDay;
	if (!Number.isFinite(cap)) return { ok: true };
	if (!kv) return { ok: true }; // soft-fail in environments without KV

	const key = dailyEventCapKey(access.userId);
	const current = Number(await kv.get(key)) || 0;
	if (current >= cap) {
		return {
			ok: false,
			status: 402,
			error: `Daily webhook cap reached (${cap} on ${PLANS[access.plan].name}). Resets at 00:00 UTC.`,
		};
	}
	// TTL the counter ~25h so the bucket lives slightly past midnight UTC
	// in case of clock skew; the next day's key has its own TTL window.
	await kv.put(key, String(current + 1), {
		expirationTtl: ONE_DAY_SECONDS + KV_TTL_SLACK_SECONDS,
	});
	return { ok: true };
}

// ── JSON-safe serializer ─────────────────────────────────────────────────

/**
 * `Number.POSITIVE_INFINITY` doesn't survive `JSON.stringify` (becomes `null`).
 * Use this when echoing limits over the wire to keep the type honest.
 */
export function finiteOrNull(n: number): number | null {
	return Number.isFinite(n) ? n : null;
}
