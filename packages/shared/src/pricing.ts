/**
 * Single source of truth for pricing tiers. Drives:
 *   - Web Billing page render
 *   - Relay quota enforcement (commit 14+)
 *   - Polar product configuration (set the productId env var to match)
 *
 * Self-host mode bypasses real quotas — the implicit user is assigned the
 * `selfhost` tier (see relay/src/identity.ts), which has Infinity limits and
 * is excluded from {@link PUBLIC_PLAN_ORDER} so the Billing page never lists it.
 */

/**
 * `selfhost` is an internal-only tier carried by the implicit user that
 * self-hosted relays write to. The access layer treats it as unlimited and
 * never read-only. It does NOT appear in {@link PUBLIC_PLAN_ORDER}.
 */
export type PlanId = "trialing" | "hobby" | "pro" | "team" | "selfhost";

export interface PlanLimits {
	/** Active channels per user. Infinity = unbounded. */
	maxChannels: number;
	/** Active (non-revoked) devices per user. */
	maxDevices: number;
	/** Event retention window in days. */
	retentionDays: number;
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
	trialing: {
		id: "trialing",
		name: "Trial",
		tagline: "Full access for 7 days. No card required.",
		priceMonthlyCents: 0,
		limits: {
			maxChannels: 5,
			maxDevices: 2,
			retentionDays: 7,
			monthlyEventCap: 1_000,
			pollIntervalMs: 3000,
			seats: 1,
		},
		features: [
			{ label: "All Hobby features for 7 days", included: true },
			{
				label: "Account locks to read-only after trial",
				included: true,
				hint: "subscribe before day 7 to keep going",
			},
		],
		cta: "Start trial",
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

export const PUBLIC_PLAN_ORDER: PlanId[] = ["hobby", "pro", "team"];
