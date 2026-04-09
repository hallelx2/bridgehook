function MovingBorderCard({
	children,
	className = "",
}: {
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<div className={`moving-border-card group ${className}`}>
			<div className="moving-border-content h-full">{children}</div>
		</div>
	);
}

export function BentoGrid() {
	return (
		<section id="features" className="max-w-7xl mx-auto px-8 py-32">
			<div className="flex flex-col md:flex-row justify-between items-end gap-6 mb-16">
				<div className="max-w-2xl">
					<h2 className="text-4xl md:text-5xl font-black text-white mb-4 tracking-tighter font-headline">
						Everything you need
					</h2>
					<p className="text-zinc-400 text-lg leading-relaxed">
						Stop wasting time configuring local tunnels. Capture and inspect production traffic in a
						secure sandbox instantly.
					</p>
				</div>
			</div>

			<div className="grid grid-cols-1 md:grid-cols-12 gap-5 auto-rows-[360px]">
				{/* ── Browser-Based Bridge — wide ── */}
				<MovingBorderCard className="md:col-span-7">
					<div className="p-10 flex flex-col h-full overflow-hidden relative">
						{/* Text content */}
						<div className="relative z-10 mb-8">
							<div className="w-11 h-11 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-5">
								<span className="material-symbols-outlined text-primary text-2xl">terminal</span>
							</div>
							<h3 className="text-3xl font-black text-white mb-3 tracking-tighter font-headline">
								Browser-Based Bridge
							</h3>
							<p className="text-zinc-400 text-[15px] max-w-sm leading-relaxed font-body">
								Your browser connects to the relay via SSE and forwards webhooks to localhost. No
								install, no config, no CLI.
							</p>
						</div>

						{/* Terminal — pushed to bottom-right, clearly separated */}
						<div className="absolute right-5 bottom-5 w-[55%] bg-[#0c0c0f] rounded-xl border border-white/[0.08] overflow-hidden shadow-[0_8px_30px_rgba(0,0,0,0.5)]">
							{/* Title bar */}
							<div className="flex items-center gap-1.5 px-3 py-2.5 border-b border-white/[0.06] bg-white/[0.02]">
								<div className="w-2 h-2 rounded-full bg-[#ff5f57]/60" />
								<div className="w-2 h-2 rounded-full bg-[#febc2e]/60" />
								<div className="w-2 h-2 rounded-full bg-[#28c840]/60" />
								<span className="ml-2 font-mono text-[10px] text-white/20">relay.log</span>
							</div>
							{/* Code lines */}
							<div className="p-4 font-mono text-[11px] leading-[1.9] text-white/30 group-hover:text-white/50 transition-colors duration-300">
								<div>
									<span className="text-[#28c840]/70">●</span>{" "}
									<span className="text-white/50">POST</span>{" "}
									<span className="text-primary/60">/hook/ch_abc123</span>
								</div>
								<div>
									<span className="text-white/20">→</span> SSE push to browser
								</div>
								<div>
									<span className="text-white/20">→</span>{" "}
									<span className="text-primary/50">fetch</span>
									("localhost:3000")
								</div>
								<div>
									<span className="text-[#28c840]/70">←</span>{" "}
									<span className="text-[#28c840]/50">200 OK</span>{" "}
									<span className="text-white/20">12ms</span>
								</div>
							</div>
						</div>
					</div>
				</MovingBorderCard>

				{/* ── Instant Replay — narrow ── */}
				<MovingBorderCard className="md:col-span-5">
					<div className="p-10 relative overflow-hidden h-full flex flex-col">
						<div className="w-11 h-11 rounded-xl bg-secondary/10 border border-secondary/20 flex items-center justify-center mb-5">
							<span className="material-symbols-outlined text-secondary text-2xl">history</span>
						</div>
						<h3 className="text-3xl font-black text-white mb-3 tracking-tighter font-headline">
							Instant Replay
						</h3>
						<p className="text-zinc-400 text-[15px] leading-relaxed font-body">
							Re-fire any webhook to your local server with one click. Debug edge cases without
							waiting for the provider to send again.
						</p>
						<div className="absolute bottom-[-15%] right-[-8%] text-[120px] font-black text-white/[0.03] select-none italic group-hover:text-white/[0.06] transition-colors duration-500 font-headline leading-none">
							REPLAY
						</div>
					</div>
				</MovingBorderCard>

				{/* ── Zero Install — narrow ── */}
				<MovingBorderCard className="md:col-span-5">
					<div className="p-10 relative overflow-hidden h-full flex flex-col">
						<div className="w-11 h-11 rounded-xl bg-tertiary/10 border border-tertiary/20 flex items-center justify-center mb-5">
							<span className="material-symbols-outlined text-tertiary text-2xl">bolt</span>
						</div>
						<h3 className="text-3xl font-black text-white mb-3 tracking-tighter font-headline">
							Zero Install
						</h3>
						<p className="text-zinc-400 text-[15px] leading-relaxed font-body">
							No CLI binary, no npm package, no account signup. Works on locked-down corporate
							machines &mdash; if it has a browser, it works.
						</p>
						<div className="absolute -bottom-12 -left-12 w-44 h-44 bg-tertiary/[0.06] rounded-full blur-3xl group-hover:bg-tertiary/10 transition-all duration-500" />
					</div>
				</MovingBorderCard>

				{/* ── Deep Inspection — wide ── */}
				<MovingBorderCard className="md:col-span-7">
					<div className="p-10 flex flex-col md:flex-row gap-0 h-full overflow-hidden">
						{/* Text side */}
						<div className="flex-1 flex flex-col pr-6 md:border-r border-white/[0.06]">
							<div className="w-11 h-11 rounded-xl bg-primary-fixed/10 border border-primary-fixed/20 flex items-center justify-center mb-5">
								<span className="material-symbols-outlined text-primary-fixed text-2xl">
									data_object
								</span>
							</div>
							<h3 className="text-3xl font-black text-white mb-3 tracking-tighter font-headline">
								Deep Inspection
							</h3>
							<p className="text-zinc-400 text-[15px] leading-relaxed font-body">
								View full HTTP headers, body content, query parameters, and raw source. Native JSON,
								XML, and form-data support.
							</p>
						</div>

						{/* Code side — clearly separated */}
						<div className="flex-1 flex items-center md:pl-6">
							<pre className="w-full bg-[#0c0c0f] rounded-xl border border-white/[0.08] p-5 font-mono text-[12px] leading-[1.8] text-white/40 group-hover:text-white/60 transition-colors duration-300 shadow-[0_8px_30px_rgba(0,0,0,0.4)] overflow-x-auto">
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
				</MovingBorderCard>
			</div>
		</section>
	);
}
