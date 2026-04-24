import { useState } from "react";
import { AddServiceForm } from "../components/AddServiceForm";
import { EventDetail } from "../components/EventDetail";
import { EventLog } from "../components/EventLog";
import { ImportForm } from "../components/ImportForm";
import { ServiceCard } from "../components/ServiceCard";
import { useBridge } from "../hooks/useBridge";
import { type WebhookEventPayload, useEvents } from "../hooks/useEvents";
import { type PortProbe, useServices } from "../hooks/useServices";

export function Dashboard() {
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
	const { events, replayEvent } = useEvents();
	const { isConnected, getError } = useBridge();

	const [showAddForm, setShowAddForm] = useState(false);
	const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
	const [showDetect, setShowDetect] = useState(false);
	const [scanning, setScanning] = useState(false);
	const [detectedPorts, setDetectedPorts] = useState<PortProbe[]>([]);
	const [bridgingPort, setBridgingPort] = useState<number | null>(null);
	const [autoDetecting, setAutoDetecting] = useState(false);
	const [showImport, setShowImport] = useState(false);

	const selectedEvent = selectedEventId
		? (events.find((e) => e.id === selectedEventId) ?? null)
		: null;

	const handleAddService = async (name: string, port: number, path: string) => {
		await addService(name, port, path);
		setShowAddForm(false);
	};

	const handleScan = async () => {
		setScanning(true);
		setShowDetect(true);
		setDetectedPorts([]);
		try {
			const ports = await scanPorts();
			setDetectedPorts(ports);
		} catch (err) {
			console.error("Scan failed:", err);
		} finally {
			setScanning(false);
		}
	};

	const handleBridgePort = async (probe: PortProbe) => {
		setBridgingPort(probe.port);
		try {
			const name = probe.server
				? `${probe.server.split("/")[0].toLowerCase()}-${probe.port}`
				: `localhost-${probe.port}`;
			await addService(name, probe.port, "/");
			// Remove from detected list
			setDetectedPorts((prev) => prev.filter((p) => p.port !== probe.port));
		} catch (err) {
			console.error("Failed to bridge:", err);
		} finally {
			setBridgingPort(null);
		}
	};

	const handleAutoDetect = async () => {
		setAutoDetecting(true);
		try {
			const created = await autoDetect();
			if (created.length === 0) {
				handleScan(); // Show scan results if nothing new
			} else {
				setShowDetect(false);
			}
		} catch (err) {
			console.error("Auto-detect failed:", err);
		} finally {
			setAutoDetecting(false);
		}
	};

	const existingPorts = new Set(services.map((s) => s.port));

	return (
		<div className="flex flex-col gap-5 h-full">
			{/* Services Section */}
			<section className="animate-fade-in-up">
				<div className="flex items-center justify-between mb-4">
					<h2 className="text-lg font-semibold text-white tracking-tight">Services</h2>
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={handleAutoDetect}
							disabled={autoDetecting}
							className="px-3 py-1.5 text-sm font-medium rounded-lg border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-40 transition-all duration-200"
						>
							{autoDetecting ? "Detecting..." : "Auto-Detect"}
						</button>
						<button
							type="button"
							onClick={handleScan}
							disabled={scanning}
							className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 disabled:bg-gray-600 text-white rounded-lg font-medium transition-colors"
						>
							{scanning ? "Scanning..." : "Scan Ports"}
						</button>
						<button
							type="button"
							onClick={() => {
								setShowImport(true);
								setShowAddForm(false);
							}}
							className="px-3 py-1.5 text-sm font-medium rounded-lg border border-purple-500/30 text-purple-400 hover:bg-purple-500/10 transition-all duration-200"
						>
							Import
						</button>
						{!showAddForm && !showImport && (
							<button
								type="button"
								onClick={() => setShowAddForm(true)}
								className="px-3 py-1.5 text-sm font-medium rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 text-white hover:from-cyan-500 hover:to-blue-500 shadow-lg shadow-cyan-500/20 transition-all duration-200"
							>
								+ Add
							</button>
						)}
					</div>
				</div>

				{/* Detect results */}
				{showDetect && (
					<div className="mb-3 bg-gray-900/70 border border-gray-800/80 rounded-xl p-4 animate-fade-in-up">
						<div className="flex items-center justify-between mb-2">
							<h3 className="text-sm font-semibold text-white">
								{scanning ? "Scanning localhost ports..." : "Detected Servers"}
							</h3>
							<button
								type="button"
								onClick={() => setShowDetect(false)}
								className="text-gray-500 hover:text-white text-sm"
							>
								&times;
							</button>
						</div>
						{scanning ? (
							<p className="text-xs text-gray-500">
								Checking ports 3000, 3001, 4000, 5000, 5173, 8000, 8080, 8888...
							</p>
						) : detectedPorts.length === 0 ? (
							<p className="text-xs text-gray-500">No servers found on common ports.</p>
						) : (
							<div className="space-y-2">
								{detectedPorts.map((probe) => {
									const alreadyBridged = existingPorts.has(probe.port);
									return (
										<div key={probe.port} className="flex items-center justify-between py-1">
											<div className="flex items-center gap-2">
												<span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
												<span className="text-sm text-gray-300">localhost:{probe.port}</span>
												{probe.server && (
													<span className="text-xs text-gray-500">({probe.server})</span>
												)}
											</div>
											{alreadyBridged ? (
												<span className="text-xs text-green-400">Already bridged</span>
											) : (
												<button
													type="button"
													onClick={() => handleBridgePort(probe)}
													disabled={bridgingPort === probe.port}
													className="px-3 py-1 text-xs bg-cyan-600 hover:bg-cyan-700 disabled:bg-gray-600 text-white rounded transition-colors"
												>
													{bridgingPort === probe.port ? "Creating..." : "Bridge it"}
												</button>
											)}
										</div>
									);
								})}
							</div>
						)}
					</div>
				)}

				{showImport && (
					<div className="mb-3">
						<ImportForm
							onImport={async (url, name, port, path) => {
								await importFromExtension(url, name, port, path);
								setShowImport(false);
							}}
							onCancel={() => setShowImport(false)}
						/>
					</div>
				)}

				{showAddForm && (
					<div className="mb-3">
						<AddServiceForm onAdd={handleAddService} onCancel={() => setShowAddForm(false)} />
					</div>
				)}

				{servicesLoading ? (
					<div className="text-gray-500 text-sm py-4 text-center">Loading services...</div>
				) : services.length === 0 && !showAddForm ? (
					<div className="text-center py-10 bg-gray-900/40 border border-gray-700 border-dashed rounded-xl">
						<p className="text-gray-400 text-sm">No services configured yet</p>
						<p className="text-gray-500 text-xs mt-1">
							Click Auto-Detect to find running servers, or add one manually
						</p>
						<div className="flex items-center justify-center gap-2 mt-3">
							<button
								type="button"
								onClick={handleAutoDetect}
								disabled={autoDetecting}
								className="px-4 py-2 text-sm font-medium rounded-lg border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-40 transition-all duration-200"
							>
								{autoDetecting ? "Detecting..." : "Auto-Detect Servers"}
							</button>
							<button
								type="button"
								onClick={() => setShowAddForm(true)}
								className="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors"
							>
								+ Add Manually
							</button>
						</div>
					</div>
				) : (
					<div className="space-y-2">
						{services.map((service) => (
							<ServiceCard
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
			</section>

			{/* Live Events Section */}
			<section className="flex-1 min-h-0 flex flex-col">
				<div className="flex items-center justify-between mb-3">
					<h2 className="text-lg font-semibold text-white">Live Events</h2>
					{events.length > 0 && (
						<span className="text-xs text-gray-500">
							{events.length} event{events.length !== 1 ? "s" : ""}
						</span>
					)}
				</div>

				<div className="flex-1 min-h-0 bg-gray-900/50 border border-gray-800/60 rounded-xl overflow-hidden">
					<EventLog
						events={events}
						selectedEventId={selectedEventId}
						onSelect={setSelectedEventId}
					/>
				</div>
			</section>

			{/* Event Detail Panel */}
			{selectedEvent && (
				<section>
					<EventDetail event={selectedEvent} onClose={() => setSelectedEventId(null)} />
				</section>
			)}
		</div>
	);
}
