const COMPARISONS = [
	{
		theirs: "Download CLI binary",
		ours: "Open a URL",
		icon: "download",
	},
	{
		theirs: "Create account & login",
		ours: "Completely anonymous",
		icon: "person_off",
	},
	{
		theirs: "Blocked on corporate machines",
		ours: "Works anywhere with a browser",
		icon: "lock_open",
	},
	{
		theirs: "URL rotates on restart",
		ours: "Stable URL forever",
		icon: "link",
	},
	{
		theirs: "Paid inspector add-on",
		ours: "Built-in request inspector",
		icon: "search",
	},
	{
		theirs: "Zombie tunnel processes",
		ours: "Close tab = instant kill",
		icon: "power_settings_new",
	},
];

function ComparisonRow({
	item,
	index,
}: { item: (typeof COMPARISONS)[number]; index: number }) {
	return (
		<div
			className="group grid grid-cols-[1fr_56px_1fr] items-center gap-4 md:gap-8 py-5 md:py-6 border-b border-white/[0.06] last:border-0 hover:bg-white/[0.01] transition-colors -mx-6 px-6 md:-mx-10 md:px-10"
			style={{ animationDelay: `${index * 0.1}s` }}
		>
			{/* Their way — muted, strikethrough */}
			<div className="text-right">
				<span className="text-zinc-400 text-sm md:text-[15px] font-medium line-through decoration-zinc-600 font-serif italic">
					{item.theirs}
				</span>
			</div>

			{/* Center icon */}
			<div className="relative flex items-center justify-center">
				<div className="w-11 h-11 rounded-full bg-primary/10 border border-primary/25 flex items-center justify-center group-hover:bg-primary/20 group-hover:border-primary/40 group-hover:shadow-[0_0_20px_rgba(144,147,255,0.2)] transition-all duration-300">
					<span className="material-symbols-outlined text-primary text-xl">
						{item.icon}
					</span>
				</div>
			</div>

			{/* Our way — white, bold */}
			<div>
				<span className="text-white text-sm md:text-[15px] font-bold font-headline">
					{item.ours}
				</span>
			</div>
		</div>
	);
}

const STATS = [
	{ value: "0 bytes", label: "to install", color: "#9093ff" },
	{ value: "24h", label: "auto-expiry", color: "#ddb7ff" },
	{ value: "60 req/min", label: "rate limit", color: "#ffb0cd" },
	{ value: "<200ms", label: "latency", color: "#4ade80" },
	{ value: "1MB", label: "max body", color: "#fcd34d" },
];

export function Benefits() {
	return (
		<section className="max-w-5xl mx-auto px-8 py-32 relative">
			{/* Background glow */}
			<div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary/[0.04] rounded-full blur-[120px] pointer-events-none" />

			<div className="text-center mb-16 relative z-10">
				<div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/[0.03] border border-white/[0.06] text-[10px] font-bold text-secondary tracking-[0.2em] uppercase mb-6 font-label">
					<span className="material-symbols-outlined text-secondary text-sm">
						compare_arrows
					</span>
					vs Traditional Tunnels
				</div>
				<h2 className="text-4xl md:text-6xl font-black text-white tracking-tighter font-headline mb-4">
					The old way is over
				</h2>
				<p className="text-zinc-400 text-lg max-w-xl mx-auto leading-relaxed font-body">
					Every tunnel tool makes you install software, create accounts,
					and manage processes. BridgeHook eliminates all of it.
				</p>
			</div>

			{/* Column headers */}
			<div className="grid grid-cols-[1fr_56px_1fr] items-center gap-4 md:gap-8 mb-1 px-6 md:px-10 relative z-10">
				<div className="text-right">
					<span className="text-[11px] font-black text-zinc-500 uppercase tracking-[0.25em] font-label">
						Traditional Tunnels
					</span>
				</div>
				<div className="w-11" />
				<div>
					<span className="text-[11px] font-black text-primary uppercase tracking-[0.25em] font-label">
						BridgeHook
					</span>
				</div>
			</div>

			{/* Comparison rows */}
			<div className="relative z-10 bg-[#111113] border border-white/[0.08] rounded-2xl p-6 md:p-10 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.5)]">
				{COMPARISONS.map((item, i) => (
					<ComparisonRow key={item.icon} item={item} index={i} />
				))}
			</div>

			{/* Stats strip */}
			<div className="grid grid-cols-5 gap-4 mt-12 relative z-10">
				{STATS.map((stat) => (
					<div
						key={stat.label}
						className="flex flex-col items-center text-center bg-[#111113] border border-white/[0.06] rounded-xl py-5 px-2 hover:border-white/10 transition-all"
					>
						<span
							className="text-xl md:text-2xl font-black font-headline mb-1"
							style={{ color: stat.color }}
						>
							{stat.value}
						</span>
						<span className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.15em] font-label">
							{stat.label}
						</span>
					</div>
				))}
			</div>
		</section>
	);
}
