import { useState } from "react";
import { AddServiceForm } from "./components/AddServiceForm";
import { EventDetail } from "./components/EventDetail";
import { EventLog } from "./components/EventLog";
import { ImportForm } from "./components/ImportForm";
import { ServiceCard } from "./components/ServiceCard";
import { useBridge } from "./hooks/useBridge";
import { useEvents } from "./hooks/useEvents";
import { type PortProbe, useServices } from "./hooks/useServices";

export function App() {
	const {
		services,
		loading: servicesLoading,
		addService,
		removeService,
		toggleService,
		scanPorts,
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
	const [scanning, setScanning] = useState(false);
	const [detectedPorts, setDetectedPorts] = useState<PortProbe[]>([]);
	const [bridgingPort, setBridgingPort] = useState<number | null>(null);
	const [autoDetecting, setAutoDetecting] = useState(false);

	const selectedEvent = selectedEventId
		? (events.find((e) => e.id === selectedEventId) ?? null)
		: null;

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
			{/* ─── Top Bar ─────────────────────────────────────────── */}
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

			{/* ─── Main Layout: Sidebar + Content ─────────────────── */}
			<div className="flex flex-1 min-h-0">
				{/* ─── LEFT SIDEBAR ─────────────────────────────────── */}
				<aside className="w-72 bg-gray-900/60 border-r border-gray-800 flex flex-col shrink-0">
					{/* Sidebar header */}
					<div className="px-3 py-2.5 border-b border-gray-800/80 flex items-center justify-between">
						<span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
							Services
						</span>
						<div className="flex items-center gap-1">
							<button
								type="button"
								onClick={handleAutoDetect}
								disabled={autoDetecting}
								className="px-2 py-1 text-[10px] font-medium rounded text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-40 transition-all"
								title="Auto-detect running servers"
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
								title="Import from extension"
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
								title="Add new service"
							>
								+
							</button>
						</div>
					</div>

					{/* Service list */}
					<div className="flex-1 overflow-y-auto">
						{/* Detect results */}
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
								{scanning ? (
									<p className="text-[10px] text-gray-500">Scanning ports...</p>
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

						{/* Add / Import forms */}
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

						{/* Services */}
						{servicesLoading ? (
							<div className="p-4 text-center text-gray-600 text-xs">Loading...</div>
						) : services.length === 0 && !showAddForm ? (
							<div className="p-6 text-center">
								<p className="text-xs text-gray-500 mb-2">No services yet</p>
								<button
									type="button"
									onClick={handleAutoDetect}
									disabled={autoDetecting}
									className="text-[11px] text-cyan-400 hover:text-cyan-300"
								>
									{autoDetecting ? "Detecting..." : "Auto-detect servers"}
								</button>
							</div>
						) : (
							<div className="p-2 space-y-1">
								{services.map((service) => (
									<SidebarServiceItem
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

				{/* ─── MAIN CONTENT ─────────────────────────────────── */}
				<div className="flex-1 flex flex-col min-w-0">
					{/* Event log header */}
					<div className="px-5 py-2.5 border-b border-gray-800 flex items-center justify-between shrink-0 bg-gray-900/40">
						<div className="flex items-center gap-2">
							<span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">
								Activity
							</span>
							{events.length > 0 && (
								<span className="text-[10px] text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded">
									{events.length}
								</span>
							)}
						</div>
						{selectedEvent && (
							<button
								type="button"
								onClick={() => setSelectedEventId(null)}
								className="text-[10px] text-gray-500 hover:text-gray-300"
							>
								Close detail
							</button>
						)}
					</div>

					{/* Split: Event log (top) + Detail (bottom) */}
					<div className="flex-1 flex flex-col min-h-0">
						{/* Event log */}
						<div
							className={`${selectedEvent ? "h-[45%]" : "flex-1"} overflow-auto border-b border-gray-800/50`}
						>
							<EventLog
								events={events}
								selectedEventId={selectedEventId}
								onSelect={setSelectedEventId}
							/>
						</div>

						{/* Event detail panel */}
						{selectedEvent && (
							<div className="flex-1 overflow-auto">
								<EventDetail event={selectedEvent} onClose={() => setSelectedEventId(null)} />
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

/* ─── Sidebar Service Item ──────────────────────────────────────────── */

import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { Service } from "./hooks/useServices";

function SidebarServiceItem({
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
			{/* Name + status */}
			<div className="flex items-center gap-2 mb-1.5">
				<span className={`w-2 h-2 rounded-full shrink-0 ${dotColor} ${dotGlow}`} />
				<span className="text-[13px] font-medium text-gray-200 truncate flex-1">
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

			{/* Target */}
			<div className="text-[10px] text-gray-500 font-mono mb-1.5 pl-4">
				localhost:{service.port}
				{service.path}
			</div>

			{/* URL + actions */}
			<div className="flex items-center gap-1 pl-4">
				<code className="text-[9px] text-cyan-500/70 truncate flex-1 font-mono">
					...{service.channel_id}
				</code>
				<button
					type="button"
					onClick={handleCopy}
					className={`text-[9px] px-1.5 py-0.5 rounded transition-all ${
						copied ? "text-emerald-400" : "text-gray-500 hover:text-cyan-400"
					}`}
				>
					{copied ? "Done" : "Copy"}
				</button>
				<button
					type="button"
					onClick={() => onToggle(service.id)}
					className={`text-[9px] px-1.5 py-0.5 rounded ${
						service.active
							? "text-yellow-500 hover:text-yellow-400"
							: "text-green-500 hover:text-green-400"
					}`}
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

			{/* Error */}
			{error && <div className="mt-1.5 pl-4 text-[9px] text-red-400 truncate">{error}</div>}
		</div>
	);
}
