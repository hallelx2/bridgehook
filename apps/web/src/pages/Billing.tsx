import {
	PLANS,
	PUBLIC_PLAN_ORDER,
	type PlanDef,
	type PlanId,
	formatPrice,
} from "@bridgehook/shared";
/**
 * Billing page — pricing tiers + Subscribe / Manage actions.
 *
 * Hosted mode only: in self-host (config.authEnabled === false) the page
 * shows a self-host notice and no checkout buttons.
 *
 * The success URL of a Polar checkout returns the user here with
 * ?upgraded=1 — we surface a confirmation banner. The actual plan flip
 * happens via the relay's webhook handler on Polar's side, so it may
 * lag the redirect by a second or two.
 */
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { DashboardLayout } from "../components/DashboardLayout";
import { useConfig } from "../lib/config";
import { type MeUser, me } from "../lib/me-api";

const RELAY_URL = import.meta.env.VITE_RELAY_URL || "http://localhost:8787";

export function Billing() {
	return (
		<DashboardLayout>
			<BillingView />
		</DashboardLayout>
	);
}

function BillingView() {
	const { config } = useConfig();
	const [search] = useSearchParams();
	const upgraded = search.get("upgraded") === "1";

	const [user, setUser] = useState<MeUser | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState<string | null>(null);

	const refresh = async () => {
		try {
			const u = await me.get();
			setUser(u);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: refresh is a stable reference for this component's lifetime; we only want to run on mount.
	useEffect(() => {
		refresh();
	}, []);

	// Poll briefly after a successful checkout so the dashboard reflects the
	// new plan as soon as the webhook lands.
	// biome-ignore lint/correctness/useExhaustiveDependencies: refresh is intentionally not in deps — including it would restart the poll on every render.
	useEffect(() => {
		if (!upgraded) return;
		const id = setInterval(refresh, 2000);
		const stop = setTimeout(() => clearInterval(id), 30_000);
		return () => {
			clearInterval(id);
			clearTimeout(stop);
		};
	}, [upgraded]);

	if (config && !config.authEnabled) {
		return (
			<div className="rounded-lg border border-gray-900 bg-gray-950 p-6 max-w-2xl">
				<h1 className="text-lg font-semibold mb-2">Self-hosted instance</h1>
				<p className="text-sm text-gray-400">
					Billing is disabled. This deployment is running unmetered against the implicit single
					user.
				</p>
			</div>
		);
	}

	if (config?.authEnabled && !config.billingEnabled) {
		return (
			<div className="rounded-lg border border-gray-900 bg-gray-950 p-6 max-w-2xl">
				<h1 className="text-lg font-semibold mb-2">Billing not configured</h1>
				<p className="text-sm text-gray-400">
					This hosted instance does not have a payment provider wired up. Set the Polar env vars on
					the relay (POLAR_ACCESS_TOKEN and POLAR_PRODUCT_ID_*) to enable subscriptions.
				</p>
			</div>
		);
	}

	if (!user) {
		return error ? (
			<ErrorBox message={error} />
		) : (
			<div className="text-sm text-gray-500 py-12 text-center font-mono">loading…</div>
		);
	}

	async function checkout(plan: PlanId) {
		setBusy(plan);
		setError(null);
		try {
			const res = await fetch(`${RELAY_URL}/api/me/billing/checkout`, {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ plan }),
			});
			const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
			if (!res.ok || !data.url) {
				setError(data.error || `Checkout failed (${res.status})`);
				setBusy(null);
				return;
			}
			window.location.href = data.url;
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setBusy(null);
		}
	}

	async function openPortal() {
		setBusy("portal");
		setError(null);
		try {
			const res = await fetch(`${RELAY_URL}/api/me/billing/portal`, {
				credentials: "include",
			});
			const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
			if (!res.ok || !data.url) {
				setError(data.error || `Portal failed (${res.status})`);
				setBusy(null);
				return;
			}
			window.location.href = data.url;
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setBusy(null);
		}
	}

	const isTrialing = user.plan === "trialing";
	const subStatus = user.subscription?.status;
	const isPastDue = subStatus === "past_due";
	// Subscription exists and isn't fully canceled — gives access to the portal.
	const hasManageableSub =
		!!user.subscription && subStatus !== "canceled" && subStatus !== "revoked";
	const cancelingAtPeriodEnd = !!user.subscription?.cancelAtPeriodEnd;

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<h1 className="text-xl font-semibold">Billing</h1>
				{hasManageableSub ? (
					<button
						type="button"
						onClick={openPortal}
						disabled={busy === "portal"}
						className="rounded-md border border-gray-800 hover:border-cyan-500 hover:text-cyan-400 px-3 py-1.5 text-xs text-gray-300"
					>
						{busy === "portal" ? "Opening…" : "Manage subscription"}
					</button>
				) : null}
			</div>

			{upgraded ? (
				<div className="rounded-md border border-green-900/50 bg-green-950/20 px-4 py-3 text-sm text-green-300">
					Subscription confirmed — your account is updating. The dashboard will reflect the new plan
					within a few seconds.
				</div>
			) : null}

			{isTrialing && user.trialEndsAt ? <TrialBanner trialEndsAt={user.trialEndsAt} /> : null}

			{isPastDue ? (
				<div className="rounded-md border border-amber-900/50 bg-amber-950/20 px-4 py-3 text-sm text-amber-300">
					Payment past due. Open the portal to update your card.
				</div>
			) : null}

			{cancelingAtPeriodEnd && user.subscription ? (
				<div className="rounded-md border border-amber-900/50 bg-amber-950/20 px-4 py-3 text-sm text-amber-300">
					Subscription set to cancel on{" "}
					{new Date(user.subscription.currentPeriodEnd).toLocaleDateString()}. Open the portal to
					keep it active.
				</div>
			) : null}

			{error ? (
				<div className="rounded-md border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">
					{error}
				</div>
			) : null}

			{/* Tier cards */}
			<section className="grid grid-cols-1 md:grid-cols-3 gap-4">
				{PUBLIC_PLAN_ORDER.map((id) => (
					<PlanCard
						key={id}
						plan={PLANS[id]}
						currentPlan={user.plan}
						busy={busy}
						onCheckout={() => checkout(id)}
					/>
				))}
			</section>

			<p className="text-xs text-gray-500 max-w-2xl">
				Or self-host BridgeHook for free — clone the repo, deploy your own Cloudflare Worker + Neon
				DB, and you own the whole stack. MIT licensed; no quotas, no gates.
			</p>
		</div>
	);
}

function PlanCard({
	plan,
	currentPlan,
	busy,
	onCheckout,
}: {
	plan: PlanDef;
	currentPlan: PlanId;
	busy: string | null;
	onCheckout: () => void;
}) {
	const isCurrent = currentPlan === plan.id;
	return (
		<div
			className={`rounded-lg border bg-gray-950 p-5 flex flex-col ${
				plan.highlighted ? "border-cyan-500/50" : "border-gray-900"
			}`}
		>
			<div className="flex items-baseline justify-between mb-1">
				<h2 className="text-base font-semibold text-gray-100">{plan.name}</h2>
				{plan.highlighted ? (
					<span className="text-[10px] uppercase tracking-wider text-cyan-400 border border-cyan-500/40 rounded px-1.5 py-0.5">
						Recommended
					</span>
				) : null}
			</div>
			<p className="text-xs text-gray-500 mb-4 leading-relaxed min-h-[32px]">{plan.tagline}</p>
			<div className="mb-4">
				<span className="text-3xl font-semibold text-gray-100 font-mono">
					{formatPrice(plan.priceMonthlyCents)}
				</span>
				{plan.priceMonthlyCents > 0 ? (
					<span className="text-xs text-gray-500 ml-1">/ month</span>
				) : null}
			</div>
			<ul className="space-y-1.5 mb-5 text-xs flex-1">
				{plan.features.map((f) => (
					<li key={f.label} className="flex items-start gap-2">
						<span
							className={`mt-0.5 inline-block ${f.included ? "text-cyan-400" : "text-gray-700"}`}
						>
							{f.included ? "✓" : "—"}
						</span>
						<span className={f.included ? "text-gray-300" : "text-gray-600"}>
							{f.label}
							{f.hint && !f.included ? <span className="text-gray-600"> ({f.hint})</span> : null}
						</span>
					</li>
				))}
			</ul>
			<button
				type="button"
				onClick={onCheckout}
				disabled={isCurrent || busy !== null}
				className={`w-full rounded-md py-2 text-xs font-medium transition-colors ${
					isCurrent
						? "bg-gray-900 text-gray-500 cursor-default"
						: plan.highlighted
							? "bg-cyan-500 hover:bg-cyan-400 text-gray-950"
							: "bg-gray-900 hover:bg-gray-800 text-gray-200 border border-gray-800"
				}`}
			>
				{isCurrent ? "Current plan" : busy === plan.id ? "Opening checkout…" : plan.cta}
			</button>
		</div>
	);
}

function TrialBanner({ trialEndsAt }: { trialEndsAt: string }) {
	const days = Math.max(0, Math.ceil((Date.parse(trialEndsAt) - Date.now()) / 86_400_000));
	return (
		<div className="rounded-md border border-cyan-900/50 bg-cyan-950/20 px-4 py-3 text-sm text-cyan-300">
			{days > 0
				? `Trial: ${days} day${days === 1 ? "" : "s"} left. Subscribe before it ends to keep using BridgeHook without interruption.`
				: "Your trial has ended. Subscribe to restore access."}
		</div>
	);
}

function ErrorBox({ message }: { message: string }) {
	return (
		<div className="rounded-md border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">
			{message}
		</div>
	);
}
