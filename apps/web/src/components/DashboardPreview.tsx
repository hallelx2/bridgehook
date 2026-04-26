import { Lock } from "lucide-react";
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
	const color = status >= 500 ? "bg-danger" : status >= 300 ? "bg-warning" : "bg-success";
	return <span className={`inline-block w-2 h-2 rounded-full ${color}`} />;
}

function MethodBadge({ method }: { method: string }) {
	return (
		<span className="font-mono text-[10px] font-bold text-success bg-success/10 border border-success/20 rounded px-1.5 py-0.5 tracking-wide">
			{method}
		</span>
	);
}

function SidebarSection({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div>
			<div className="text-[9px] font-bold text-on-surface-muted uppercase tracking-[0.25em] mb-2">
				{label}
			</div>
			{children}
		</div>
	);
}

export function DashboardPreview() {
	return (
		<section className="max-w-[1200px] mx-auto px-6 pt-8 pb-32 relative z-20">
			<div className="relative">
				<div className="bg-surface rounded-2xl border border-border overflow-hidden shadow-[0_40px_100px_-30px_rgba(0,0,0,0.8)]">
					{/* ── Minimal browser chrome — no macOS dots ── */}
					<div className="flex items-center gap-3 px-4 py-3 bg-surface-muted border-b border-border-subtle">
						{/* Tabs */}
						<div className="flex items-center gap-2 px-3 py-1 bg-surface border border-border-subtle rounded-md">
							<span className="w-1.5 h-1.5 rounded-full bg-primary" />
							<span className="font-mono text-[11px] text-on-surface">Dashboard</span>
						</div>

						{/* URL bar */}
						<div className="flex-1 max-w-lg flex items-center gap-2 bg-background border border-border-subtle rounded-md px-3 py-1.5">
							<Lock size={11} strokeWidth={2} className="text-on-surface-muted shrink-0" />
							<span className="font-mono text-[11px] text-on-surface-variant">
								bridgehook.dev/dashboard
							</span>
						</div>
					</div>

					{/* ── Dashboard body ── */}
					<div className="flex min-h-[520px]">
						{/* ── Sidebar ── */}
						<div className="w-[280px] border-r border-border-subtle hidden lg:flex flex-col bg-surface-muted">
							<div className="px-6 py-5 border-b border-border-subtle">
								<div className="flex items-center gap-2.5">
									<div className="w-8 h-8 rounded-lg bg-primary-soft border border-primary/30 flex items-center justify-center">
										<span className="text-primary text-xs font-extrabold">B</span>
									</div>
									<div>
										<span className="text-sm font-extrabold tracking-tight text-on-surface block leading-none">
											bridge
											<span className="text-primary">hook</span>
										</span>
										<span className="text-[9px] text-on-surface-muted font-bold tracking-wider uppercase">
											Webhook relay
										</span>
									</div>
								</div>
							</div>

							<div className="flex-1 px-6 py-5 space-y-5 overflow-hidden">
								{/* Connection status */}
								<div className="flex items-center gap-2.5 bg-success/10 border border-success/25 rounded-md px-3 py-2">
									<span className="w-2 h-2 rounded-full bg-success" />
									<span className="text-[11px] font-bold text-success">Bridge connected</span>
								</div>

								<SidebarSection label="Channel ID">
									<div className="font-mono text-[13px] text-on-surface bg-background border border-border-subtle rounded-md px-3 py-2">
										ch_9x4kf2m
									</div>
								</SidebarSection>

								<SidebarSection label="Forwarding to">
									<div className="flex items-center gap-2">
										<span className="w-2 h-2 rounded-full bg-success" />
										<span className="font-mono text-[13px] text-success">localhost:3000</span>
									</div>
								</SidebarSection>

								<SidebarSection label="Webhook URL">
									<div className="bg-background border border-border-subtle rounded-md p-3 mb-3">
										<div className="font-mono text-[11px] text-primary break-all leading-relaxed">
											https://hook.bridgehook.dev /ch_9x4kf2m
										</div>
									</div>
									<button
										type="button"
										className="w-full px-3 py-2 rounded-md text-[11px] font-bold tracking-wider bg-primary-soft text-primary border border-primary/30 hover:bg-primary/20 transition-colors"
									>
										Copy webhook URL
									</button>
								</SidebarSection>

								<SidebarSection label="Path allowlist">
									<div className="space-y-1.5">
										{["/webhook/stripe", "/webhook/github", "/webhook/twilio"].map((p) => (
											<div
												key={p}
												className="font-mono text-[11px] text-on-surface-variant flex items-center gap-2 py-1"
											>
												<span className="text-success text-xs">&#x2713;</span>
												{p}
											</div>
										))}
									</div>
								</SidebarSection>
							</div>

							<div className="px-6 py-4 border-t border-border-subtle flex items-center gap-2">
								<div className="w-6 h-6 rounded-full bg-primary-soft border border-primary/30 flex items-center justify-center text-[10px] text-primary font-extrabold">
									D
								</div>
								<span className="text-[11px] text-on-surface-variant font-medium">
									dev@company.com
								</span>
							</div>
						</div>

						{/* ── Main panel ── */}
						<div className="flex-1 flex flex-col bg-background">
							<div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle">
								<div className="flex items-center gap-3">
									<h3 className="text-[11px] font-bold text-on-surface uppercase tracking-[0.2em]">
										Live events
									</h3>
									<span className="w-1.5 h-1.5 rounded-full bg-primary" />
								</div>
								<div className="flex items-center gap-3">
									<span className="text-[10px] font-bold text-on-surface-muted bg-surface-2 border border-border-subtle rounded-full px-3 py-1">
										All
									</span>
									<span className="text-[10px] font-bold text-primary bg-primary-soft border border-primary/30 rounded-full px-3 py-1">
										Errors
									</span>
									<span className="text-[10px] font-medium text-on-surface-muted">
										{EVENTS.length} events
									</span>
								</div>
							</div>

							<div className="grid grid-cols-[44px_64px_1fr_1fr_56px_56px] gap-2 px-6 py-3 border-b border-border-subtle bg-surface-muted">
								{["", "Method", "Path", "Event", "Status", "Time"].map((h) => (
									<span
										key={h || "dot"}
										className={`text-[9px] font-bold text-on-surface-muted uppercase tracking-[0.25em] ${
											h === "Status" || h === "Time" ? "text-right" : ""
										}`}
									>
										{h}
									</span>
								))}
							</div>

							<div className="flex-1 overflow-hidden">
								{EVENTS.map((evt, i) => (
									<AnimatedLine key={i} delay={evt.delay}>
										<div className="grid grid-cols-[44px_64px_1fr_1fr_56px_56px] gap-2 items-center px-6 py-3.5 hover:bg-surface transition-colors group cursor-pointer border-b border-border-subtle last:border-0">
											<div className="flex justify-center">
												<StatusDot status={evt.status} />
											</div>

											<MethodBadge method={evt.method} />

											<span className="font-mono text-[12px] text-on-surface-variant group-hover:text-on-surface transition-colors truncate">
												{evt.path}
											</span>

											<span className="font-mono text-[11px] text-on-surface-muted group-hover:text-on-surface-variant transition-colors truncate">
												{evt.type}
											</span>

											<span
												className={`font-mono text-[12px] font-bold text-right ${
													evt.status >= 500
														? "text-danger"
														: evt.status >= 300
															? "text-warning"
															: "text-success"
												}`}
											>
												{evt.status}
											</span>

											<span className="font-mono text-[11px] text-on-surface-muted text-right">
												{evt.time}
											</span>
										</div>
									</AnimatedLine>
								))}
							</div>

							<div className="px-6 py-3 border-t border-border-subtle flex items-center justify-between bg-surface-muted">
								<div className="flex items-center gap-4">
									<span className="text-[10px] text-on-surface-muted">
										<span className="text-success font-bold">6</span> successful
									</span>
									<span className="text-[10px] text-on-surface-muted">
										<span className="text-danger font-bold">1</span> failed
									</span>
								</div>
								<span className="text-[10px] text-on-surface-muted">
									Avg latency: <span className="text-on-surface-variant font-bold">11ms</span>
								</span>
							</div>
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}
