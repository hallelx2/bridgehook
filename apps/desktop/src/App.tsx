import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AddServiceForm } from "./components/AddServiceForm";
import { type Command, CommandPalette } from "./components/CommandPalette";
import { EventDetail } from "./components/EventDetail";
import { EventLog } from "./components/EventLog";
import { type EventFilter, EventToolbar } from "./components/EventToolbar";
import { ImportForm } from "./components/ImportForm";
import { ManualSender } from "./components/ManualSender";
import { MetricsBar } from "./components/MetricsBar";
import { ResizeHandle } from "./components/ResizeHandle";
import { ServiceConfigModal } from "./components/ServiceConfigModal";
import { SettingsModal } from "./components/SettingsModal";
import { ServiceSkeleton } from "./components/Skeleton";
import { Sparkline } from "./components/Sparkline";
import { useBridge } from "./hooks/useBridge";
import { useEvents } from "./hooks/useEvents";
import { type PortProbe, type Service, useServices } from "./hooks/useServices";
import { cn } from "./lib/cn";
import { truncateMiddle } from "./lib/format";
import { usePersistedState } from "./lib/usePersistedState";

const INITIAL_FILTER: EventFilter = {
	search: "",
	method: null,
	statusClass: "all",
	serviceId: null,
};

export function App() {
	const {
		services,
		loading: servicesLoading,
		addService,
		removeService,
		toggleService,
		autoDetect,
		importFromExtension,
		refresh: refreshServices,
	} = useServices();
	const { events, clearEvents } = useEvents();
	const { isConnected, getError } = useBridge();

	// Modal state
	const [configServiceId, setConfigServiceId] = useState<string | null>(null);
	const [manualSenderOpen, setManualSenderOpen] = useState(false);
	const [settingsOpen, setSettingsOpen] = useState(false);

	const activeCount = services.filter((s) => s.active && isConnected(s.id)).length;
	const totalCount = services.length;

	// Persisted UI state
	const [sidebarWidth, setSidebarWidth] = usePersistedState<number>("ui.sidebarWidth", 256);
	const [detailWidth, setDetailWidth] = usePersistedState<number>("ui.detailWidth", 480);
	const [sidebarCollapsed, setSidebarCollapsed] = usePersistedState<boolean>(
		"ui.sidebarCollapsed",
		false,
	);
	const [filter, setFilter] = usePersistedState<EventFilter>("ui.filter", INITIAL_FILTER);

	// Ephemeral UI state
	const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
	const [showAddForm, setShowAddForm] = useState(false);
	const [showImport, setShowImport] = useState(false);
	const [showDetect, setShowDetect] = useState(false);
	const [detectedPorts, setDetectedPorts] = useState<PortProbe[]>([]);
	const [bridgingPort, setBridgingPort] = useState<number | null>(null);
	const [autoDetecting, setAutoDetecting] = useState(false);

	const selectedEvent = selectedEventId
		? (events.find((e) => e.id === selectedEventId) ?? null)
		: null;
	const selectedService = selectedEvent
		? (services.find((s) => s.id === selectedEvent.service_id) ?? null)
		: null;

	const serviceNameById = useMemo(
		() => Object.fromEntries(services.map((s) => [s.id, s.name])),
		[services],
	);

	// Apply filter to events
	const filteredEvents = useMemo(() => {
		const q = filter.search.trim().toLowerCase();
		return events.filter((e) => {
			if (filter.serviceId && e.service_id !== filter.serviceId) return false;
			if (filter.method && e.method.toUpperCase() !== filter.method) return false;
			switch (filter.statusClass) {
				case "2xx":
					if (!(e.response_status != null && e.response_status >= 200 && e.response_status < 300))
						return false;
					break;
				case "3xx":
					if (!(e.response_status != null && e.response_status >= 300 && e.response_status < 400))
						return false;
					break;
				case "4xx":
					if (!(e.response_status != null && e.response_status >= 400 && e.response_status < 500))
						return false;
					break;
				case "5xx":
					if (!(e.response_status != null && e.response_status >= 500 && e.response_status < 600))
						return false;
					break;
				case "err":
					if (!e.error) return false;
					break;
				case "all":
					break;
			}
			if (q) {
				const hay = [
					e.path,
					e.method,
					e.request_body ?? "",
					e.response_body ?? "",
					JSON.stringify(e.request_headers ?? {}),
				]
					.join("\n")
					.toLowerCase();
				if (!hay.includes(q)) return false;
			}
			return true;
		});
	}, [events, filter]);

	const handleSidebarResize = useCallback(
		(delta: number) => {
			setSidebarWidth((w) => Math.max(200, Math.min(420, w + delta)));
		},
		[setSidebarWidth],
	);

	const handleDetailResize = useCallback(
		(delta: number) => {
			setDetailWidth((w) => Math.max(360, Math.min(760, w - delta)));
		},
		[setDetailWidth],
	);

	const existingPorts = new Set(services.map((s) => s.port));

	const handleAddService = async (name: string, port: number, path: string) => {
		await addService(name, port, path);
		setShowAddForm(false);
	};

	const handleAutoDetect = useCallback(async () => {
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
	}, [autoDetect]);

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

	// Command palette commands
	const commands = useMemo<Command[]>(() => {
		const cmds: Command[] = [
			{
				id: "service.add",
				title: "Add service",
				hint: "a",
				run: () => {
					setShowAddForm(true);
					setShowImport(false);
				},
			},
			{
				id: "service.import",
				title: "Import channel from extension",
				run: () => {
					setShowImport(true);
					setShowAddForm(false);
				},
			},
			{
				id: "service.detect",
				title: "Auto-detect localhost servers",
				hint: "d",
				run: handleAutoDetect,
			},
			{
				id: "send.manual",
				title: "Send test request…",
				hint: "t",
				run: () => setManualSenderOpen(true),
			},
			{
				id: "ui.sidebar",
				title: sidebarCollapsed ? "Show service sidebar" : "Hide service sidebar",
				hint: "⌘\\",
				run: () => setSidebarCollapsed((v) => !v),
			},
			{
				id: "ui.settings",
				title: "Open settings…",
				run: () => setSettingsOpen(true),
			},
			{
				id: "events.clear",
				title: "Clear event list (local)",
				run: () => clearEvents(),
			},
			{
				id: "filter.clear",
				title: "Clear all filters",
				run: () => setFilter(INITIAL_FILTER),
			},
		];
		for (const s of services) {
			cmds.push({
				id: `service.filter.${s.id}`,
				title: `Filter events → ${s.name}`,
				run: () => setFilter((f) => ({ ...f, serviceId: s.id })),
			});
			cmds.push({
				id: `service.toggle.${s.id}`,
				title: `${s.active ? "Pause" : "Start"} ${s.name}`,
				run: async () => {
					await toggleService(s.id);
				},
			});
			cmds.push({
				id: `service.copy.${s.id}`,
				title: `Copy webhook URL → ${s.name}`,
				run: async () => {
					try {
						await writeText(webhookUrlFor(s));
					} catch {
						/* ignore */
					}
				},
			});
			cmds.push({
				id: `service.configure.${s.id}`,
				title: `Configure ${s.name}…`,
				run: () => setConfigServiceId(s.id),
			});
		}
		return cmds;
	}, [
		services,
		sidebarCollapsed,
		setSidebarCollapsed,
		handleAutoDetect,
		clearEvents,
		setFilter,
		toggleService,
	]);

	// Global shortcuts: ⌘\ to toggle sidebar, a to add, d to detect
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			const isMeta = e.metaKey || e.ctrlKey;
			if (e.target instanceof HTMLElement) {
				const tag = e.target.tagName;
				const typing = tag === "INPUT" || tag === "TEXTAREA" || e.target.isContentEditable;
				if (typing && !(isMeta && (e.key === "\\" || e.key === "k" || e.key === "K"))) return;
			}
			if (isMeta && e.key === "\\") {
				e.preventDefault();
				setSidebarCollapsed((v) => !v);
			} else if (e.key === "a" && !isMeta) {
				e.preventDefault();
				setShowAddForm(true);
				setShowImport(false);
			} else if (e.key === "d" && !isMeta) {
				e.preventDefault();
				handleAutoDetect();
			} else if (e.key === "t" && !isMeta) {
				e.preventDefault();
				setManualSenderOpen(true);
			} else if (e.key === "," && isMeta) {
				e.preventDefault();
				setSettingsOpen(true);
			}
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [setSidebarCollapsed, handleAutoDetect]);

	return (
		<div className="h-screen bg-ink-1 text-fg flex flex-col overflow-hidden font-sans">
			{/* ─── Top bar ─────────────────────────────────────────────────────── */}
			<header className="flex items-center gap-3 px-3 h-11 bg-ink-0 border-b border-edge shrink-0 select-none">
				<div className="flex items-center gap-2.5">
					<button
						type="button"
						onClick={() => setSidebarCollapsed((v) => !v)}
						className="w-7 h-7 flex items-center justify-center text-fg-faint hover:text-fg hover:bg-ink-3 rounded transition-colors"
						aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
						title="Toggle sidebar (⌘\\)"
					>
						<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
							<rect
								x="1.5"
								y="2.5"
								width="13"
								height="11"
								rx="1"
								stroke="currentColor"
								strokeWidth="1.2"
							/>
							<line x1="6" y1="3" x2="6" y2="13" stroke="currentColor" strokeWidth="1.2" />
						</svg>
					</button>
					<BridgeMark />
					<div className="leading-none">
						<div className="text-ui font-semibold tracking-tight">bridgehook</div>
						<div className="text-micro text-fg-faint -mt-0.5 tracking-widest uppercase">
							webhook bridge
						</div>
					</div>
				</div>

				<div className="h-5 w-px bg-edge mx-1" />

				{totalCount > 0 ? (
					<div className="flex items-center gap-2 text-caption">
						<span className="relative flex items-center">
							<span
								className={cn(
									"absolute inset-0 rounded-full",
									activeCount > 0 && "animate-pulse-soft",
								)}
								style={
									activeCount > 0
										? { background: "rgba(204,255,0,0.4)", filter: "blur(4px)" }
										: undefined
								}
							/>
							<span
								className={cn(
									"relative w-1.5 h-1.5 rounded-full",
									activeCount > 0 ? "bg-uranium" : "bg-fg-ghost",
								)}
							/>
						</span>
						<span className="text-fg-muted tracking-wider uppercase">
							<span className={cn("tabular", activeCount > 0 ? "text-uranium" : "text-fg-faint")}>
								{activeCount}
							</span>
							<span className="text-fg-ghost mx-0.5">/</span>
							<span className="tabular">{totalCount}</span>
							<span className="ml-1.5 text-fg-faint">live</span>
						</span>
					</div>
				) : (
					<div className="text-micro text-fg-faint uppercase tracking-widest">no services</div>
				)}

				<div className="ml-auto flex items-center gap-2">
					<MetricsBar events={events} />
					<div className="h-5 w-px bg-edge mx-1" />
					<button
						type="button"
						onClick={() => setManualSenderOpen(true)}
						disabled={services.length === 0}
						className="group flex items-center gap-1.5 px-2.5 h-7 text-caption rounded border border-edge text-fg-muted hover:text-fg hover:border-edge-strong hover:bg-ink-3 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
						title="Send test request (t)"
					>
						<svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true">
							<path
								d="M2 8 L14 8 M9 3 L14 8 L9 13"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="square"
							/>
						</svg>
						<span className="tracking-wide">send</span>
						<kbd className="ml-1 text-micro text-fg-ghost group-hover:text-fg-muted">t</kbd>
					</button>
					<button
						type="button"
						onClick={() => setSettingsOpen(true)}
						className="w-7 h-7 flex items-center justify-center text-fg-faint hover:text-fg hover:bg-ink-3 rounded transition-colors"
						aria-label="Settings"
						title="Settings (⌘,)"
					>
						<svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
							<circle cx="8" cy="8" r="2.4" stroke="currentColor" strokeWidth="1.3" />
							<path
								d="M8 1.4v1.6m0 10v1.6M14.6 8h-1.6M3 8H1.4M12.95 3.05l-1.13 1.13M4.18 11.82l-1.13 1.13M12.95 12.95l-1.13-1.13M4.18 4.18L3.05 3.05"
								stroke="currentColor"
								strokeWidth="1.3"
								strokeLinecap="round"
							/>
						</svg>
					</button>
				</div>
			</header>

			{/* ─── Main layout ─────────────────────────────────────────────────── */}
			<div
				className="flex-1 min-h-0 grid"
				style={{
					gridTemplateColumns: sidebarCollapsed
						? `0px 1px 1fr ${selectedEvent ? `1px ${detailWidth}px` : ""}`
						: `${sidebarWidth}px 1px 1fr ${selectedEvent ? `1px ${detailWidth}px` : ""}`,
				}}
			>
				{/* ─── Sidebar: services rail ───────────────────────────────── */}
				<aside
					className={cn(
						"bg-ink-1 flex flex-col min-h-0 overflow-hidden",
						sidebarCollapsed && "invisible",
					)}
				>
					<div className="px-3 h-9 border-b border-edge flex items-center justify-between shrink-0">
						<span className="text-micro font-semibold text-fg-muted uppercase tracking-[0.18em]">
							Services
							<span className="ml-1.5 text-fg-ghost tabular">{`[${services.length.toString().padStart(2, "0")}]`}</span>
						</span>
						<div className="flex items-center gap-0.5">
							<RailButton
								label={autoDetecting ? "scan…" : "scan"}
								onClick={handleAutoDetect}
								disabled={autoDetecting}
								title="Detect localhost servers (d)"
								tone="muted"
							/>
							<RailButton
								label="import"
								onClick={() => {
									setShowImport(!showImport);
									setShowAddForm(false);
								}}
								title="Import from extension"
								tone="muted"
							/>
							<RailButton
								label="+"
								onClick={() => {
									setShowAddForm(!showAddForm);
									setShowImport(false);
								}}
								title="Add service (a)"
								tone="accent"
							/>
						</div>
					</div>

					<div className="flex-1 overflow-y-auto">
						{showDetect && (
							<div className="px-3 py-3 border-b border-edge bg-ink-2">
								<div className="flex items-center justify-between mb-2">
									<span className="text-micro font-semibold text-fg-muted uppercase tracking-[0.18em]">
										&gt; detected
									</span>
									<button
										type="button"
										onClick={() => setShowDetect(false)}
										className="text-fg-ghost hover:text-fg-muted text-body w-4 h-4 flex items-center justify-center"
										aria-label="Dismiss detection results"
									>
										&times;
									</button>
								</div>
								{autoDetecting ? (
									<div className="flex items-center gap-2 text-caption text-fg-faint">
										<span className="w-2 h-2 bg-uranium animate-pulse-soft" />
										scanning common ports…
									</div>
								) : detectedPorts.length === 0 ? (
									<p className="text-caption text-fg-faint">No servers found on common ports.</p>
								) : (
									<div className="space-y-0.5">
										{detectedPorts.map((probe) => (
											<div
												key={probe.port}
												className="group flex items-center justify-between gap-2 py-1 px-1.5 -mx-1.5 rounded hover:bg-ink-3"
											>
												<div className="flex items-center gap-2 min-w-0 tabular">
													<span className="w-1 h-1 rounded-full bg-ok" />
													<span className="text-body text-fg">:{probe.port}</span>
													{probe.server && (
														<span className="text-micro text-fg-faint truncate">
															{probe.server}
														</span>
													)}
												</div>
												{existingPorts.has(probe.port) ? (
													<span className="text-micro text-ok uppercase tracking-wider">
														bridged
													</span>
												) : (
													<button
														type="button"
														onClick={() => handleBridgePort(probe)}
														disabled={bridgingPort === probe.port}
														className="text-micro text-uranium hover:text-uranium-dim uppercase tracking-wider opacity-60 group-hover:opacity-100"
													>
														{bridgingPort === probe.port ? "…" : "bridge →"}
													</button>
												)}
											</div>
										))}
									</div>
								)}
							</div>
						)}

						{showAddForm && (
							<div className="px-3 py-3 border-b border-edge bg-ink-2">
								<AddServiceForm onAdd={handleAddService} onCancel={() => setShowAddForm(false)} />
							</div>
						)}
						{showImport && (
							<div className="px-3 py-3 border-b border-edge bg-ink-2">
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
							<div className="p-2 space-y-1.5">
								<ServiceSkeleton />
								<ServiceSkeleton />
							</div>
						) : services.length === 0 && !showAddForm && !showImport ? (
							<EmptyServicesState onAdd={() => setShowAddForm(true)} onDetect={handleAutoDetect} />
						) : (
							<div className="py-1">
								{services.map((service) => (
									<SidebarService
										key={service.id}
										service={service}
										connected={isConnected(service.id)}
										error={getError(service.id)}
										events={events}
										isFiltered={filter.serviceId === service.id}
										onToggle={toggleService}
										onRemove={removeService}
										onFilter={(id) =>
											setFilter((f) => ({
												...f,
												serviceId: f.serviceId === id ? null : id,
											}))
										}
										onConfigure={(id) => setConfigServiceId(id)}
									/>
								))}
							</div>
						)}
					</div>
				</aside>

				<ResizeHandle
					direction="horizontal"
					onResize={sidebarCollapsed ? () => {} : handleSidebarResize}
				/>

				{/* ─── Center: Event log ──────────────────────────────────── */}
				<div className="flex flex-col min-w-0 min-h-0 bg-ink-1">
					<EventToolbar
						filter={filter}
						onChange={setFilter}
						services={services}
						totalEvents={events.length}
						visibleEvents={filteredEvents.length}
						onClearEvents={clearEvents}
					/>
					<div className="flex-1 overflow-auto min-h-0">
						<EventLog
							events={filteredEvents}
							selectedEventId={selectedEventId}
							onSelect={(id) => setSelectedEventId(id === selectedEventId ? null : id)}
							serviceNameById={serviceNameById}
						/>
					</div>
				</div>

				{/* ─── Detail ─────────────────────────────────────────────── */}
				{selectedEvent && (
					<>
						<ResizeHandle direction="horizontal" onResize={handleDetailResize} />
						<aside className="min-h-0 overflow-hidden bg-ink-1 border-l border-edge">
							<EventDetail
								event={selectedEvent}
								service={selectedService}
								onClose={() => setSelectedEventId(null)}
							/>
						</aside>
					</>
				)}
			</div>

			<CommandPalette commands={commands} />

			{configServiceId && (
				<ServiceConfigModal
					service={services.find((s) => s.id === configServiceId) ?? services[0]}
					onClose={() => setConfigServiceId(null)}
					onSaved={() => refreshServices()}
				/>
			)}
			{manualSenderOpen && services.length > 0 && (
				<ManualSender
					services={services}
					defaultServiceId={filter.serviceId}
					onClose={() => setManualSenderOpen(false)}
				/>
			)}
			{settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
		</div>
	);
}

/* ─── Brand mark — geometric dot in a square frame ──────────────────── */

function BridgeMark() {
	return (
		<div className="relative w-7 h-7 flex items-center justify-center">
			<div className="absolute inset-0 border border-uranium/60 rounded-sm" />
			<div className="absolute inset-1 border border-uranium/30" />
			<div className="relative w-1.5 h-1.5 bg-uranium rounded-full shadow-[0_0_8px_rgba(204,255,0,0.6)]" />
		</div>
	);
}

/* ─── Tiny rail button (uniform style for the sidebar header) ────────── */

function RailButton({
	label,
	onClick,
	disabled,
	title,
	tone,
}: {
	label: string;
	onClick: () => void;
	disabled?: boolean;
	title?: string;
	tone: "accent" | "muted";
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			title={title}
			className={cn(
				"px-2 h-6 text-micro font-semibold uppercase tracking-[0.12em] rounded transition-colors disabled:opacity-30",
				tone === "accent"
					? "text-uranium hover:bg-uranium/10"
					: "text-fg-muted hover:text-fg hover:bg-ink-3",
			)}
		>
			{label}
		</button>
	);
}

/* ─── Sidebar service row ──────────────────────────────────────────── */

function webhookUrlFor(service: Service): string {
	return `https://bridgehook-relay.halleluyaholudele.workers.dev/hook/${service.channel_id}`;
}

function SidebarService({
	service,
	connected,
	error,
	events,
	isFiltered,
	onToggle,
	onRemove,
	onFilter,
	onConfigure,
}: {
	service: Service;
	connected: boolean;
	error: string | null;
	events: { service_id: string; received_at: string }[];
	isFiltered: boolean;
	onToggle: (id: string) => void;
	onRemove: (id: string) => void;
	onFilter: (id: string) => void;
	onConfigure: (id: string) => void;
}) {
	const [copied, setCopied] = useState(false);
	const status = !service.active ? "inactive" : connected ? "connected" : "disconnected";
	const webhookUrl = webhookUrlFor(service);

	const dotColor =
		status === "connected" ? "bg-uranium" : status === "disconnected" ? "bg-err" : "bg-fg-ghost";
	const dotShadow =
		status === "connected"
			? "shadow-[0_0_10px_rgba(204,255,0,0.6)]"
			: status === "disconnected"
				? "shadow-[0_0_8px_rgba(255,122,122,0.5)]"
				: "";

	// Sparkline: last 60s in 12 buckets
	const sparkValues = useMemo(() => {
		const now = Date.now();
		const windowMs = 60_000;
		const buckets = new Array(12).fill(0) as number[];
		for (const e of events) {
			if (e.service_id !== service.id) continue;
			const t = new Date(e.received_at).getTime();
			if (Number.isNaN(t) || now - t > windowMs) continue;
			const idx = Math.min(11, Math.floor((windowMs - (now - t)) / (windowMs / 12)));
			if (idx >= 0 && idx < 12) buckets[idx]++;
		}
		return buckets;
	}, [events, service.id]);

	const handleCopy = async () => {
		try {
			await writeText(webhookUrl);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			/* ignore */
		}
	};

	const statusLabel =
		status === "connected" ? "ONLINE" : status === "disconnected" ? "OFFLINE" : "PAUSED";

	return (
		<div
			className={cn(
				"group relative px-3 py-2 border-l-2 transition-colors",
				isFiltered
					? "bg-uranium/5 border-l-uranium"
					: "border-l-transparent hover:bg-ink-3/40 hover:border-l-edge-strong",
			)}
		>
			{/* Top row: status dot, name, sparkline */}
			<div className="flex items-center gap-2">
				<span className="relative flex items-center shrink-0">
					<span className={cn("w-1.5 h-1.5 rounded-full", dotColor, dotShadow)} />
				</span>
				<button
					type="button"
					onClick={() => onFilter(service.id)}
					className="text-body font-medium text-fg truncate flex-1 text-left tracking-tight"
					title="Filter event log by this service"
				>
					{service.name}
				</button>
				<Sparkline values={sparkValues} width={40} height={12} bars color="#ccff00" />
			</div>

			{/* Address row */}
			<div className="text-micro text-fg-faint pl-3.5 mt-0.5 tabular flex items-center gap-1.5">
				<span className="text-fg-ghost">→</span>
				<span>localhost:{service.port}</span>
				<span className="text-fg-ghost">{service.path}</span>
			</div>

			{/* Channel id row */}
			<div className="flex items-center gap-1.5 pl-3.5 mt-1">
				<span className="text-micro text-fg-ghost uppercase tracking-widest">ch</span>
				<code
					className="text-micro text-fg-muted truncate flex-1 tabular"
					title={service.channel_id}
				>
					{truncateMiddle(service.channel_id, 5, 5)}
				</code>
				<span className="text-micro text-fg-ghost uppercase">{statusLabel}</span>
			</div>

			{/* Action row */}
			<div className="flex items-center gap-0.5 mt-1.5 pl-3.5 opacity-70 group-hover:opacity-100 transition-opacity">
				<button
					type="button"
					onClick={handleCopy}
					className={cn(
						"text-micro px-1.5 h-5 rounded uppercase tracking-wider transition-colors",
						copied ? "text-uranium bg-uranium/10" : "text-fg-faint hover:text-fg hover:bg-ink-3",
					)}
				>
					{copied ? "copied" : "copy"}
				</button>
				<button
					type="button"
					onClick={() => onToggle(service.id)}
					className={cn(
						"text-micro px-1.5 h-5 rounded uppercase tracking-wider transition-colors",
						service.active ? "text-warn hover:bg-warn/10" : "text-uranium hover:bg-uranium/10",
					)}
				>
					{service.active ? "pause" : "start"}
				</button>
				<button
					type="button"
					onClick={() => onConfigure(service.id)}
					className="text-micro px-1.5 h-5 rounded uppercase tracking-wider text-fg-faint hover:text-fg hover:bg-ink-3 transition-colors"
					aria-label={`Configure ${service.name}`}
				>
					cfg
				</button>
				<button
					type="button"
					onClick={() => onRemove(service.id)}
					className="ml-auto text-micro px-1.5 h-5 rounded uppercase tracking-wider text-fg-ghost hover:text-err hover:bg-err/10 transition-colors"
					aria-label={`Remove ${service.name}`}
				>
					×
				</button>
			</div>

			{(service.mock_response || service.signing_provider || service.active_environment) && (
				<div className="flex flex-wrap gap-1 mt-1.5 pl-3.5">
					<ServiceBadges service={service} />
				</div>
			)}

			{error && (
				<div
					className="mt-1 pl-3.5 text-micro text-err truncate flex items-center gap-1"
					title={error}
				>
					<span className="text-err/60">!</span>
					{error}
				</div>
			)}
		</div>
	);
}

/* ─── Service badges (mock/signing/env) ─── */

function ServiceBadges({ service }: { service: Service }) {
	return (
		<>
			{service.mock_response && (
				<span
					className="text-micro px-1.5 py-px rounded-sm border border-warn/30 text-warn bg-warn/5 uppercase tracking-wider tabular"
					title="Mock response active"
				>
					mock
				</span>
			)}
			{service.signing_provider && (
				<span
					className="text-micro px-1.5 py-px rounded-sm border border-method-get/30 text-method-get bg-method-get/5 uppercase tracking-wider tabular"
					title={`${service.signing_provider} signature verification`}
				>
					sig·{service.signing_provider}
				</span>
			)}
			{service.active_environment && (
				<span
					className="text-micro px-1.5 py-px rounded-sm border border-edge text-fg-muted bg-ink-3 uppercase tracking-wider tabular"
					title={`Environment: ${service.active_environment}`}
				>
					env·{service.active_environment}
				</span>
			)}
		</>
	);
}

/* ─── Empty state ─── */

function EmptyServicesState({
	onAdd,
	onDetect,
}: {
	onAdd: () => void;
	onDetect: () => void;
}) {
	return (
		<div className="px-4 py-8 text-center grid-texture">
			<div className="mx-auto w-12 h-12 mb-4 relative">
				<div className="absolute inset-0 border border-uranium/30 rounded-sm" />
				<div className="absolute inset-1.5 border border-uranium/20" />
				<div className="absolute inset-0 flex items-center justify-center">
					<span className="w-1.5 h-1.5 bg-uranium/60 rounded-full animate-pulse-soft" />
				</div>
			</div>
			<p className="text-body text-fg mb-1">No services yet</p>
			<p className="text-micro text-fg-faint leading-relaxed mb-4">
				Detect services on common ports
				<br />
				or add one manually.
			</p>
			<div className="flex flex-col gap-1.5">
				<button
					type="button"
					onClick={onDetect}
					className="px-3 h-8 text-caption uppercase tracking-wider rounded border border-edge text-fg-muted hover:text-fg hover:border-uranium/40 hover:bg-uranium/5 transition-colors"
				>
					&gt; auto-detect
				</button>
				<button
					type="button"
					onClick={onAdd}
					className="px-3 h-8 text-caption uppercase tracking-wider rounded bg-uranium text-uranium-ink hover:bg-uranium-dim transition-colors font-semibold"
				>
					+ add manually
				</button>
			</div>
		</div>
	);
}
