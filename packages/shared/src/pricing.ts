/**
 * Single source of truth for pricing tiers. Drives:
 *   - Web Billing page render
 *   - Relay quota enforcement (free-tier daily cap, per-plan retention, etc.)
 *   - Polar product configuration (set the productId env var to match)
 *
 * At launch the dashboard only exposes `free` to new signups. The paid tiers
 * are kept in the table so the access layer and Polar webhook handler stay
 * complete — flipping them on is a UI change, not a code change.
 *
 * Self-host instances bypass real quotas — `getOrCreateSelfHostUser` writes
 * `plan = 'selfhost'`, which carries Infinity limits and is excluded from
 * {@link PUBLIC_PLAN_ORDER} so the Billing page never lists it.
 */

/**
 * `free` is the default tier for new hosted-mode signups; replaces the
 * earlier 7-day `trialing` flow. `selfhost` is the implicit self-host user.
 * Both are absent from {@link PUBLIC_PLAN_ORDER} — that list drives the
 * paid checkout cards, which are off at launch.
 *
 * `trialing` stays as a valid PlanId for backwards compat with users who
 * signed up before the free-tier flip; the access layer treats them as
 * if their trial is currently active.
 */
export type PlanId = "free" | "trialing" | "hobby" | "pro" | "team" | "selfhost";

export interface PlanLimits {
	/** Active channels per user. Infinity = unbounded. */
	maxChannels: number;
	/** Active (non-revoked) devices per user. */
	maxDevices: number;
	/** Event retention window in days. */
	retentionDays: number;
	/**
	 * Hard daily event cap, enforced at webhook intake via the RATE_LIMIT KV.
	 * Infinity = unbounded (selfhost/pro/team).
	 */
	eventsPerDay: number;
	/** Soft monthly event count cap (informational v1; enforced post-MVP). */
	monthlyEventCap: number;
	/** Polling cadence in ms — UI hint for rendering "polls every Ns" copy. */
	pollIntervalMs: number;
	/** Number of paid seats. */
	seats: number;
}

export interface PlanFeature {
	label: string;
	included: boolean;
	hint?: string;
}

export interface PlanDef {
	id: PlanId;
	name: string;
	tagline: string;
	priceMonthlyCents: number;
	limits: PlanLimits;
	features: PlanFeature[];
	cta: string;
	highlighted?: boolean;
}

export const PLANS: Record<PlanId, PlanDef> = {
	free: {
		id: "free",
		name: "Free",
		tagline: "Kick the tires. No card required.",
		priceMonthlyCents: 0,
		limits: {
			maxChannels: 1,
			maxDevices: 1,
			retentionDays: 3,
			eventsPerDay: 10,
			monthlyEventCap: 300,
			pollIntervalMs: 3000,
			seats: 1,
		},
		features: [
			{ label: "1 channel, 1 device", included: true },
			{ label: "10 webhooks / day", included: true },
			{ label: "3-day event retention", included: true },
			{ label: "Replay with chain view", included: true },
			{ label: "Real-time push (SSE)", included: true },
		],
		cta: "Sign in",
	},
	trialing: {
		// Legacy: kept for users whose accounts were created during the 7-day
		// trial flow. New signups go straight to `free`. Limits mirror Hobby
		// because that's what the trial used to grant.
		id: "trialing",
		name: "Trial",
		tagline: "Full Hobby features for 7 days.",
		priceMonthlyCents: 0,
		limits: {
			maxChannels: 5,
			maxDevices: 2,
			retentionDays: 7,
			eventsPerDay: Number.POSITIVE_INFINITY,
			monthlyEventCap: 1_000,
			pollIntervalMs: 3000,
			seats: 1,
		},
		features: [],
		cta: "",
	},
	hobby: {
		id: "hobby",
		name: "Hobby",
		tagline: "Solo devs poking at one or two webhook integrations.",
		priceMonthlyCents: 200,
		limits: {
			maxChannels: 5,
			maxDevices: 2,
			retentionDays: 7,
			eventsPerDay: Number.POSITIVE_INFINITY,
			monthlyEventCap: 1_000,
			pollIntervalMs: 3000,
			seats: 1,
		},
		features: [
			{ label: "5 channels, 2 devices", included: true },
			{ label: "7-day event retention", included: true },
			{ label: "1,000 events / month", included: true },
			{ label: "Unlimited replay with chain view", included: true },
			{ label: "3-second polling", included: true },
			{ label: "Email support", included: true },
			{ label: "Body search", included: false, hint: "Pro" },
			{ label: "Webhook signature presets", included: false, hint: "Pro" },
			{ label: "Shared channels", included: false, hint: "Team" },
		],
		cta: "Subscribe",
	},
	pro: {
		id: "pro",
		name: "Pro",
		tagline: "Full-time devs with multiple integrations and faster feedback loops.",
		priceMonthlyCents: 900,
		limits: {
			maxChannels: Number.POSITIVE_INFINITY,
			maxDevices: Number.POSITIVE_INFINITY,
			retentionDays: 30,
			eventsPerDay: Number.POSITIVE_INFINITY,
			monthlyEventCap: 100_000,
			pollIntervalMs: 1000,
			seats: 1,
		},
		features: [
			{ label: "Unlimited channels and devices", included: true },
			{ label: "30-day event retention", included: true },
			{ label: "100,000 events / month", included: true },
			{ label: "Body search (full-text)", included: true },
			{
				label: "Webhook signature presets — Stripe, Paystack, GitHub, Shopify, Slack",
				included: true,
			},
			{ label: "Mock response settings", included: true },
			{ label: "1-second polling (SSE push when available)", included: true },
			{ label: "Custom retention (1–30 days)", included: true },
			{ label: "Priority email support", included: true },
		],
		cta: "Upgrade to Pro",
		highlighted: true,
	},
	team: {
		id: "team",
		name: "Team",
		tagline: "Small teams sharing webhook test environments.",
		priceMonthlyCents: 2900,
		limits: {
			maxChannels: Number.POSITIVE_INFINITY,
			maxDevices: Number.POSITIVE_INFINITY,
			retentionDays: 90,
			eventsPerDay: Number.POSITIVE_INFINITY,
			monthlyEventCap: 500_000,
			pollIntervalMs: 1000,
			seats: 5,
		},
		features: [
			{ label: "Everything in Pro", included: true },
			{ label: "Up to 5 seats", included: true },
			{ label: "Shared channels — team members see each other's events", included: true },
			{ label: "Per-user audit log", included: true },
			{ label: "90-day event retention", included: true },
			{ label: "500,000 events / month", included: true },
			{ label: "Slack / Discord notifications on filtered events", included: true },
			{ label: "Private webhook IP allowlists", included: true },
		],
		cta: "Get Team",
	},
	selfhost: {
		id: "selfhost",
		name: "Self-host",
		tagline: "You bring the infra; we bring the source.",
		priceMonthlyCents: 0,
		limits: {
			maxChannels: Number.POSITIVE_INFINITY,
			maxDevices: Number.POSITIVE_INFINITY,
			retentionDays: Number.POSITIVE_INFINITY,
			eventsPerDay: Number.POSITIVE_INFINITY,
			monthlyEventCap: Number.POSITIVE_INFINITY,
			pollIntervalMs: 1000,
			seats: Number.POSITIVE_INFINITY,
		},
		features: [],
		cta: "",
	},
};

export function formatPrice(cents: number): string {
	if (cents === 0) return "Free";
	const dollars = cents / 100;
	if (dollars % 1 === 0) return `$${dollars}`;
	return `$${dollars.toFixed(2)}`;
}

/**
 * Tiers shown on the Billing page's checkout grid. Empty at launch — paid
 * is dormant until you flip `POLAR_*` env vars on. To re-enable, add
 * `"hobby", "pro", "team"` back here.
 */
export const PUBLIC_PLAN_ORDER: PlanId[] = [];
