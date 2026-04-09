/**
 * Reusable visual illustrations for docs — matches landing page style.
 * Moving border cards, colored node boxes, animated connectors.
 */

/** Callout box with colored accent */
export function Callout({
	color = "#9093ff",
	icon,
	title,
	children,
}: {
	color?: string;
	icon: string;
	title: string;
	children: React.ReactNode;
}) {
	return (
		<div
			className="not-prose my-6 rounded-xl border p-5 flex gap-4"
			style={{
				background: `${color}06`,
				borderColor: `${color}18`,
			}}
		>
			<div
				className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 border"
				style={{
					background: `${color}12`,
					borderColor: `${color}25`,
				}}
			>
				<span className="text-lg">{icon}</span>
			</div>
			<div>
				<div
					className="text-sm font-bold font-headline mb-1"
					style={{ color }}
				>
					{title}
				</div>
				<div className="text-[13px] text-zinc-400 leading-relaxed font-body">
					{children}
				</div>
			</div>
		</div>
	);
}

/** Feature comparison card — two-column with colored indicators */
export function CompareCard({
	title,
	bridgehook,
	other,
	otherName,
}: {
	title: string;
	bridgehook: string;
	other: string;
	otherName: string;
}) {
	return (
		<div className="not-prose bg-[#0a0a0c] border border-white/[0.06] rounded-xl overflow-hidden">
			<div className="px-5 py-3 border-b border-white/[0.04] bg-white/[0.02]">
				<span className="text-xs font-black text-white font-headline">
					{title}
				</span>
			</div>
			<div className="grid grid-cols-2 divide-x divide-white/[0.04]">
				<div className="p-4">
					<div className="text-[9px] font-black text-zinc-600 uppercase tracking-[0.2em] mb-2 font-label">
						{otherName}
					</div>
					<div className="text-sm text-zinc-500 font-serif italic">
						{other}
					</div>
				</div>
				<div className="p-4">
					<div className="text-[9px] font-black text-primary uppercase tracking-[0.2em] mb-2 font-label">
						BridgeHook
					</div>
					<div className="text-sm text-white font-bold font-headline">
						{bridgehook}
					</div>
				</div>
			</div>
		</div>
	);
}

/** Step-by-step visual timeline */
export function StepTimeline({
	steps,
}: {
	steps: { title: string; desc: string; code?: string; color: string }[];
}) {
	return (
		<div className="not-prose my-8 space-y-0">
			{steps.map((step, i) => (
				<div key={step.title} className="flex gap-5">
					{/* Timeline connector */}
					<div className="flex flex-col items-center">
						<div
							className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-black font-headline shrink-0 border"
							style={{
								background: `${step.color}12`,
								color: step.color,
								borderColor: `${step.color}30`,
							}}
						>
							{i + 1}
						</div>
						{i < steps.length - 1 && (
							<div className="w-px flex-1 min-h-[24px] relative my-1">
								<div
									className="absolute inset-0"
									style={{
										background: `linear-gradient(to bottom, ${step.color}30, ${steps[i + 1].color}30)`,
									}}
								/>
							</div>
						)}
					</div>

					{/* Content */}
					<div className="pb-6 flex-1">
						<div className="text-sm font-bold text-white font-headline mb-1">
							{step.title}
						</div>
						<div className="text-[13px] text-zinc-400 leading-relaxed font-body mb-2">
							{step.desc}
						</div>
						{step.code && (
							<div
								className="font-mono text-[11px] px-3 py-2 rounded-lg border inline-block"
								style={{
									color: step.color,
									background: `${step.color}08`,
									borderColor: `${step.color}18`,
								}}
							>
								{step.code}
							</div>
						)}
					</div>
				</div>
			))}
		</div>
	);
}

/** Security layer visualization */
export function SecurityLayers() {
	const layers = [
		{
			name: "Channel Secrets",
			desc: "SHA-256 hashed, never exposed to relay",
			color: "#9093ff",
			icon: "🔑",
		},
		{
			name: "Path Allowlist",
			desc: "Client-side filtering, only allowed paths forwarded",
			color: "#ddb7ff",
			icon: "🛡️",
		},
		{
			name: "Auto-Expiry",
			desc: "24h channel lifetime, instant disconnect on tab close",
			color: "#ffb0cd",
			icon: "⏱️",
		},
		{
			name: "Rate Limiting",
			desc: "60 req/min, 1MB body, 100 events max",
			color: "#fcd34d",
			icon: "🚦",
		},
		{
			name: "Unguessable IDs",
			desc: "128-bit random UUIDs, cannot enumerate",
			color: "#28c840",
			icon: "🎲",
		},
	];

	return (
		<div className="not-prose my-8 space-y-3">
			{layers.map((layer, i) => (
				<div
					key={layer.name}
					className="flex items-center gap-4 rounded-xl border p-4 transition-all hover:scale-[1.01]"
					style={{
						background: `${layer.color}04`,
						borderColor: `${layer.color}15`,
					}}
				>
					<div
						className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 text-lg border"
						style={{
							background: `${layer.color}10`,
							borderColor: `${layer.color}20`,
						}}
					>
						{layer.icon}
					</div>
					<div className="flex-1">
						<div className="flex items-center gap-2">
							<span
								className="text-[9px] font-black uppercase tracking-[0.2em] font-label"
								style={{ color: `${layer.color}90` }}
							>
								Layer {i + 1}
							</span>
							<span className="text-sm font-bold text-white font-headline">
								{layer.name}
							</span>
						</div>
						<div className="text-[12px] text-zinc-500 font-body">
							{layer.desc}
						</div>
					</div>
				</div>
			))}
		</div>
	);
}

/** Protocol comparison visualization for SSE page */
export function ProtocolCompare() {
	return (
		<div className="not-prose my-8 grid grid-cols-2 gap-4">
			{/* SSE */}
			<div className="bg-[#0a0a0c] border border-primary/15 rounded-xl p-5">
				<div className="flex items-center gap-2 mb-4">
					<div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-sm">
						📡
					</div>
					<div className="text-sm font-black text-primary font-headline">
						SSE
					</div>
				</div>
				<div className="space-y-2 mb-4">
					{[
						"Server → Client only",
						"Standard HTTP",
						"Auto-reconnect built-in",
						"Works through any proxy/CDN",
						"Trivial to implement",
					].map((item) => (
						<div
							key={item}
							className="flex items-center gap-2 text-[11px] text-zinc-400 font-body"
						>
							<span className="text-primary text-xs">✓</span>
							{item}
						</div>
					))}
				</div>
				<div className="font-mono text-[10px] text-primary/60 bg-primary/[0.06] rounded-lg px-3 py-2 border border-primary/10">
					Content-Type: text/event-stream
				</div>
			</div>

			{/* WebSocket */}
			<div className="bg-[#0a0a0c] border border-white/[0.06] rounded-xl p-5">
				<div className="flex items-center gap-2 mb-4">
					<div className="w-8 h-8 rounded-lg bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-sm">
						🔌
					</div>
					<div className="text-sm font-black text-zinc-400 font-headline">
						WebSocket
					</div>
				</div>
				<div className="space-y-2 mb-4">
					{[
						"Bidirectional",
						"Separate ws:// protocol",
						"Manual reconnect logic",
						"Often blocked by proxies",
						"More complex setup",
					].map((item) => (
						<div
							key={item}
							className="flex items-center gap-2 text-[11px] text-zinc-500 font-body"
						>
							<span className="text-zinc-600 text-xs">—</span>
							{item}
						</div>
					))}
				</div>
				<div className="font-mono text-[10px] text-zinc-600 bg-white/[0.02] rounded-lg px-3 py-2 border border-white/[0.04]">
					Upgrade: websocket
				</div>
			</div>
		</div>
	);
}
