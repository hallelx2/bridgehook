/**
 * Devices list page. Paired extension/desktop/CLI instances with rename
 * and revoke. Last-seen timestamps drive the "online" indicator.
 */
import { useEffect, useState } from "react";
import { DashboardLayout } from "../components/DashboardLayout";
import { type MeDevice, me } from "../lib/me-api";

const ONLINE_WINDOW_MS = 60 * 1000;

export function DevicesList() {
	return (
		<DashboardLayout>
			<DevicesView />
		</DashboardLayout>
	);
}

function DevicesView() {
	const [devices, setDevices] = useState<MeDevice[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [editingId, setEditingId] = useState<string | null>(null);
	const [draftLabel, setDraftLabel] = useState("");

	useEffect(() => {
		me.devices
			.list()
			.then((d) => setDevices(d.devices))
			.catch((err) => setError(err instanceof Error ? err.message : String(err)));
	}, []);

	async function saveLabel(id: string) {
		const trimmed = draftLabel.trim();
		if (!trimmed) {
			setEditingId(null);
			return;
		}
		try {
			const r = await me.devices.rename(id, trimmed);
			setDevices((prev) =>
				prev ? prev.map((d) => (d.id === id ? { ...d, label: r.device.label } : d)) : prev,
			);
			setEditingId(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}

	async function revoke(id: string, label: string) {
		if (!window.confirm(`Revoke "${label}"? It will lose access immediately.`)) return;
		try {
			await me.devices.revoke(id);
			setDevices((prev) => (prev ? prev.filter((d) => d.id !== id) : prev));
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}

	if (error) {
		return (
			<div className="rounded-md border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">
				{error}
			</div>
		);
	}
	if (!devices)
		return <div className="text-sm text-gray-500 py-12 text-center font-mono">loading…</div>;

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<h1 className="text-xl font-semibold">Devices</h1>
				<div className="text-xs text-gray-500 font-mono">{devices.length} active</div>
			</div>

			{devices.length === 0 ? (
				<div className="rounded-lg border border-gray-900 bg-gray-950 p-8 text-center">
					<p className="text-sm text-gray-400">No devices paired.</p>
					<p className="text-xs text-gray-500 mt-1">
						Open the BridgeHook extension popup and click{" "}
						<span className="text-gray-300">Sign in</span> to pair this browser.
					</p>
				</div>
			) : (
				<div className="rounded-lg border border-gray-900 bg-gray-950 overflow-hidden">
					<div className="grid grid-cols-[16px_minmax(0,1.5fr)_88px_minmax(0,1fr)_96px_64px] gap-3 px-4 py-2 border-b border-gray-900 text-[10px] uppercase tracking-wider text-gray-500">
						<div />
						<div>Device</div>
						<div>Kind</div>
						<div>OS / UA</div>
						<div>Last seen</div>
						<div className="text-right">Actions</div>
					</div>
					<ul>
						{devices.map((d) => {
							const lastSeenMs = d.lastSeenAt ? Date.now() - Date.parse(d.lastSeenAt) : null;
							const online = lastSeenMs !== null && lastSeenMs < ONLINE_WINDOW_MS;
							return (
								<li
									key={d.id}
									className="grid grid-cols-[16px_minmax(0,1.5fr)_88px_minmax(0,1fr)_96px_64px] gap-3 px-4 py-3 border-b border-gray-900 items-center text-sm hover:bg-gray-900/40"
								>
									<span
										className={`inline-block h-2 w-2 rounded-full ${
											online ? "bg-green-400" : "bg-gray-700"
										}`}
										title={online ? "Active recently" : "Idle"}
									/>
									<div className="min-w-0">
										{editingId === d.id ? (
											<form
												onSubmit={(e) => {
													e.preventDefault();
													saveLabel(d.id);
												}}
											>
												<input
													type="text"
													// biome-ignore lint/a11y/noAutofocus: inline edit affordance — focus on entry is the expected UX
													autoFocus
													value={draftLabel}
													onChange={(e) => setDraftLabel(e.target.value)}
													onBlur={() => saveLabel(d.id)}
													className="bg-gray-900 border border-cyan-500 rounded px-2 py-0.5 text-sm w-full"
												/>
											</form>
										) : (
											<button
												type="button"
												onClick={() => {
													setDraftLabel(d.label);
													setEditingId(d.id);
												}}
												className="text-gray-200 truncate text-left hover:text-cyan-400 w-full"
											>
												{d.label}
											</button>
										)}
										<div className="text-[11px] text-gray-500 mt-0.5 font-mono">{d.id}</div>
									</div>
									<div className="text-xs text-gray-400">{d.kind}</div>
									<div className="text-xs text-gray-500 truncate" title={d.userAgent ?? ""}>
										{d.os || d.userAgent || "—"}
									</div>
									<div className="text-xs text-gray-500">
										{d.lastSeenAt ? formatRelative(d.lastSeenAt) : "never"}
									</div>
									<div className="text-right">
										<button
											type="button"
											onClick={() => revoke(d.id, d.label)}
											className="text-xs text-gray-500 hover:text-red-400"
										>
											Revoke
										</button>
									</div>
								</li>
							);
						})}
					</ul>
				</div>
			)}
		</div>
	);
}

function formatRelative(iso: string): string {
	const ms = Date.now() - Date.parse(iso);
	if (ms < 60_000) return `${Math.max(1, Math.floor(ms / 1000))}s`;
	if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
	if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
	return `${Math.floor(ms / 86_400_000)}d`;
}
