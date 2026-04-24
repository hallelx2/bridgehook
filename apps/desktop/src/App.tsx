import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useCallback, useMemo, useState } from "react";
import { AddServiceForm } from "./components/AddServiceForm";
import { EventDetail } from "./components/EventDetail";
import { EventLog } from "./components/EventLog";
import { ImportForm } from "./components/ImportForm";
import { ResizeHandle } from "./components/ResizeHandle";
import { useBridge } from "./hooks/useBridge";
import { useEvents } from "./hooks/useEvents";
import { type PortProbe, type Service, useServices } from "./hooks/useServices";

export function App() {
	const {
		services,
		loading: servicesLoading,
		addService,
		removeService,
		toggleService,
		autoDetect,
		importFromExtension,
	} = useServices();
	const { events } = useEvents();
	const { isConnected, getError } = useBridge();

	const activeCount = services.filter((s) => s.active && isConnected(s.id)).length;
	const totalCount = services.length;

	const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
	const [showAddForm, setShowAddForm] = useState(false);
	const [showImport, setShowImport] = useState(false);
	const [showDetect, setShowDetect] = useState(false);
	const [detectedPorts, setDetectedPorts] = useState<PortProbe[]>([]);
	const [bridgingPort, setBridgingPort] = useState<number | null>(null);
	const [autoDetecting, setAutoDetecting] = useState(false);
	const [filterServiceId, setFilterServiceId] = useState<string | null>(null);
	const [sidebarWidth, setSidebarWidth] = useState(240);
	const [detailWidth, setDetailWidth] = useState(400);

	const selectedEvent = selectedEventId
		? (events.find((e) => e.id === selectedEventId) ?? null)
		: null;

	const handleSidebarResize = useCallback((delta: number) => {
		setSidebarWidth((w) => Math.max(180, Math.min(400, w + delta)));
	}, []);

	const handleDetailResize = useCallback((delta: number) => {
		setDetailWidth((w) => Math.max(300, Math.min(600, w - delta)));
	}, []);

	// Filter events by selected service
	const filteredEvents = useMemo(() => {
		if (!filterServiceId) return events;
		return events.filter((e) => e.service_id === filterServiceId);
	}, [events, filterServiceId]);

	const existingPorts = new Set(services.map((s) => s.port));

	const handleAddService = async (name: string, port: number, path: string) => {
		await addService(name, port, path);
		setShowAddForm(false);
	};

	const handleAutoDetect = async () => {
		setAutoDetecting(true);
		setShowDetect(true);
		setDetectedPorts([]);
		try {
			const ports = await autoDetect();
			setDetectedPorts(ports);
		} catch (err) {
			console.error("Detect failed:", err);
		} finally {
			setAutoDetecting(false);
		}
	};

	const handleBridgePort = async (probe: PortProbe) => {
		setBridgingPort(probe.port);
		try {
			const name = probe.server
				? `${probe.server.split("/")[0].toLowerCase()}-${probe.port}`
				: `localhost-${probe.port}`;
			await addService(name, probe.port, "/");
			setDetectedPorts((prev) => prev.filter((p) => p.port !== probe.port));
		} catch (err) {
			console.error("Failed to bridge:", err);
		} finally {
			setBridgingPort(null);
		}
	};

	return (
		<div className="h-screen bg-gray-950 text-white flex flex-col overflow-hidden">
			{/* ─── Top Bar ──────────────────────────────────────── */}
			<header className="flex items-center justify-between px-5 py-2.5 bg-gray-900 border-b border-gray-800 shrink-0">
				<div className="flex items-center gap-2.5">
					<div className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center">
						<svg
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="white"
							strokeWidth="2.5"
							strokeLinecap="round"
						>
							<path d="M4 12h4M16 12h4M12 4v4M12 16v4" />
							<circle cx="12" cy="12" r="2" fill="white" stroke="none" />
						</svg>
					</div>
					<span className="text-base font-bold bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
						BridgeHook
					</span>
				</div>
				{totalCount > 0 && (
					<div className="flex items-center gap-2 text-xs text-gray-400">
						<span
							className={`w-1.5 h-1.5 rounded-full ${activeCount > 0 ? "bg-green-500 animate-glow-green" : "bg-gray-600"}`}
						/>
						<span className={activeCount > 0 ? "text-green-400" : "text-gray-500"}>
							{activeCount}/{totalCount} active
						</span>
					</div>
				)}
			</header>

			{/* ─── Main: Sidebar + Events + Detail ─────────────── */}
			<div className="flex flex-1 min-h-0">
				{/* ─── LEFT SIDEBAR: Services ───────────────────── */}
				<aside style={{ width: sidebarWidth }} className="bg-gray-900/60 flex flex-col shrink-0">
					<div className="px-3 py-2 border-b border-gray-800/80 flex items-center justify-between">
						<span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
							Services
						</span>
						<div className="flex items-center gap-1">
							<button
								type="button"
								onClick={handleAutoDetect}
								disabled={autoDetecting}
								className="px-2 py-1 text-[10px] font-medium rounded text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-40 transition-all"
								title="Detect servers"
							>
								{autoDetecting ? "..." : "Detect"}
							</button>
							<button
								type="button"
								onClick={() => {
									setShowImport(!showImport);
									setShowAddForm(false);
								}}
								className="px-2 py-1 text-[10px] font-medium rounded text-purple-400 hover:bg-purple-500/10 transition-all"
								title="Import"
							>
								Import
							</button>
							<button
								type="button"
								onClick={() => {
									setShowAddForm(!showAddForm);
									setShowImport(false);
								}}
								className="px-2 py-1 text-[10px] font-bold rounded bg-cyan-600 text-white hover:bg-cyan-500 transition-all"
								title="Add"
							>
								+
							</button>
						</div>
					</div>

					<div className="flex-1 overflow-y-auto">
						{showDetect && (
							<div className="p-3 border-b border-gray-800/60">
								<div className="flex items-center justify-between mb-2">
									<span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
										Detected
									</span>
									<button
										type="button"
										onClick={() => setShowDetect(false)}
										className="text-gray-600 hover:text-gray-400 text-xs"
									>
										&times;
									</button>
								</div>
								{autoDetecting ? (
									<p className="text-[10px] text-gray-500">Scanning...</p>
								) : detectedPorts.length === 0 ? (
									<p className="text-[10px] text-gray-500">No servers found</p>
								) : (
									<div className="space-y-1">
										{detectedPorts.map((probe) => (
											<div key={probe.port} className="flex items-center justify-between py-1">
												<div className="flex items-center gap-1.5">
													<span className="w-1.5 h-1.5 rounded-full bg-green-500" />
													<span className="text-xs text-gray-300">:{probe.port}</span>
												</div>
												{existingPorts.has(probe.port) ? (
													<span className="text-[9px] text-green-500">Bridged</span>
												) : (
													<button
														type="button"
														onClick={() => handleBridgePort(probe)}
														disabled={bridgingPort === probe.port}
														className="text-[9px] text-cyan-400 hover:text-cyan-300"
													>
														{bridgingPort === probe.port ? "..." : "Bridge"}
													</button>
												)}
											</div>
										))}
									</div>
								)}
							</div>
						)}

						{showAddForm && (
							<div className="p-3 border-b border-gray-800/60">
								<AddServiceForm onAdd={handleAddService} onCancel={() => setShowAddForm(false)} />
							</div>
						)}
						{showImport && (
							<div className="p-3 border-b border-gray-800/60">
								<ImportForm
									onImport={async (url, name, port, path) => {
										await importFromExtension(url, name, port, path);
										setShowImport(false);
									}}
									onCancel={() => setShowImport(false)}
								/>
							</div>
						)}

						{servicesLoading ? (
							<div className="p-4 text-center text-gray-600 text-xs">Loading...</div>
						) : services.length === 0 && !showAddForm ? (
							<div className="p-6 text-center">
								<p className="text-xs text-gray-500 mb-2">No services yet</p>
								<button
									type="button"
									onClick={() => setShowAddForm(true)}
									className="text-[11px] text-cyan-400 hover:text-cyan-300"
								>
									+ Add a service
								</button>
							</div>
						) : (
							<div className="p-2 space-y-1">
								{services.map((service) => (
									<SidebarService
										key={service.id}
										service={service}
										connected={isConnected(service.id)}
										error={getError(service.id)}
										onToggle={toggleService}
										onRemove={removeService}
									/>
								))}
							</div>
						)}
					</div>
				</aside>

				<ResizeHandle direction="horizontal" onResize={handleSidebarResize} />

				{/* ─── CENTER: Event Log ────────────────────────── */}
				<div className="flex-1 flex flex-col min-w-0">
					{/* Filter tabs */}
					<div className="px-4 py-1.5 border-b border-gray-800 flex items-center gap-1 shrink-0 bg-gray-900/40 overflow-x-auto">
						<button
							type="button"
							onClick={() => setFilterServiceId(null)}
							className={`px-3 py-1 text-[11px] font-medium rounded-md transition-all whitespace-nowrap ${
								filterServiceId === null
									? "bg-cyan-500/15 text-cyan-400"
									: "text-gray-500 hover:text-gray-300 hover:bg-gray-800/50"
							}`}
						>
							All ({events.length})
						</button>
						{services.map((s) => {
							const count = events.filter((e) => e.service_id === s.id).length;
							return (
								<button
									key={s.id}
									type="button"
									onClick={() => setFilterServiceId(s.id)}
									className={`px-3 py-1 text-[11px] font-medium rounded-md transition-all whitespace-nowrap ${
										filterServiceId === s.id
											? "bg-cyan-500/15 text-cyan-400"
											: "text-gray-500 hover:text-gray-300 hover:bg-gray-800/50"
									}`}
								>
									{s.name} ({count})
								</button>
							);
						})}
					</div>

					{/* Event log */}
					<div className="flex-1 overflow-auto">
						<EventLog
							events={filteredEvents}
							selectedEventId={selectedEventId}
							onSelect={(id) => setSelectedEventId(id === selectedEventId ? null : id)}
						/>
					</div>
				</div>

				{/* ─── RIGHT SIDEBAR: Event Detail ──────────────── */}
				{selectedEvent && (
					<>
						<ResizeHandle direction="horizontal" onResize={handleDetailResize} />
						<aside
							style={{ width: detailWidth }}
							className="bg-gray-900/60 flex flex-col shrink-0 overflow-hidden"
						>
							<div className="flex-1 overflow-y-auto">
								<EventDetail event={selectedEvent} onClose={() => setSelectedEventId(null)} />
							</div>
						</aside>
					</>
				)}
			</div>
		</div>
	);
}

/* ─── Sidebar Service Item ──────────────────────────────────────────── */

function SidebarService({
	service,
	connected,
	error,
	onToggle,
	onRemove,
}: {
	service: Service;
	connected: boolean;
	error: string | null;
	onToggle: (id: string) => void;
	onRemove: (id: string) => void;
}) {
	const [copied, setCopied] = useState(false);
	const status = !service.active ? "inactive" : connected ? "connected" : "disconnected";
	const webhookUrl = `https://bridgehook-relay.halleluyaholudele.workers.dev/hook/${service.channel_id}`;

	const dotColor =
		status === "connected"
			? "bg-green-500"
			: status === "disconnected"
				? "bg-red-500"
				: "bg-gray-600";
	const dotGlow = status === "connected" ? "animate-glow-green" : "";

	const handleCopy = async () => {
		try {
			await writeText(webhookUrl);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {}
	};

	return (
		<div className="rounded-lg p-2.5 bg-gray-800/40 hover:bg-gray-800/70 border border-transparent hover:border-gray-700/50 transition-all group">
			<div className="flex items-center gap-2 mb-1">
				<span className={`w-2 h-2 rounded-full shrink-0 ${dotColor} ${dotGlow}`} />
				<span className="text-[12px] font-medium text-gray-200 truncate flex-1">
					{service.name}
				</span>
				<span
					className={`text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
						status === "connected"
							? "bg-emerald-500/15 text-emerald-400"
							: status === "disconnected"
								? "bg-red-500/15 text-red-400"
								: "bg-gray-600/20 text-gray-500"
					}`}
				>
					{status === "connected" ? "LIVE" : status === "disconnected" ? "DOWN" : "OFF"}
				</span>
			</div>

			<div className="text-[10px] text-gray-500 font-mono pl-4 mb-1">
				localhost:{service.port}
				{service.path}
			</div>

			<div className="flex items-center gap-1 pl-4">
				<code className="text-[9px] text-cyan-500/70 truncate flex-1 font-mono">
					...{service.channel_id}
				</code>
				<button
					type="button"
					onClick={handleCopy}
					className={`text-[9px] px-1.5 py-0.5 rounded transition-all ${copied ? "text-emerald-400" : "text-gray-500 hover:text-cyan-400"}`}
				>
					{copied ? "Done" : "Copy"}
				</button>
				<button
					type="button"
					onClick={() => onToggle(service.id)}
					className={`text-[9px] px-1.5 py-0.5 rounded ${service.active ? "text-yellow-500 hover:text-yellow-400" : "text-green-500 hover:text-green-400"}`}
				>
					{service.active ? "Pause" : "Start"}
				</button>
				<button
					type="button"
					onClick={() => onRemove(service.id)}
					className="text-[9px] px-1 py-0.5 rounded text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
				>
					&times;
				</button>
			</div>

			{error && <div className="mt-1 pl-4 text-[9px] text-red-400 truncate">{error}</div>}
		</div>
	);
}
