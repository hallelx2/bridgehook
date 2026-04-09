import { useEffect, useRef, useState } from "react";

const EVENTS = [
	{
		method: "POST",
		path: "/webhook/stripe",
		status: 200,
		time: "12ms",
		type: "checkout.session.completed",
		delay: 1.0,
	},
	{
		method: "POST",
		path: "/webhook/stripe",
		status: 200,
		time: "8ms",
		type: "payment_intent.succeeded",
		delay: 2.2,
	},
	{
		method: "POST",
		path: "/webhook/github",
		status: 201,
		time: "15ms",
		type: "push",
		delay: 3.4,
	},
	{
		method: "POST",
		path: "/webhook/stripe",
		status: 500,
		time: "3ms",
		type: "invoice.payment_failed",
		delay: 4.8,
	},
	{
		method: "POST",
		path: "/webhook/github",
		status: 200,
		time: "11ms",
		type: "pull_request.opened",
		delay: 5.8,
	},
	{
		method: "POST",
		path: "/webhook/stripe",
		status: 200,
		time: "9ms",
		type: "customer.subscription.created",
		delay: 7.0,
	},
	{
		method: "POST",
		path: "/webhook/twilio",
		status: 200,
		time: "18ms",
		type: "message.received",
		delay: 8.2,
	},
];

function AnimatedLine({ children, delay }: { children: React.ReactNode; delay: number }) {
	const ref = useRef<HTMLDivElement>(null);
	const [visible, setVisible] = useState(false);

	useEffect(() => {
		const t = setTimeout(() => setVisible(true), delay * 1000);
		return () => clearTimeout(t);
	}, [delay]);

	return (
		<div
			ref={ref}
			className="transition-all duration-500"
			style={{
				opacity: visible ? 1 : 0,
				transform: visible ? "translateY(0)" : "translateY(8px)",
			}}
		>
			{children}
		</div>
	);
}

function StatusDot({ status }: { status: number }) {
	const color =
		status >= 500
			? "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]"
			: status >= 300
				? "bg-yellow-500 shadow-[0_0_6px_rgba(234,179,8,0.5)]"
				: "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]";
	return <span className={`inline-block w-2 h-2 rounded-full ${color}`} />;
}

function MethodBadge({ method }: { method: string }) {
	return (
		<span className="font-mono text-[10px] font-black text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded px-1.5 py-0.5 tracking-wide">
			{method}
		</span>
	);
}

function CopyButton() {
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		const t = setTimeout(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		}, 3000);
		return () => clearTimeout(t);
	}, []);

	return (
		<button
			type="button"
			className={`w-full px-3 py-2 rounded-lg text-[11px] font-bold tracking-wider transition-all duration-300 font-label ${
				copied
					? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/25"
					: "bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20"
			}`}
		>
			{copied ? "Copied to clipboard!" : "Copy Webhook URL"}
		</button>
	);
}

function SidebarSection({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div>
			<div className="text-[9px] font-black text-zinc-500 uppercase tracking-[0.25em] font-label mb-2">
				{label}
			</div>
			{children}
		</div>
	);
}

export function DashboardPreview() {
	return (
		<section className="max-w-[1200px] mx-auto px-6 -mt-12 pb-32 relative z-20">
			{/* Ambient glow */}
			<div className="absolute inset-x-0 -top-20 h-[500px] bg-[radial-gradient(ellipse_70%_50%_at_50%_0%,rgba(144,147,255,0.07)_0%,transparent_70%)] pointer-events-none" />

			<div className="relative">
				{/* Outer glow ring */}
				<div className="absolute -inset-px rounded-2xl bg-gradient-to-b from-primary/20 via-white/[0.06] to-transparent pointer-events-none" />

				{/* Browser chrome */}
				<div className="bg-[#0a0a0c] rounded-2xl border border-white/[0.08] overflow-hidden shadow-[0_60px_140px_-30px_rgba(0,0,0,0.8),0_0_80px_-15px_rgba(144,147,255,0.08)]">
					{/* ── Title bar ── */}
					<div className="flex items-center justify-between px-5 py-3.5 bg-[#08080a] border-b border-white/[0.06]">
						<div className="flex items-center gap-2">
							<div className="w-3 h-3 rounded-full bg-[#ff5f57]/80" />
							<div className="w-3 h-3 rounded-full bg-[#febc2e]/80" />
							<div className="w-3 h-3 rounded-full bg-[#28c840]/80" />
						</div>

						{/* Tabs */}
						<div className="hidden sm:flex items-center gap-0 ml-6">
							<div className="flex items-center gap-2 px-4 py-1.5 bg-white/[0.04] border border-white/[0.06] border-b-0 rounded-t-lg">
								<span className="w-3 h-3 rounded bg-primary/30 flex items-center justify-center text-[6px] text-primary font-black">
									B
								</span>
								<span className="font-body text-[11px] text-zinc-300 font-medium">Dashboard</span>
							</div>
							<div className="flex items-center gap-2 px-4 py-1.5 text-zinc-600">
								<span className="font-body text-[11px] font-medium">Events</span>
							</div>
						</div>

						{/* URL bar */}
						<div className="flex-1 max-w-lg mx-4 flex items-center gap-2.5 bg-white/[0.03] border border-white/[0.05] rounded-lg px-3.5 py-2">
							<svg
								className="w-3.5 h-3.5 text-emerald-500/60 shrink-0"
								fill="currentColor"
								viewBox="0 0 20 20"
							>
								<path
									fillRule="evenodd"
									d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
									clipRule="evenodd"
								/>
							</svg>
							<span className="font-mono text-[11px] text-zinc-500">
								bridgehook-web.pages.dev/dashboard
							</span>
						</div>

						<div className="w-12" />
					</div>

					{/* ── Dashboard body ── */}
					<div className="flex min-h-[520px]">
						{/* ── Sidebar ── */}
						<div className="w-[280px] border-r border-white/[0.05] hidden lg:flex flex-col bg-[#09090b]">
							{/* Sidebar header */}
							<div className="px-6 py-5 border-b border-white/[0.05]">
								<div className="flex items-center gap-2.5">
									<div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary/30 to-primary/10 border border-primary/20 flex items-center justify-center">
										<span className="text-primary text-xs font-black font-headline">B</span>
									</div>
									<div>
										<span className="font-headline text-sm font-extrabold tracking-tight text-white block leading-none">
											bridge
											<span className="text-primary">hook</span>
										</span>
										<span className="text-[9px] text-zinc-600 font-label font-bold tracking-wider uppercase">
											Webhook Relay
										</span>
									</div>
								</div>
							</div>

							{/* Sidebar content */}
							<div className="flex-1 px-6 py-5 space-y-5 overflow-hidden">
								{/* Connection status */}
								<div className="flex items-center gap-2.5 bg-emerald-500/[0.06] border border-emerald-500/15 rounded-lg px-3.5 py-2.5">
									<span className="relative flex h-2.5 w-2.5">
										<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
										<span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
									</span>
									<span className="text-[11px] font-bold text-emerald-400 font-body">
										Bridge Connected
									</span>
								</div>

								{/* Channel */}
								<SidebarSection label="Channel ID">
									<div className="font-mono text-[13px] text-zinc-200 bg-white/[0.03] border border-white/[0.06] rounded-lg px-3 py-2">
										ch_9x4kf2m
									</div>
								</SidebarSection>

								{/* Port */}
								<SidebarSection label="Forwarding to">
									<div className="flex items-center gap-2">
										<span className="w-2 h-2 rounded-full bg-emerald-500/60" />
										<span className="font-mono text-[13px] text-emerald-400">localhost:3000</span>
									</div>
								</SidebarSection>

								{/* Webhook URL */}
								<SidebarSection label="Webhook URL">
									<div className="bg-white/[0.03] border border-white/[0.06] rounded-lg p-3 mb-3">
										<div className="font-mono text-[11px] text-primary break-all leading-relaxed">
											https://hook.bridgehook.dev /ch_9x4kf2m
										</div>
									</div>
									<CopyButton />
								</SidebarSection>

								{/* Allowed paths */}
								<SidebarSection label="Path Allowlist">
									<div className="space-y-1.5">
										{["/webhook/stripe", "/webhook/github", "/webhook/twilio"].map((p) => (
											<div
												key={p}
												className="font-mono text-[11px] text-zinc-400 flex items-center gap-2 py-1"
											>
												<span className="text-emerald-500 text-xs">&#x2713;</span>
												{p}
											</div>
										))}
									</div>
								</SidebarSection>
							</div>

							{/* Sidebar footer */}
							<div className="px-6 py-4 border-t border-white/[0.05] flex items-center gap-2">
								<div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-[10px] text-primary font-black font-headline">
									D
								</div>
								<span className="text-[11px] text-zinc-400 font-body font-medium">
									dev@company.com
								</span>
							</div>
						</div>

						{/* ── Main panel ── */}
						<div className="flex-1 flex flex-col bg-[#0c0c0e]">
							{/* Toolbar */}
							<div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.05]">
								<div className="flex items-center gap-4">
									<h3 className="text-sm font-black text-white uppercase tracking-[0.15em] font-headline">
										Live Events
									</h3>
									<span className="relative flex h-2 w-2">
										<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-60" />
										<span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
									</span>
								</div>
								<div className="flex items-center gap-3">
									{/* Filter pills */}
									<span className="text-[10px] font-bold text-zinc-500 bg-white/[0.04] border border-white/[0.06] rounded-full px-3 py-1 font-label">
										All
									</span>
									<span className="text-[10px] font-bold text-primary bg-primary/10 border border-primary/20 rounded-full px-3 py-1 font-label">
										Errors
									</span>
									<span className="text-[10px] font-bold text-zinc-600 font-body">
										{EVENTS.length} events
									</span>
								</div>
							</div>

							{/* Column headers */}
							<div className="grid grid-cols-[44px_64px_1fr_1fr_56px_56px] gap-2 px-6 py-3 border-b border-white/[0.04] bg-white/[0.01]">
								{["", "Method", "Path", "Event", "Status", "Time"].map((h) => (
									<span
										key={h || "dot"}
										className={`text-[9px] font-black text-zinc-600 uppercase tracking-[0.25em] font-label ${
											h === "Status" || h === "Time" ? "text-right" : ""
										}`}
									>
										{h}
									</span>
								))}
							</div>

							{/* Event rows */}
							<div className="flex-1 overflow-hidden">
								{EVENTS.map((evt, i) => (
									<AnimatedLine key={i} delay={evt.delay}>
										<div className="grid grid-cols-[44px_64px_1fr_1fr_56px_56px] gap-2 items-center px-6 py-3.5 hover:bg-white/[0.02] transition-colors group cursor-pointer border-b border-white/[0.02] last:border-0">
											<div className="flex justify-center">
												<StatusDot status={evt.status} />
											</div>

											<MethodBadge method={evt.method} />

											<span className="font-mono text-[12px] text-zinc-300 group-hover:text-white transition-colors truncate">
												{evt.path}
											</span>

											<span className="font-mono text-[11px] text-zinc-500 group-hover:text-zinc-400 transition-colors truncate">
												{evt.type}
											</span>

											<span
												className={`font-mono text-[12px] font-bold text-right ${
													evt.status >= 500
														? "text-red-400"
														: evt.status >= 300
															? "text-yellow-400"
															: "text-emerald-400"
												}`}
											>
												{evt.status}
											</span>

											<span className="font-mono text-[11px] text-zinc-600 text-right group-hover:text-zinc-500 transition-colors">
												{evt.time}
											</span>
										</div>
									</AnimatedLine>
								))}
							</div>

							{/* Bottom bar */}
							<div className="px-6 py-3 border-t border-white/[0.05] flex items-center justify-between bg-white/[0.01]">
								<div className="flex items-center gap-4">
									<span className="text-[10px] text-zinc-600 font-body">
										<span className="text-emerald-400 font-bold">6</span> successful
									</span>
									<span className="text-[10px] text-zinc-600 font-body">
										<span className="text-red-400 font-bold">1</span> failed
									</span>
								</div>
								<span className="text-[10px] text-zinc-600 font-body">
									Avg latency: <span className="text-zinc-400 font-bold">11ms</span>
								</span>
							</div>
						</div>
					</div>
				</div>

				{/* Reflection glow */}
				<div className="absolute -bottom-12 left-[5%] right-[5%] h-24 bg-gradient-to-b from-primary/[0.04] to-transparent blur-2xl rounded-full pointer-events-none" />
			</div>
		</section>
	);
}
