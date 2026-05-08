/**
 * Shell for all /dashboard/* routes. Sidebar + topbar; children render in
 * the main column. Active link is derived from the current pathname.
 *
 * In self-host mode the topbar's account chip is replaced with a
 * "Self-hosted" badge; the Sign out button hides.
 *
 * When the relay reports `readOnly: true` (expired trial / canceled sub),
 * a sticky banner above the content blocks the user's attention until they
 * reach Billing.
 */
import { type ReactNode, useEffect, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { signOut, useSession } from "../lib/auth-client";
import { useConfig } from "../lib/config";
import { type MeUser, me } from "../lib/me-api";
import { Logo } from "./Logo";

const NAV = [
	{ to: "/dashboard", label: "Overview", end: true },
	{ to: "/dashboard/events", label: "Events" },
	{ to: "/dashboard/channels", label: "Channels" },
	{ to: "/dashboard/devices", label: "Devices" },
	{ to: "/dashboard/billing", label: "Billing" },
	{ to: "/dashboard/settings", label: "Settings" },
];

export function DashboardLayout({ children }: { children: ReactNode }) {
	const { config } = useConfig();
	const { data: session } = useSession();
	const navigate = useNavigate();
	const [meUser, setMeUser] = useState<MeUser | null>(null);

	// One small extra request per dashboard mount is cheap and keeps this
	// banner self-contained — no shared state plumbing to per-page fetches.
	useEffect(() => {
		if (!config?.authEnabled) return;
		let alive = true;
		me.get()
			.then((u) => {
				if (alive) setMeUser(u);
			})
			.catch(() => {
				/* swallow — banner just won't render */
			});
		return () => {
			alive = false;
		};
	}, [config?.authEnabled]);

	async function onSignOut() {
		await signOut();
		navigate("/login", { replace: true });
	}

	return (
		<div className="min-h-screen bg-gray-950 text-gray-100">
			{/* Top bar */}
			<header className="border-b border-gray-900 bg-gray-950/80 backdrop-blur sticky top-0 z-10">
				<div className="flex items-center justify-between px-6 py-3">
					<Link to="/dashboard" className="inline-flex items-center gap-2">
						<Logo />
					</Link>
					<div className="flex items-center gap-3 text-xs">
						{config?.authEnabled && session?.user ? (
							<>
								<span className="text-gray-400 font-mono">{session.user.email}</span>
								<button
									type="button"
									onClick={onSignOut}
									className="text-gray-500 hover:text-gray-200"
								>
									Sign out
								</button>
							</>
						) : config && !config.authEnabled ? (
							<span className="rounded-md border border-gray-800 bg-gray-900 px-2 py-1 text-gray-400">
								self-hosted
							</span>
						) : null}
					</div>
				</div>
			</header>

			{/* Body: sidebar + content */}
			<div className="flex">
				<aside className="w-56 shrink-0 border-r border-gray-900 px-3 py-4">
					<nav className="space-y-0.5">
						{NAV.map((item) => (
							<NavLink
								key={item.to}
								to={item.to}
								end={item.end}
								className={({ isActive }) =>
									[
										"block rounded-md px-3 py-1.5 text-sm transition-colors",
										isActive
											? "bg-gray-900 text-cyan-400 font-medium"
											: "text-gray-400 hover:bg-gray-900/60 hover:text-gray-200",
									].join(" ")
								}
							>
								{item.label}
							</NavLink>
						))}
					</nav>
				</aside>
				<main className="flex-1 min-w-0 px-8 py-6">
					{meUser?.readOnly ? <ReadOnlyBanner reason={meUser.readOnlyReason} /> : null}
					{children}
				</main>
			</div>
		</div>
	);
}

function ReadOnlyBanner({ reason }: { reason: "trial-expired" | "subscription-canceled" | null }) {
	const headline =
		reason === "trial-expired"
			? "Your trial has ended."
			: reason === "subscription-canceled"
				? "Your subscription was canceled."
				: "Your account is read-only.";
	const body =
		reason === "subscription-canceled"
			? "Past events are still readable, but creating channels, pairing devices, and replaying are paused. Resubscribe to restore access."
			: "Past events are still readable, but creating channels, pairing devices, and replaying are paused. Subscribe to keep going.";
	return (
		<div className="mb-6 rounded-lg border border-amber-900/60 bg-amber-950/30 px-4 py-3 flex items-center justify-between gap-4">
			<div>
				<p className="text-sm font-semibold text-amber-200">{headline}</p>
				<p className="text-xs text-amber-300/80 mt-0.5">{body}</p>
			</div>
			<Link
				to="/dashboard/billing"
				className="shrink-0 rounded-md bg-amber-500 hover:bg-amber-400 text-amber-950 px-3 py-1.5 text-xs font-medium"
			>
				Subscribe
			</Link>
		</div>
	);
}
