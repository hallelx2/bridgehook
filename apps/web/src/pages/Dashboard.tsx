import {
	Beaker,
	Command as CommandIcon,
	Copy,
	Key,
	Pencil,
	Power,
	RefreshCw,
	Search,
	Settings,
	Terminal,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Logo } from "../components/Logo";
import { CommandPalette, useCommandPaletteShortcut } from "../components/dashboard/CommandPalette";
import type { CommandAction } from "../components/dashboard/CommandPalette";
import { ConnectionBanner } from "../components/dashboard/ConnectionBanner";
import { EmptyState } from "../components/dashboard/EmptyState";
import { EventDetail } from "../components/dashboard/EventDetail";
import { EventRow, EventRowHeader } from "../components/dashboard/EventRow";
import { DEFAULT_FILTERS, FilterBar, applyFilters } from "../components/dashboard/FilterBar";
import type { Filters } from "../components/dashboard/FilterBar";
import { MockResponseSettings } from "../components/dashboard/MockResponseSettings";
import { ReplayEditor } from "../components/dashboard/ReplayEditor";
import { SecretsModal } from "../components/dashboard/SecretsModal";
import { StatsPanel } from "../components/dashboard/StatsPanel";
import { useBridge } from "../hooks/useBridge";
import type { LiveEvent } from "../hooks/useBridge";

/** Validate a port number input. */
function validatePort(raw: string): { ok: true; port: number } | { ok: false; error: string } {
	const trimmed = raw.trim();
	if (!trimmed) return { ok: false, error: "Port is required" };
	const n = Number(trimmed);
	if (!Number.isInteger(n)) return { ok: false, error: "Port must be an integer" };
	if (n < 1 || n > 65535) return { ok: false, error: "Port must be between 1 and 65535" };
	return { ok: true, port: n };
}

/** Validate and normalize the allowed-paths textarea. */
function validatePaths(raw: string): { ok: true; paths: string[] } | { ok: false; error: string } {
	const lines = raw
		.split("\n")
		.map((p) => p.trim())
		.filter(Boolean);
	if (lines.length > 20) return { ok: false, error: "At most 20 paths allowed" };
	for (const p of lines) {
		if (!p.startsWith("/")) return { ok: false, error: `Path "${p}" must start with /` };
		if (p.length > 256) return { ok: false, error: `Path too long: ${p.slice(0, 30)}…` };
	}
	return { ok: true, paths: lines };
}

function StatusIndicator({ status }: { status: string }) {
	const colors: Record<string, { dot: string; bg: string; text: string; label: string }> = {
		idle: {
			dot: "bg-on-surface-faint",
			bg: "bg-surface border-border",
			text: "text-on-surface-variant",
			label: "Idle",
		},
		connecting: {
			dot: "bg-warning",
			bg: "bg-warning/10 border-warning/25",
			text: "text-warning",
			label: "Connecting…",
		},
		connected: {
			dot: "bg-success",
			bg: "bg-success/10 border-success/25",
			text: "text-success",
			label: "Connected",
		},
		reconnecting: {
			dot: "bg-warning",
			bg: "bg-warning/10 border-warning/25",
			text: "text-warning",
			label: "Reconnecting",
		},
		error: {
			dot: "bg-danger",
			bg: "bg-danger/10 border-danger/25",
			text: "text-danger",
			label: "Error",
		},
	};
	const c = colors[status] || colors.idle;

	return (
		<div className={`flex items-center gap-2 px-3 py-1.5 rounded-md border ${c.bg}`}>
			<span className={`w-2 h-2 rounded-full ${c.dot}`} />
			<span className={`text-[11px] font-bold ${c.text}`}>{c.label}</span>
		</div>
	);
}

function ConnectForm({ onConnect }: { onConnect: (port: number, paths: string[]) => void }) {
	const [port, setPort] = useState("3000");
	const [paths, setPaths] = useState("/webhook/stripe\n/webhook/github");
	const [validationError, setValidationError] = useState<string | null>(null);

	const handleSubmit = () => {
		const portResult = validatePort(port);
		if (!portResult.ok) {
			setValidationError(portResult.error);
			return;
		}
		const pathsResult = validatePaths(paths);
		if (!pathsResult.ok) {
			setValidationError(pathsResult.error);
			return;
		}
		setValidationError(null);
		onConnect(portResult.port, pathsResult.paths);
	};

	return (
		<div className="flex-1 flex items-center justify-center p-8">
			<div className="w-full max-w-md">
				<div className="text-center mb-10">
					<div className="flex justify-center mb-4">
						<Logo size="lg" />
					</div>
					<p className="text-on-surface-variant text-sm">
						Enter your localhost port to start receiving webhooks.
					</p>
				</div>

				<div className="space-y-5">
					<div>
						<label
							htmlFor="bh-port"
							className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-[0.2em] mb-2"
						>
							Local port
						</label>
						<input
							id="bh-port"
							type="number"
							min={1}
							max={65535}
							value={port}
							onChange={(e) => setPort(e.target.value)}
							className="w-full bg-surface border border-border rounded-xl px-4 py-3 font-mono text-sm text-on-surface placeholder-on-surface-faint focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all"
							placeholder="3000"
						/>
					</div>

					<div>
						<label
							htmlFor="bh-paths"
							className="block text-[11px] font-bold text-on-surface-variant uppercase tracking-[0.2em] mb-2"
						>
							Allowed paths (one per line, leave empty for all)
						</label>
						<textarea
							id="bh-paths"
							value={paths}
							onChange={(e) => setPaths(e.target.value)}
							rows={3}
							className="w-full bg-surface border border-border rounded-xl px-4 py-3 font-mono text-sm text-on-surface placeholder-on-surface-faint focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all resize-none"
							placeholder="/webhook/stripe"
						/>
					</div>

					{validationError && (
						<div
							role="alert"
							className="text-xs font-mono text-danger bg-danger/5 border border-danger/15 rounded-md px-3 py-2"
						>
							{validationError}
						</div>
					)}

					<button
						type="button"
						onClick={handleSubmit}
						className="w-full bg-primary text-background font-bold py-3.5 rounded-xl hover:bg-primary-dim transition-colors text-sm"
					>
						Start bridge
					</button>
				</div>
			</div>
		</div>
	);
}

function CopyChip({ text, label }: { text: string; label?: string }) {
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		if (!copied) return;
		const t = setTimeout(() => setCopied(false), 2000);
		return () => clearTimeout(t);
	}, [copied]);

	return (
		<button
			type="button"
			onClick={() =>
				navigator.clipboard
					.writeText(text)
					.then(() => setCopied(true))
					.catch(() => {})
			}
			className={`w-full px-3 py-2 rounded-md text-[10px] font-bold uppercase tracking-wider transition-colors ${
				copied
					? "bg-success/15 text-success border border-success/25"
					: "bg-primary-soft text-primary border border-primary/30 hover:bg-primary/20"
			}`}
		>
			{copied ? "Copied!" : (label ?? "Copy")}
		</button>
	);
}

export function Dashboard() {
	const bridge = useBridge();

	const [expanded, setExpanded] = useState<string | null>(null);
	const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
	const [replayTarget, setReplayTarget] = useState<LiveEvent | null>(null);
	const [mockOpen, setMockOpen] = useState(false);
	const [secretsOpen, setSecretsOpen] = useState(false);
	const [secretsHighlight, setSecretsHighlight] = useState<string | null>(null);
	const [paletteOpen, setPaletteOpen] = useState(false);
	const queryRef = useRef<HTMLInputElement>(null);

	useCommandPaletteShortcut(() => setPaletteOpen((v) => !v));

	// ⌘/ focuses the filter input
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === "/") {
				e.preventDefault();
				queryRef.current?.focus();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	const filtered = useMemo(() => applyFilters(bridge.events, filters), [bridge.events, filters]);

	const successCount = bridge.events.filter(
		(e) => e.responseStatus !== null && e.responseStatus < 400,
	).length;
	const errorCount = bridge.events.filter(
		(e) => e.error || (e.responseStatus !== null && e.responseStatus >= 400),
	).length;

	/** Fire a single test request to the active webhook URL. */
	const fireTest = useCallback(async () => {
		if (!bridge.webhookUrl) return;
		try {
			await fetch(bridge.webhookUrl, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					test: true,
					sentBy: "BridgeHook",
					at: new Date().toISOString(),
				}),
			});
		} catch (err) {
			console.warn("Test request failed:", err);
		}
	}, [bridge.webhookUrl]);

	const handleReplay = useCallback(
		async (event: LiveEvent) => {
			await bridge.replay(event);
		},
		[bridge.replay],
	);

	const handleConfigureSecret = useCallback((providerId: string) => {
		setSecretsHighlight(providerId);
		setSecretsOpen(true);
	}, []);

	const lastEvent = bridge.events[0];

	const actions: CommandAction[] = useMemo(
		() => [
			{
				id: "replay-last",
				label: "Replay last event",
				hint: lastEvent
					? `${lastEvent.method} ${lastEvent.path.replace(/^\/hook\/[a-z0-9]+/, "") || "/"}`
					: undefined,
				Icon: RefreshCw,
				keywords: ["repeat", "fire"],
				disabled: !lastEvent,
				run: () => lastEvent && bridge.replay(lastEvent),
			},
			{
				id: "edit-replay-last",
				label: "Edit & replay last event",
				Icon: Pencil,
				keywords: ["modify", "change"],
				disabled: !lastEvent,
				run: () => lastEvent && setReplayTarget(lastEvent),
			},
			{
				id: "copy-url",
				label: "Copy webhook URL",
				Icon: Copy,
				disabled: !bridge.webhookUrl,
				run: () => bridge.webhookUrl && navigator.clipboard.writeText(bridge.webhookUrl),
			},
			{
				id: "fire-test",
				label: "Fire a test request",
				Icon: Terminal,
				keywords: ["sample", "ping", "smoke"],
				disabled: !bridge.webhookUrl,
				run: fireTest,
			},
			{
				id: "focus-search",
				label: "Filter events",
				Icon: Search,
				shortcut: "⌘/",
				run: () => queryRef.current?.focus(),
			},
			{
				id: "mock",
				label: bridge.mock.enabled ? "Disable mock mode" : "Mock response settings",
				Icon: Beaker,
				keywords: ["canned", "fake"],
				run: () => setMockOpen(true),
			},
			{
				id: "secrets",
				label: "Manage signing secrets",
				Icon: Key,
				keywords: ["stripe", "github", "hmac"],
				run: () => {
					setSecretsHighlight(null);
					setSecretsOpen(true);
				},
			},
			{
				id: "disconnect",
				label: "Disconnect bridge",
				Icon: Power,
				disabled: bridge.status === "idle",
				run: bridge.disconnect,
			},
		],
		[bridge, lastEvent, fireTest],
	);

	const showConnectForm = bridge.status === "idle" || bridge.status === "error";

	return (
		<div className="h-screen flex flex-col bg-background text-on-surface">
			{/* ── Top bar ─────────────────────────────────────────── */}
			<div className="flex items-center justify-between px-5 py-3 border-b border-border-subtle bg-surface-muted">
				<Logo size="sm" />
				<div className="flex items-center gap-2">
					<StatusIndicator status={bridge.status} />
					{!showConnectForm && (
						<>
							<button
								type="button"
								onClick={() => setPaletteOpen(true)}
								className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-surface border border-border rounded-md text-[11px] text-on-surface-variant hover:text-on-surface transition-colors"
								aria-label="Open command palette"
							>
								<CommandIcon size={12} strokeWidth={2} />
								<span>K</span>
							</button>
							<button
								type="button"
								onClick={() => setMockOpen(true)}
								className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-bold uppercase tracking-wider transition-colors ${
									bridge.mock.enabled
										? "bg-warning/15 text-warning border border-warning/25"
										: "bg-surface border border-border text-on-surface-variant hover:text-on-surface"
								}`}
								aria-label="Mock response settings"
							>
								<Beaker size={12} strokeWidth={2} />
								{bridge.mock.enabled ? "Mock on" : "Mock"}
							</button>
							<button
								type="button"
								onClick={() => {
									setSecretsHighlight(null);
									setSecretsOpen(true);
								}}
								className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-surface border border-border rounded-md text-[11px] text-on-surface-variant hover:text-on-surface transition-colors"
								aria-label="Signing secrets"
							>
								<Key size={12} strokeWidth={2} />
								<span className="hidden md:inline">Secrets</span>
							</button>
							<button
								type="button"
								onClick={bridge.disconnect}
								className="text-[11px] font-bold text-on-surface-muted hover:text-danger transition-colors px-2 py-1"
							>
								Disconnect
							</button>
						</>
					)}
				</div>
			</div>

			{/* ── Body ────────────────────────────────────────────── */}
			{showConnectForm ? (
				<>
					<ConnectForm onConnect={bridge.connect} />
					{bridge.error && (
						<div className="px-5 py-3 bg-danger/5 border-t border-danger/15 text-danger text-xs font-mono">
							{bridge.error}
						</div>
					)}
				</>
			) : (
				<div className="flex flex-1 overflow-hidden">
					{/* ── Sidebar ────────────────────────────────── */}
					<aside className="w-[260px] border-r border-border-subtle flex flex-col bg-surface-muted shrink-0">
						<div className="p-5 space-y-4 flex-1 overflow-y-auto">
							<SidebarBlock label="Channel">
								<div className="font-mono text-xs text-on-surface bg-surface border border-border rounded-md px-3 py-2">
									{bridge.channelId ?? "—"}
								</div>
							</SidebarBlock>

							<SidebarBlock label="Forwarding to">
								<div className="flex items-center gap-2">
									<span className="w-2 h-2 rounded-full bg-success" />
									<span className="font-mono text-xs text-success">
										{bridge.mock.enabled ? "MOCK MODE" : `localhost:${bridge.port}`}
									</span>
								</div>
							</SidebarBlock>

							<SidebarBlock label="Webhook URL">
								<div className="bg-surface border border-border rounded-md p-3 mb-2">
									<div className="font-mono text-[10px] text-primary break-all leading-relaxed">
										{bridge.webhookUrl ?? "—"}
									</div>
								</div>
								{bridge.webhookUrl && <CopyChip text={bridge.webhookUrl} label="Copy URL" />}
							</SidebarBlock>

							{bridge.allowedPaths.length > 0 && (
								<SidebarBlock label="Path allowlist">
									<div className="space-y-1">
										{bridge.allowedPaths.map((p) => (
											<div
												key={p}
												className="font-mono text-[11px] text-on-surface-variant flex items-center gap-1.5"
											>
												<span className="text-success">✓</span>
												{p}
											</div>
										))}
									</div>
								</SidebarBlock>
							)}

							<button
								type="button"
								onClick={fireTest}
								disabled={!bridge.webhookUrl}
								className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-surface border border-border rounded-md text-[11px] font-bold text-on-surface hover:border-border-strong transition-colors disabled:opacity-50"
							>
								<Terminal size={12} strokeWidth={2} />
								Fire test request
							</button>
						</div>

						<div className="px-5 py-3 border-t border-border-subtle flex items-center justify-between gap-3 text-[10px]">
							<div className="flex items-center gap-3">
								<span className="text-on-surface-muted">
									<span className="text-success font-bold">{successCount}</span> ok
								</span>
								<span className="text-on-surface-muted">
									<span className="text-danger font-bold">{errorCount}</span> err
								</span>
								<span className="text-on-surface-muted">
									<span className="text-on-surface-variant font-bold">{bridge.events.length}</span>{" "}
									total
								</span>
							</div>
							<button
								type="button"
								onClick={() => setMockOpen(true)}
								aria-label="Settings"
								className="text-on-surface-muted hover:text-on-surface transition-colors"
							>
								<Settings size={12} strokeWidth={2} />
							</button>
						</div>
					</aside>

					{/* ── Main panel ─────────────────────────────── */}
					<main className="flex-1 flex flex-col overflow-hidden">
						<ConnectionBanner
							status={bridge.status}
							error={bridge.error}
							pollFailures={bridge.pollFailures}
						/>

						{bridge.events.length === 0 ? (
							<EmptyState webhookUrl={bridge.webhookUrl} onFireTest={fireTest} />
						) : (
							<>
								<StatsPanel events={bridge.events} />
								<FilterBar
									filters={filters}
									onChange={setFilters}
									totalCount={bridge.events.length}
									matchedCount={filtered.length}
									queryInputRef={queryRef}
								/>
								<EventRowHeader />
								<div className="flex-1 overflow-y-auto">
									{filtered.length === 0 ? (
										<div className="flex items-center justify-center py-16 text-[13px] text-on-surface-muted">
											No events match the current filters.
										</div>
									) : (
										filtered.map((event) => (
											<div key={event.id} className="border-b border-border-subtle last:border-0">
												<EventRow
													event={event}
													expanded={expanded === event.id}
													onToggle={() => setExpanded((id) => (id === event.id ? null : event.id))}
												/>
												{expanded === event.id && (
													<EventDetail
														event={event}
														secrets={bridge.secrets}
														onReplay={() => handleReplay(event)}
														onEdit={() => setReplayTarget(event)}
														onConfigureSecret={handleConfigureSecret}
													/>
												)}
											</div>
										))
									)}
								</div>
							</>
						)}
					</main>
				</div>
			)}

			{/* ── Modals & overlays ───────────────────────────────── */}
			<ReplayEditor
				event={replayTarget}
				onClose={() => setReplayTarget(null)}
				onSubmit={async (edits) => {
					if (!replayTarget) return;
					await bridge.replayWithEdits(replayTarget, edits);
				}}
			/>
			<MockResponseSettings
				mock={bridge.mock}
				onChange={bridge.setMock}
				open={mockOpen}
				onClose={() => setMockOpen(false)}
			/>
			<SecretsModal
				open={secretsOpen}
				highlight={secretsHighlight}
				secrets={bridge.secrets}
				onChange={bridge.setSecret}
				onClose={() => setSecretsOpen(false)}
			/>
			<CommandPalette actions={actions} open={paletteOpen} onClose={() => setPaletteOpen(false)} />
		</div>
	);
}

function SidebarBlock({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div>
			<div className="text-[9px] font-bold text-on-surface-muted uppercase tracking-[0.25em] mb-2">
				{label}
			</div>
			{children}
		</div>
	);
}
