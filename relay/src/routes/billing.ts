import type { PlanId } from "@bridgehook/shared";
/**
 * Billing routes — Polar checkout + customer portal + webhook.
 *
 * Three endpoints:
 *   - POST /api/me/billing/checkout — session-authed; creates a Polar
 *     checkout for the requested plan; returns the URL to redirect to.
 *   - GET  /api/me/billing/portal   — session-authed; returns a one-time
 *     Polar customer portal URL for the user.
 *   - POST /api/billing/webhook     — public, signature-verified; flips
 *     users.plan and upserts the subscriptions row.
 *
 * Self-host mode (POLAR_ACCESS_TOKEN unset) returns 503 on the first two
 * and 404 on the webhook. Self-hosters don't need any of this.
 */
import { subscriptions, user } from "@bridgehook/shared/db/schema";
import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/neon-http";
import { Hono } from "hono";
import { type Auth, getSessionUser } from "../auth.js";
import {
	type PolarClient,
	createCheckoutSession,
	createCustomerPortalUrl,
	resolvePlanFromProduct,
	verifyPolarWebhook,
} from "../billing.js";

type DB = ReturnType<typeof drizzle>;

export interface BillingEnv {
	auth: Auth;
	db: DB;
	polar: PolarClient;
	webhookSecret?: string;
	webUrl: string;
}

export function buildBillingRoutes(getDeps: (c: { env: unknown }) => BillingEnv | null) {
	const app = new Hono();

	// ── POST /api/me/billing/checkout ──────────────────────────────────────
	app.post("/me/billing/checkout", async (c) => {
		const deps = getDeps(c);
		if (!deps) return c.json({ error: "Billing not configured" }, 503);

		const sessionUser = await getSessionUser(deps.auth, c.req.raw);
		if (!sessionUser) return c.json({ error: "Not signed in" }, 401);

		const body = await c.req.json().catch(() => null);
		const plan = (body as { plan?: unknown } | null)?.plan;
		if (typeof plan !== "string" || !["hobby", "pro", "team"].includes(plan)) {
			return c.json({ error: "plan must be 'hobby' | 'pro' | 'team'" }, 400);
		}
		const productId = deps.polar.productIds[plan as "hobby" | "pro" | "team"];
		if (!productId) {
			return c.json({ error: `Plan '${plan}' is not configured on this deployment.` }, 400);
		}

		const successUrl = `${deps.webUrl.replace(/\/$/, "")}/dashboard/billing?upgraded=1`;

		try {
			const checkout = await createCheckoutSession(deps.polar, {
				productId,
				customerEmail: sessionUser.email,
				customerExternalId: sessionUser.id,
				successUrl,
			});
			return c.json({ url: checkout.url, checkoutId: checkout.id });
		} catch (err) {
			console.error("Polar checkout error:", err);
			return c.json({ error: "Could not create checkout session" }, 502);
		}
	});

	// ── GET /api/me/billing/portal ──────────────────────────────────────────
	app.get("/me/billing/portal", async (c) => {
		const deps = getDeps(c);
		if (!deps) return c.json({ error: "Billing not configured" }, 503);

		const sessionUser = await getSessionUser(deps.auth, c.req.raw);
		if (!sessionUser) return c.json({ error: "Not signed in" }, 401);

		try {
			const url = await createCustomerPortalUrl(deps.polar, sessionUser.id);
			if (!url) {
				return c.json(
					{ error: "No active subscription. Subscribe first to access the portal." },
					404,
				);
			}
			return c.json({ url });
		} catch (err) {
			console.error("Polar portal error:", err);
			return c.json({ error: "Could not create portal session" }, 502);
		}
	});

	// ── POST /api/billing/webhook ──────────────────────────────────────────
	// Verifies the signature on the raw body, then upserts subscriptions
	// and flips users.plan. Idempotent on subscription_id so retries from
	// Polar are safe.
	app.post("/billing/webhook", async (c) => {
		const deps = getDeps(c);
		if (!deps) return c.json({ error: "Not Found" }, 404);
		if (!deps.webhookSecret) {
			console.error("POLAR_WEBHOOK_SECRET is not configured");
			return c.json({ error: "Webhook not configured" }, 503);
		}

		const rawBody = await c.req.raw.text();
		const verified = await verifyPolarWebhook(rawBody, c.req.raw.headers, deps.webhookSecret);
		if (!verified) {
			console.warn("Polar webhook signature verification failed");
			return c.json({ error: "Invalid signature" }, 401);
		}

		let event: { type?: unknown; data?: unknown };
		try {
			event = JSON.parse(rawBody);
		} catch {
			return c.json({ error: "Invalid JSON" }, 400);
		}

		const type = typeof event.type === "string" ? event.type : "";
		const data = event.data as Record<string, unknown> | undefined;
		if (!data) return c.json({ ok: true, ignored: type });

		console.log("[polar webhook]", type);

		// Subscription lifecycle events (created, updated, canceled, etc.)
		if (type.startsWith("subscription.")) {
			await applySubscription(deps, data, type);
		}

		// Acknowledge — return 200 so Polar doesn't retry.
		return c.json({ ok: true });
	});

	return app;
}

async function applySubscription(
	deps: BillingEnv,
	data: Record<string, unknown>,
	eventType: string,
) {
	const subscriptionId = stringField(data, "id");
	const status = stringField(data, "status"); // active | trialing | canceled | past_due | incomplete | revoked
	const productId = stringField(data, "product_id") || deepProductId(data);
	const customerExternalId =
		stringField(data, "customer_external_id") || (stringField(data, "metadata.userId") ?? null);
	const customerId = stringField(data, "customer_id") || stringField(data, "customer.id");
	const currentPeriodEnd = stringField(data, "current_period_end");
	const cancelAtPeriodEnd = boolField(data, "cancel_at_period_end") ?? false;

	if (!subscriptionId || !status || !customerExternalId || !customerId) {
		console.warn("Polar webhook missing required fields", {
			subscriptionId,
			status,
			customerExternalId,
			customerId,
		});
		return;
	}

	const periodEnd = currentPeriodEnd ? new Date(currentPeriodEnd) : new Date();

	await deps.db
		.insert(subscriptions)
		.values({
			userId: customerExternalId,
			status,
			provider: "polar",
			customerId,
			subscriptionId,
			currentPeriodEnd: periodEnd,
			cancelAtPeriodEnd,
		})
		.onConflictDoUpdate({
			target: subscriptions.userId,
			set: {
				status,
				provider: "polar",
				customerId,
				subscriptionId,
				currentPeriodEnd: periodEnd,
				cancelAtPeriodEnd,
				updatedAt: new Date(),
			},
		});

	// Flip users.plan to mirror the subscription's effective tier. We map
	// cleanly via the product id; unknown product ids fall back to whatever
	// the status implies.
	let plan: PlanId | null = null;
	if (status === "active" || status === "trialing") {
		if (productId) plan = resolvePlanFromProduct(deps.polar, productId);
		if (!plan) plan = "hobby"; // safe default if product mapping is missing
	} else if (status === "past_due") {
		plan = null; // leave plan as-is — the read-only banner is driven by status
	} else if (status === "canceled" || status === "revoked") {
		plan = "trialing"; // explicit downgrade — same lock UX as expired trial
	}

	if (plan) {
		await deps.db.update(user).set({ plan }).where(eq(user.id, customerExternalId));
	}

	console.log(
		`[polar] applied ${eventType} for user=${customerExternalId} status=${status} plan=${plan}`,
	);
}

function stringField(obj: Record<string, unknown>, dottedPath: string): string | null {
	const parts = dottedPath.split(".");
	let cur: unknown = obj;
	for (const p of parts) {
		if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
			cur = (cur as Record<string, unknown>)[p];
		} else {
			return null;
		}
	}
	return typeof cur === "string" ? cur : null;
}

function boolField(obj: Record<string, unknown>, key: string): boolean | null {
	const v = obj[key];
	return typeof v === "boolean" ? v : null;
}

function deepProductId(data: Record<string, unknown>): string | null {
	// Polar nests product info under .product.id sometimes.
	if (data.product && typeof data.product === "object") {
		const p = data.product as Record<string, unknown>;
		if (typeof p.id === "string") return p.id;
	}
	return null;
}
