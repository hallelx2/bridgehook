/**
 * Shell for all /dashboard/* routes. Sidebar + topbar; children render in
 * the main column. Active link is derived from the current pathname.
 *
 * In self-host mode the topbar's account chip is replaced with a
 * "Self-hosted" badge; the Sign out button hides.
 */
import type { ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { signOut, useSession } from "../lib/auth-client";
import { useConfig } from "../lib/config";
import { Logo } from "./Logo";

const NAV = [
	{ to: "/dashboard", label: "Overview", end: true },
	{ to: "/dashboard/events", label: "Events" },
	{ to: "/dashboard/channels", label: "Channels" },
	{ to: "/dashboard/devices", label: "Devices" },
	{ to: "/dashboard/settings", label: "Settings" },
];

export function DashboardLayout({ children }: { children: ReactNode }) {
	const { config } = useConfig();
	const { data: session } = useSession();
	const navigate = useNavigate();

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
				<main className="flex-1 min-w-0 px-8 py-6">{children}</main>
			</div>
		</div>
	);
}
