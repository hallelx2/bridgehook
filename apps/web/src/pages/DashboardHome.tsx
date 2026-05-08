/**
 * Account home page. Summary tiles + recent activity + channels card +
 * devices card. Pulls everything in parallel from /api/me/* on mount.
 *
 * In self-host mode the AuthGate has already let us through; we still
 * render this page (it works with the implicit user once /api/me is
 * extended, which is a Phase 2 improvement). For now self-host users
 * see a small notice and a link to the legacy single-channel view.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { DashboardLayout } from "../components/DashboardLayout";
import { useConfig } from "../lib/config";
import { type MeChannel, type MeDevice, type MeEvent, type MeUser, me } from "../lib/me-api";
import { Dashboard as LegacyDashboard } from "./Dashboard";

export function DashboardHome() {
	const { config, loading } = useConfig();

	if (loading)
		return (
			<DashboardLayout>
				<Loading />
			</DashboardLayout>
		);

	if (!config?.authEnabled) {
		// Self-host falls back to the existing single-channel UI for now.
		// Multi-channel under implicit user is a Phase 2 improvement.
		return <LegacyDashboard />;
	}

	return (
		<DashboardLayout>
			<HostedHome />
		</DashboardLayout>
	);
}

function HostedHome() {
	const [user, setUser] = useState<MeUser | null>(null);
	const [channels, setChannels] = useState<MeChannel[] | null>(null);
	const [devices, setDevices] = useState<MeDevice[] | null>(null);
	const [recent, setRecent] = useState<MeEvent[] | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let alive = true;
		Promise.all([me.get(), me.channels.list(), me.devices.list(), me.events.feed({ limit: 8 })])
			.then(([u, c, d, e]) => {
				if (!alive) return;
				setUser(u);
				setChannels(c.channels);
				setDevices(d.devices);
				setRecent(e.events);
			})
			.catch((err) => {
				if (alive) setError(err instanceof Error ? err.message : String(err));
			});
		return () => {
			alive = false;
		};
	}, []);

	if (error) return <ErrorBox message={error} />;
	if (!user || !channels || !devices || !recent) return <Loading />;

	const totalEvents24h = channels.reduce((sum, c) => sum + c.stats.count24h, 0);

	return (
		<div className="space-y-8">
			{user.plan === "trialing" && user.trialEndsAt ? (
				<TrialBanner trialEndsAt={user.trialEndsAt} />
			) : null}

			{/* Summary tiles */}
			<section className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
				<Tile label="Channels" value={channels.length} />
				<Tile label="Active devices" value={devices.length} />
				<Tile label="Events (24h)" value={totalEvents24h} />
				<Tile label="Plan" value={user.plan} subdued />
			</section>

			{/* Recent activity + channels */}
			<section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
				<div className="lg:col-span-2 rounded-lg border border-gray-900 bg-gray-950">
					<div className="flex items-center justify-between px-4 py-3 border-b border-gray-900">
						<h2 className="text-sm font-medium text-gray-200">Recent activity</h2>
						<Link to="/dashboard/events" className="text-xs text-cyan-400 hover:underline">
							View all events →
						</Link>
					</div>
					{recent.length === 0 ? (
						<EmptyRow text="No events yet. Send a webhook to one of your channels." />
					) : (
						<ul className="divide-y divide-gray-900">
							{recent.map((e) => (
								<RecentEventRow key={e.id} event={e} />
							))}
						</ul>
					)}
				</div>

				<div className="rounded-lg border border-gray-900 bg-gray-950">
					<div className="flex items-center justify-between px-4 py-3 border-b border-gray-900">
						<h2 className="text-sm font-medium text-gray-200">Channels</h2>
						<Link to="/dashboard/channels" className="text-xs text-cyan-400 hover:underline">
							Manage →
						</Link>
					</div>
					{channels.length === 0 ? (
						<EmptyRow text="No channels yet. Pair a device to create one." />
					) : (
						<ul className="divide-y divide-gray-900">
							{channels.slice(0, 5).map((c) => (
								<li key={c.id} className="px-4 py-3 text-sm">
									<div className="flex items-center justify-between gap-2">
										<div className="min-w-0">
											<div className="font-mono text-gray-200 truncate">{c.label || c.id}</div>
											<div className="text-xs text-gray-500 mt-0.5">
												port {c.port} · {c.stats.count24h} in 24h
											</div>
										</div>
									</div>
								</li>
							))}
						</ul>
					)}
				</div>
			</section>

			{/* Devices */}
			<section className="rounded-lg border border-gray-900 bg-gray-950">
				<div className="flex items-center justify-between px-4 py-3 border-b border-gray-900">
					<h2 className="text-sm font-medium text-gray-200">Devices</h2>
					<Link to="/dashboard/devices" className="text-xs text-cyan-400 hover:underline">
						Manage →
					</Link>
				</div>
				{devices.length === 0 ? (
					<EmptyRow text="No devices paired. Sign in to BridgeHook from the extension popup to pair." />
				) : (
					<ul className="divide-y divide-gray-900">
						{devices.map((d) => (
							<li key={d.id} className="flex items-center justify-between px-4 py-3 text-sm">
								<div>
									<div className="text-gray-200">{d.label}</div>
									<div className="text-xs text-gray-500">
										{d.kind} · {d.lastSeenAt ? formatRelative(d.lastSeenAt) : "never"}
									</div>
								</div>
							</li>
						))}
					</ul>
				)}
			</section>
		</div>
	);
}

// ── Bits ──────────────────────────────────────────────────────────────────

function Tile({
	label,
	value,
	subdued,
}: {
	label: string;
	value: string | number;
	subdued?: boolean;
}) {
	return (
		<div className="rounded-lg border border-gray-900 bg-gray-950 px-4 py-3">
			<div className="text-[11px] uppercase tracking-wider text-gray-500">{label}</div>
			<div
				className={`mt-1 text-2xl font-semibold ${
					subdued ? "text-gray-300" : "text-gray-100"
				} font-mono`}
			>
				{value}
			</div>
		</div>
	);
}

function RecentEventRow({ event }: { event: MeEvent }) {
	return (
		<li className="px-4 py-2.5 text-sm flex items-center gap-3 hover:bg-gray-900/40">
			<MethodPill method={event.method} />
			<span className="font-mono text-gray-300 truncate flex-1">{event.path}</span>
			<StatusPill status={event.responseStatus} kind={event.kind} />
			<span className="text-xs text-gray-500 tabular-nums w-20 text-right">
				{formatRelative(event.receivedAt)}
			</span>
		</li>
	);
}

function MethodPill({ method }: { method: string }) {
	const color =
		method === "GET"
			? "text-blue-400 border-blue-900/60"
			: method === "POST"
				? "text-green-400 border-green-900/60"
				: method === "DELETE"
					? "text-red-400 border-red-900/60"
					: "text-gray-400 border-gray-800";
	return (
		<span className={`text-[10px] font-mono uppercase border rounded px-1.5 py-0.5 ${color}`}>
			{method}
		</span>
	);
}

function StatusPill({
	status,
	kind,
}: {
	status: number | null;
	kind: "live" | "replay";
}) {
	if (status === null) {
		return (
			<span className="text-[10px] font-mono text-amber-400 border border-amber-900/60 rounded px-1.5 py-0.5">
				pending
			</span>
		);
	}
	const color =
		status >= 200 && status < 300
			? "text-green-400 border-green-900/60"
			: status >= 400 && status < 500
				? "text-amber-400 border-amber-900/60"
				: status >= 500
					? "text-red-400 border-red-900/60"
					: "text-gray-400 border-gray-800";
	return (
		<span className="flex items-center gap-1">
			<span className={`text-[10px] font-mono border rounded px-1.5 py-0.5 ${color}`}>
				{status}
			</span>
			{kind === "replay" ? (
				<span className="text-[10px] font-mono text-purple-400 border border-purple-900/60 rounded px-1.5 py-0.5">
					replay
				</span>
			) : null}
		</span>
	);
}

function TrialBanner({ trialEndsAt }: { trialEndsAt: string }) {
	const days = Math.max(0, Math.ceil((Date.parse(trialEndsAt) - Date.now()) / 86400000));
	return (
		<div className="rounded-lg border border-cyan-900/50 bg-cyan-950/20 px-4 py-3 text-sm flex items-center justify-between gap-4">
			<div>
				<div className="font-medium text-cyan-300">
					{days > 0 ? `Trial: ${days} day${days === 1 ? "" : "s"} left` : "Trial ended"}
				</div>
				<div className="text-xs text-cyan-400/70 mt-0.5">
					{days > 0
						? "Add a card before it expires to keep using BridgeHook."
						: "Add a card to restore full access."}
				</div>
			</div>
			<Link
				to="/dashboard/billing"
				className="rounded-md bg-cyan-500 hover:bg-cyan-400 text-gray-950 font-medium px-3 py-1.5 text-xs"
			>
				Add a card
			</Link>
		</div>
	);
}

function EmptyRow({ text }: { text: string }) {
	return <div className="px-4 py-6 text-sm text-gray-500 text-center">{text}</div>;
}

function Loading() {
	return <div className="text-sm text-gray-500 font-mono py-12 text-center">loading…</div>;
}

function ErrorBox({ message }: { message: string }) {
	return (
		<DashboardLayout>
			<div className="rounded-md border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">
				{message}
			</div>
		</DashboardLayout>
	);
}

function formatRelative(iso: string): string {
	const ms = Date.now() - Date.parse(iso);
	if (ms < 60_000) return `${Math.max(1, Math.floor(ms / 1000))}s ago`;
	if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
	if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
	return `${Math.floor(ms / 86_400_000)}d ago`;
}
