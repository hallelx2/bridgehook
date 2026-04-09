/**
 * Visual architecture diagram showing the webhook flow.
 * Replaces ASCII art with styled nodes + SVG connecting paths.
 */

interface NodeProps {
	icon: string;
	label: string;
	sublabel: string;
	color: string;
	side?: "left" | "right";
}

function DiagramNode({ icon, label, sublabel, color }: NodeProps) {
	return (
		<div className="flex flex-col items-center text-center">
			<div
				className="w-14 h-14 rounded-2xl flex items-center justify-center mb-3 border"
				style={{
					background: `${color}10`,
					borderColor: `${color}25`,
				}}
			>
				<span className="text-2xl">{icon}</span>
			</div>
			<div className="font-headline font-bold text-white text-sm tracking-tight">
				{label}
			</div>
			<div className="font-mono text-[10px] text-zinc-500 mt-0.5">
				{sublabel}
			</div>
		</div>
	);
}

function Arrow({ color = "#9093ff" }: { color?: string }) {
	return (
		<div className="flex items-center px-2">
			<svg width="60" height="24" viewBox="0 0 60 24" fill="none">
				<path
					d="M0 12H50"
					stroke={color}
					strokeWidth="1.5"
					strokeDasharray="4 3"
					opacity="0.4"
				/>
				<path
					d="M46 6L54 12L46 18"
					stroke={color}
					strokeWidth="1.5"
					strokeLinecap="round"
					strokeLinejoin="round"
					opacity="0.6"
				/>
			</svg>
		</div>
	);
}

export function ArchitectureDiagram() {
	return (
		<div className="not-prose my-8 bg-[#0a0a0c] border border-white/[0.06] rounded-2xl p-8 overflow-x-auto">
			<div className="flex items-center justify-center gap-2 min-w-[600px]">
				{/* Internet side */}
				<div className="flex flex-col items-center gap-6 px-6 py-4 border border-white/[0.04] rounded-xl bg-white/[0.01]">
					<div className="text-[9px] font-black text-zinc-600 uppercase tracking-[0.3em] font-label">
						The Internet
					</div>
					<DiagramNode
						icon="📨"
						label="Webhook Sender"
						sublabel="Stripe / GitHub"
						color="#ffb0cd"
					/>
				</div>

				<Arrow color="#ffb0cd" />

				{/* Relay */}
				<div className="flex flex-col items-center gap-6 px-6 py-4 border border-primary/20 rounded-xl bg-primary/[0.03]">
					<div className="text-[9px] font-black text-primary uppercase tracking-[0.3em] font-label">
						Cloud Relay
					</div>
					<DiagramNode
						icon="☁️"
						label="Relay Server"
						sublabel="Cloudflare Worker"
						color="#9093ff"
					/>
				</div>

				<div className="flex flex-col items-center gap-1">
					<Arrow color="#9093ff" />
					<span className="text-[9px] font-bold text-primary/50 font-mono">
						SSE
					</span>
				</div>

				{/* Your machine */}
				<div className="flex flex-col items-center gap-4 px-6 py-4 border border-white/[0.04] rounded-xl bg-white/[0.01]">
					<div className="text-[9px] font-black text-zinc-600 uppercase tracking-[0.3em] font-label">
						Your Machine
					</div>
					<div className="flex flex-col items-center gap-3">
						<DiagramNode
							icon="🌐"
							label="Your Browser"
							sublabel="BridgeHook JS"
							color="#ddb7ff"
						/>
						<svg width="2" height="24" viewBox="0 0 2 24" fill="none">
							<path
								d="M1 0V24"
								stroke="#28c840"
								strokeWidth="1.5"
								strokeDasharray="3 3"
								opacity="0.4"
							/>
						</svg>
						<DiagramNode
							icon="💻"
							label="localhost"
							sublabel=":3000"
							color="#28c840"
						/>
					</div>
				</div>
			</div>
		</div>
	);
}

export function DataFlowDiagram() {
	return (
		<div className="not-prose my-8 bg-[#0a0a0c] border border-white/[0.06] rounded-2xl p-8">
			<div className="space-y-0">
				{[
					{
						step: "1",
						from: "Stripe",
						action: "POST /hook/ch_9x4kf2m",
						to: "Relay",
						color: "#ffb0cd",
					},
					{
						step: "2",
						from: "Relay",
						action: "Store in Neon → Push SSE",
						to: "Browser",
						color: "#9093ff",
					},
					{
						step: "3",
						from: "Browser",
						action: "fetch(localhost:3000)",
						to: "Your Server",
						color: "#ddb7ff",
					},
					{
						step: "4",
						from: "Your Server",
						action: "200 OK response",
						to: "Browser",
						color: "#28c840",
					},
					{
						step: "5",
						from: "Browser",
						action: "POST /hook/.../response",
						to: "Relay → Stripe",
						color: "#fcd34d",
					},
				].map((row, i) => (
					<div
						key={row.step}
						className="grid grid-cols-[32px_100px_1fr_100px] items-center gap-4 py-3 border-b border-white/[0.03] last:border-0"
					>
						{/* Step number */}
						<div
							className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-black font-headline"
							style={{
								background: `${row.color}15`,
								color: row.color,
								border: `1px solid ${row.color}30`,
							}}
						>
							{row.step}
						</div>

						{/* From */}
						<span className="text-xs font-bold text-white font-headline text-right">
							{row.from}
						</span>

						{/* Arrow + action */}
						<div className="flex items-center gap-3 px-2">
							<div className="flex-1 relative h-px">
								<div
									className="absolute inset-0"
									style={{
										background: `linear-gradient(to right, ${row.color}40, ${row.color}10)`,
									}}
								/>
								{/* Traveling dot */}
								<div
									className="absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full"
									style={{
										background: row.color,
										boxShadow: `0 0 8px ${row.color}`,
										animation: `flowRight 2s ease-in-out infinite`,
										animationDelay: `${i * 0.4}s`,
									}}
								/>
							</div>
							<span
								className="font-mono text-[10px] whitespace-nowrap px-2 py-1 rounded-md border shrink-0"
								style={{
									color: row.color,
									background: `${row.color}08`,
									borderColor: `${row.color}20`,
								}}
							>
								{row.action}
							</span>
						</div>

						{/* To */}
						<span className="text-xs font-bold text-zinc-400 font-headline">
							{row.to}
						</span>
					</div>
				))}
			</div>
		</div>
	);
}

/**
 * Server vs Client responsibility diagram
 */
export function ResponsibilityDiagram() {
	return (
		<div className="not-prose my-8 grid grid-cols-2 gap-4">
			{/* Server side */}
			<div className="bg-[#0a0a0c] border border-primary/15 rounded-2xl p-6">
				<div className="flex items-center gap-2 mb-4">
					<div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
						<span className="text-sm">☁️</span>
					</div>
					<div>
						<div className="text-xs font-black text-primary font-headline">
							Server-Side
						</div>
						<div className="text-[9px] text-zinc-600 font-label">
							Relay Worker + Neon DB
						</div>
					</div>
				</div>
				<ul className="space-y-2">
					{[
						"Channel CRUD",
						"Event storage",
						"SSE broadcasting",
						"Webhook receiving",
						"Rate limiting",
					].map((item) => (
						<li
							key={item}
							className="flex items-center gap-2 text-xs text-zinc-400 font-body"
						>
							<span className="w-1 h-1 rounded-full bg-primary/60" />
							{item}
						</li>
					))}
				</ul>
			</div>

			{/* Client side */}
			<div className="bg-[#0a0a0c] border border-[#28c840]/15 rounded-2xl p-6">
				<div className="flex items-center gap-2 mb-4">
					<div className="w-8 h-8 rounded-lg bg-[#28c840]/10 border border-[#28c840]/20 flex items-center justify-center">
						<span className="text-sm">🌐</span>
					</div>
					<div>
						<div className="text-xs font-black text-[#28c840] font-headline">
							Client-Side
						</div>
						<div className="text-[9px] text-zinc-600 font-label">
							Your Browser
						</div>
					</div>
				</div>
				<ul className="space-y-2">
					{[
						"Secret generation",
						"Localhost forwarding",
						"Path filtering",
						"Response capture",
						"UI rendering",
					].map((item) => (
						<li
							key={item}
							className="flex items-center gap-2 text-xs text-zinc-400 font-body"
						>
							<span className="w-1 h-1 rounded-full bg-[#28c840]/60" />
							{item}
						</li>
					))}
				</ul>
			</div>
		</div>
	);
}
