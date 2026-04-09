import { useState } from "react";
import { Logo } from "../components/Logo";
import { useBridge } from "../hooks/useBridge";
import type { LiveEvent } from "../hooks/useBridge";

function StatusIndicator({ status }: { status: string }) {
	const colors: Record<string, { dot: string; bg: string; text: string; label: string }> = {
		idle: { dot: "bg-zinc-500", bg: "bg-zinc-500/10 border-zinc-500/20", text: "text-zinc-400", label: "Idle" },
		connecting: { dot: "bg-yellow-500", bg: "bg-yellow-500/10 border-yellow-500/20", text: "text-yellow-400", label: "Connecting..." },
		connected: { dot: "bg-emerald-500", bg: "bg-emerald-500/10 border-emerald-500/20", text: "text-emerald-400", label: "Connected" },
		error: { dot: "bg-red-500", bg: "bg-red-500/10 border-red-500/20", text: "text-red-400", label: "Error" },
	};
	const c = colors[status] || colors.idle;

	return (
		<div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${c.bg}`}>
			<span className="relative flex h-2 w-2">
				{status === "connected" && (
					<span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${c.dot} opacity-75`} />
				)}
				<span className={`relative inline-flex rounded-full h-2 w-2 ${c.dot}`} />
			</span>
			<span className={`text-[11px] font-bold ${c.text} font-body`}>{c.label}</span>
		</div>
	);
}

function ConnectForm({
	onConnect,
}: { onConnect: (port: number, paths: string[]) => void }) {
	const [port, setPort] = useState("3000");
	const [paths, setPaths] = useState("/webhook/stripe\n/webhook/github");

	return (
		<div className="flex-1 flex items-center justify-center p-8">
			<div className="w-full max-w-md">
				<div className="text-center mb-10">
					<div className="flex justify-center mb-4">
						<Logo size="lg" />
					</div>
					<p className="text-zinc-400 text-sm font-body">
						Enter your localhost port to start receiving webhooks.
					</p>
				</div>

				<div className="space-y-5">
					<div>
						<label className="block text-[11px] font-black text-zinc-400 uppercase tracking-[0.2em] mb-2 font-label">
							Local Port
						</label>
						<input
							type="number"
							value={port}
							onChange={(e) => setPort(e.target.value)}
							className="w-full bg-[#0c0c0f] border border-white/[0.08] rounded-xl px-4 py-3 font-mono text-sm text-white placeholder-zinc-600 focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20 transition-all"
							placeholder="3000"
						/>
					</div>

					<div>
						<label className="block text-[11px] font-black text-zinc-400 uppercase tracking-[0.2em] mb-2 font-label">
							Allowed Paths (one per line)
						</label>
						<textarea
							value={paths}
							onChange={(e) => setPaths(e.target.value)}
							rows={3}
							className="w-full bg-[#0c0c0f] border border-white/[0.08] rounded-xl px-4 py-3 font-mono text-sm text-white placeholder-zinc-600 focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/20 transition-all resize-none"
							placeholder="/webhook/stripe"
						/>
					</div>

					<button
						type="button"
						onClick={() =>
							onConnect(
								Number(port),
								paths.split("\n").map((p) => p.trim()).filter(Boolean),
							)
						}
						className="w-full bg-primary text-white font-black py-3.5 rounded-xl hover:scale-[1.02] active:scale-[0.98] transition-all shadow-[0_0_30px_rgba(144,147,255,0.2)] font-headline text-sm"
					>
						Start Bridge
					</button>
				</div>
			</div>
		</div>
	);
}

function CopyButton({ text }: { text: string }) {
	const [copied, setCopied] = useState(false);

	const handleCopy = () => {
		navigator.clipboard.writeText(text).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		});
	};

	return (
		<button
			type="button"
			onClick={handleCopy}
			className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all duration-300 font-label ${
				copied
					? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/25"
					: "bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20"
			}`}
		>
			{copied ? "Copied!" : "Copy"}
		</button>
	);
}

function EventRow({ event }: { event: LiveEvent }) {
	const [expanded, setExpanded] = useState(false);

	const statusColor =
		event.error
			? "text-red-400"
			: (event.responseStatus ?? 0) >= 500
				? "text-red-400"
				: (event.responseStatus ?? 0) >= 300
					? "text-yellow-400"
					: event.responseStatus
						? "text-emerald-400"
						: "text-zinc-600";

	const dotColor =
		event.error
			? "bg-red-500"
			: (event.responseStatus ?? 0) >= 500
				? "bg-red-500"
				: event.responseStatus
					? "bg-emerald-500"
					: "bg-zinc-600 animate-pulse";

	return (
		<div className="border-b border-white/[0.03]">
			<div
				className="grid grid-cols-[32px_56px_1fr_1fr_56px_56px] gap-2 items-center px-5 py-3 hover:bg-white/[0.02] transition-colors cursor-pointer"
				onClick={() => setExpanded(!expanded)}
				onKeyDown={(e) => e.key === "Enter" && setExpanded(!expanded)}
			>
				<div className="flex justify-center">
					<span className={`w-2 h-2 rounded-full ${dotColor} shadow-[0_0_6px_currentColor]`} />
				</div>
				<span className="font-mono text-[10px] font-black text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded px-1.5 py-0.5 text-center">
					{event.method}
				</span>
				<span className="font-mono text-[12px] text-zinc-300 truncate">
					{event.path}
				</span>
				<span className="font-mono text-[11px] text-zinc-500 truncate">
					{new Date(event.receivedAt).toLocaleTimeString()}
				</span>
				<span className={`font-mono text-[12px] font-bold text-right ${statusColor}`}>
					{event.error ? "ERR" : event.responseStatus || "..."}
				</span>
				<span className="font-mono text-[11px] text-zinc-600 text-right">
					{event.latencyMs ? `${event.latencyMs}ms` : "—"}
				</span>
			</div>

			{expanded && (
				<div className="px-5 pb-4 grid grid-cols-2 gap-4">
					<div>
						<div className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-1.5 font-label">
							Request Headers
						</div>
						<pre className="bg-[#0a0a0c] rounded-lg p-3 font-mono text-[10px] text-zinc-400 overflow-x-auto max-h-40 overflow-y-auto">
							{JSON.stringify(event.requestHeaders, null, 2)}
						</pre>
					</div>
					<div>
						<div className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-1.5 font-label">
							Request Body
						</div>
						<pre className="bg-[#0a0a0c] rounded-lg p-3 font-mono text-[10px] text-zinc-400 overflow-x-auto max-h-40 overflow-y-auto">
							{event.requestBody
								? (() => {
										try { return JSON.stringify(JSON.parse(event.requestBody), null, 2); }
										catch { return event.requestBody; }
									})()
								: "—"}
						</pre>
					</div>
					{event.responseBody && (
						<div className="col-span-2">
							<div className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-1.5 font-label">
								Response Body
							</div>
							<pre className="bg-[#0a0a0c] rounded-lg p-3 font-mono text-[10px] text-zinc-400 overflow-x-auto max-h-40 overflow-y-auto">
								{(() => {
									try { return JSON.stringify(JSON.parse(event.responseBody), null, 2); }
									catch { return event.responseBody; }
								})()}
							</pre>
						</div>
					)}
					{event.error && (
						<div className="col-span-2">
							<div className="text-[9px] font-black text-red-500 uppercase tracking-[0.2em] mb-1.5 font-label">
								Error
							</div>
							<pre className="bg-red-500/5 border border-red-500/10 rounded-lg p-3 font-mono text-[10px] text-red-400">
								{event.error}
							</pre>
						</div>
					)}
				</div>
			)}
		</div>
	);
}

export function Dashboard() {
	const bridge = useBridge();

	const successCount = bridge.events.filter(
		(e) => e.responseStatus && e.responseStatus < 400,
	).length;
	const errorCount = bridge.events.filter(
		(e) => e.error || (e.responseStatus && e.responseStatus >= 400),
	).length;

	return (
		<div className="h-screen flex flex-col bg-background text-white">
			{/* Top bar */}
			<div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.06] bg-[#08080a]">
				<Logo size="sm" />
				<StatusIndicator status={bridge.status} />
				{bridge.status === "connected" && (
					<button
						type="button"
						onClick={bridge.disconnect}
						className="text-[11px] font-bold text-zinc-500 hover:text-red-400 transition-colors font-body"
					>
						Disconnect
					</button>
				)}
			</div>

			{bridge.status === "idle" || bridge.status === "error" ? (
				<>
					<ConnectForm onConnect={bridge.connect} />
					{bridge.error && (
						<div className="px-5 py-3 bg-red-500/5 border-t border-red-500/10 text-red-400 text-xs font-mono">
							{bridge.error}
						</div>
					)}
				</>
			) : (
				<div className="flex flex-1 overflow-hidden">
					{/* Sidebar */}
					<div className="w-[260px] border-r border-white/[0.05] flex flex-col bg-[#09090b] shrink-0">
						<div className="p-5 space-y-4 flex-1 overflow-y-auto">
							{/* Channel */}
							<div>
								<div className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-2 font-label">
									Channel
								</div>
								<div className="font-mono text-xs text-zinc-200 bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-2">
									{bridge.channelId}
								</div>
							</div>

							{/* Port */}
							<div>
								<div className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-2 font-label">
									Forwarding to
								</div>
								<div className="flex items-center gap-2">
									<span className="w-2 h-2 rounded-full bg-emerald-500" />
									<span className="font-mono text-xs text-emerald-400">
										localhost:{bridge.port}
									</span>
								</div>
							</div>

							{/* Webhook URL */}
							<div>
								<div className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-2 font-label">
									Webhook URL
								</div>
								<div className="bg-white/[0.03] border border-white/[0.06] rounded-lg p-3 mb-2">
									<div className="font-mono text-[10px] text-primary break-all leading-relaxed">
										{bridge.webhookUrl}
									</div>
								</div>
								{bridge.webhookUrl && (
									<CopyButton text={bridge.webhookUrl} />
								)}
							</div>
						</div>

						{/* Stats footer */}
						<div className="px-5 py-3 border-t border-white/[0.05] flex items-center gap-4 text-[10px] font-body">
							<span className="text-zinc-500">
								<span className="text-emerald-400 font-bold">{successCount}</span> ok
							</span>
							<span className="text-zinc-500">
								<span className="text-red-400 font-bold">{errorCount}</span> err
							</span>
							<span className="text-zinc-500">
								<span className="text-zinc-300 font-bold">{bridge.events.length}</span> total
							</span>
						</div>
					</div>

					{/* Event feed */}
					<div className="flex-1 flex flex-col">
						{/* Toolbar */}
						<div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.05]">
							<div className="flex items-center gap-3">
								<span className="text-[11px] font-black text-zinc-300 uppercase tracking-[0.15em] font-label">
									Live Events
								</span>
								<span className="relative flex h-2 w-2">
									<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-60" />
									<span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
								</span>
							</div>
							<span className="text-[10px] text-zinc-600 font-body">
								{bridge.events.length} events
							</span>
						</div>

						{/* Column headers */}
						<div className="grid grid-cols-[32px_56px_1fr_1fr_56px_56px] gap-2 px-5 py-2 border-b border-white/[0.04] bg-white/[0.01] text-[9px] font-black text-zinc-600 uppercase tracking-[0.2em] font-label">
							<span />
							<span>Method</span>
							<span>Path</span>
							<span>Time</span>
							<span className="text-right">Status</span>
							<span className="text-right">Latency</span>
						</div>

						{/* Events */}
						<div className="flex-1 overflow-y-auto">
							{bridge.events.length === 0 ? (
								<div className="flex-1 flex items-center justify-center h-full text-center p-8">
									<div>
										<div className="text-zinc-600 text-3xl mb-3">&#x1F4E1;</div>
										<p className="text-zinc-500 text-sm font-body mb-1">
											Waiting for webhooks...
										</p>
										<p className="text-zinc-600 text-xs font-mono">
											POST to {bridge.webhookUrl}
										</p>
									</div>
								</div>
							) : (
								bridge.events.map((event) => (
									<EventRow key={event.id} event={event} />
								))
							)}
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
