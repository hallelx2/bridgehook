import { Braces, History, Terminal, Zap } from "lucide-react";

/**
 * Flat card — replaces the old Aceternity "moving border" rotating conic
 * gradient. Just a surface with a real border and a subtle hover state.
 */
function Card({
	children,
	className = "",
}: {
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<div
			className={`relative bg-surface border border-border rounded-2xl overflow-hidden transition-colors hover:border-border-strong ${className}`}
		>
			{children}
		</div>
	);
}

export function BentoGrid() {
	return (
		<section id="features" className="max-w-7xl mx-auto px-6 py-32">
			<div className="flex flex-col md:flex-row justify-between items-end gap-6 mb-14">
				<div className="max-w-2xl">
					<h2 className="text-4xl md:text-5xl font-extrabold text-on-surface mb-4 tracking-[-0.03em]">
						Everything you need
					</h2>
					<p className="text-on-surface-variant text-lg leading-relaxed">
						Stop wasting time configuring local tunnels. Capture and inspect production traffic in a
						secure sandbox instantly.
					</p>
				</div>
			</div>

			<div className="grid grid-cols-1 md:grid-cols-12 gap-4 auto-rows-[360px]">
				{/* ── Browser-Based Bridge — wide ── */}
				<Card className="md:col-span-7 group">
					<div className="p-10 flex flex-col h-full overflow-hidden relative">
						<div className="relative z-10 mb-8">
							<div className="w-10 h-10 rounded-lg bg-primary-soft border border-primary/30 flex items-center justify-center mb-5">
								<Terminal className="text-primary" size={20} strokeWidth={1.75} />
							</div>
							<h3 className="text-2xl font-extrabold text-on-surface mb-3 tracking-[-0.02em]">
								Browser-based bridge
							</h3>
							<p className="text-on-surface-variant text-[15px] max-w-sm leading-relaxed">
								Your browser connects to the relay and forwards webhooks to localhost. No install,
								no config, no CLI.
							</p>
						</div>

						{/* Terminal — real curl output, no fake macOS dots */}
						<div className="absolute right-6 bottom-6 w-[58%] bg-background rounded-xl border border-border overflow-hidden shadow-[var(--shadow-raised)]">
							<div className="flex items-center justify-between px-4 py-2.5 border-b border-border-subtle">
								<span className="font-mono text-[10px] text-on-surface-faint tracking-wide">
									~/bridge
								</span>
								<span className="font-mono text-[10px] text-on-surface-muted">live</span>
							</div>
							<div className="p-4 font-mono text-[11px] leading-[1.85] text-on-surface-variant">
								<div>
									<span className="text-on-surface-faint">$</span> curl bridgehook.dev/ch_abc
								</div>
								<div className="text-on-surface-muted pl-3">→ relayed to browser</div>
								<div className="text-on-surface-muted pl-3">→ fetch localhost:3000</div>
								<div>
									<span className="text-success">200 OK</span>{" "}
									<span className="text-on-surface-faint">12ms</span>
								</div>
							</div>
						</div>
					</div>
				</Card>

				{/* ── Instant Replay — narrow ── */}
				<Card className="md:col-span-5">
					<div className="p-10 relative overflow-hidden h-full flex flex-col">
						<div className="w-10 h-10 rounded-lg bg-primary-soft border border-primary/30 flex items-center justify-center mb-5">
							<History className="text-primary" size={20} strokeWidth={1.75} />
						</div>
						<h3 className="text-2xl font-extrabold text-on-surface mb-3 tracking-[-0.02em]">
							Instant replay
						</h3>
						<p className="text-on-surface-variant text-[15px] leading-relaxed">
							Re-fire any webhook to your local server with one click. Debug edge cases without
							waiting for the provider to send again.
						</p>

						{/* Replay chip — concrete detail, no watermark text */}
						<div className="mt-auto flex items-center gap-2 pt-6 border-t border-border-subtle">
							<div className="font-mono text-[11px] text-on-surface-variant flex-1 truncate">
								evt_9x4kf2m
							</div>
							<button
								type="button"
								className="font-mono text-[10px] font-bold text-primary bg-primary-soft border border-primary/30 rounded px-2 py-1 tracking-wider uppercase"
							>
								Replay
							</button>
						</div>
					</div>
				</Card>

				{/* ── Zero Install — narrow ── */}
				<Card className="md:col-span-5">
					<div className="p-10 relative overflow-hidden h-full flex flex-col">
						<div className="w-10 h-10 rounded-lg bg-primary-soft border border-primary/30 flex items-center justify-center mb-5">
							<Zap className="text-primary" size={20} strokeWidth={1.75} />
						</div>
						<h3 className="text-2xl font-extrabold text-on-surface mb-3 tracking-[-0.02em]">
							Zero install
						</h3>
						<p className="text-on-surface-variant text-[15px] leading-relaxed">
							No CLI binary, no npm package, no account signup. Works on locked-down corporate
							machines &mdash; if it has a browser, it works.
						</p>
					</div>
				</Card>

				{/* ── Deep Inspection — wide ── */}
				<Card className="md:col-span-7">
					<div className="p-10 flex flex-col md:flex-row gap-0 h-full overflow-hidden">
						<div className="flex-1 flex flex-col pr-6 md:border-r border-border-subtle">
							<div className="w-10 h-10 rounded-lg bg-primary-soft border border-primary/30 flex items-center justify-center mb-5">
								<Braces className="text-primary" size={20} strokeWidth={1.75} />
							</div>
							<h3 className="text-2xl font-extrabold text-on-surface mb-3 tracking-[-0.02em]">
								Deep inspection
							</h3>
							<p className="text-on-surface-variant text-[15px] leading-relaxed">
								View full HTTP headers, body content, query parameters, and raw source. Native JSON,
								XML, and form-data support.
							</p>
						</div>

						<div className="flex-1 flex items-center md:pl-6">
							<pre className="w-full bg-background rounded-xl border border-border p-5 font-mono text-[11.5px] leading-[1.8] text-on-surface-variant overflow-x-auto">
								{`{
  "headers": {
    "stripe-signature": "t=1234...",
    "content-type": "application/json"
  },
  "body": {
    "type": "checkout.session.completed",
    "amount": 9900,
    "currency": "usd"
  }
}`}
							</pre>
						</div>
					</div>
				</Card>
			</div>
		</section>
	);
}
