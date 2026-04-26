import {
	ArrowLeftRight,
	Download,
	Link as LinkIcon,
	Power,
	Search,
	Unlock,
	UserX,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

const COMPARISONS: { theirs: string; ours: string; Icon: LucideIcon }[] = [
	{
		theirs: "Download CLI binary",
		ours: "Open a URL",
		Icon: Download,
	},
	{
		theirs: "Create account & login",
		ours: "Completely anonymous",
		Icon: UserX,
	},
	{
		theirs: "Blocked on corporate machines",
		ours: "Works anywhere with a browser",
		Icon: Unlock,
	},
	{
		theirs: "URL rotates on restart",
		ours: "Stable URL forever",
		Icon: LinkIcon,
	},
	{
		theirs: "Paid inspector add-on",
		ours: "Built-in request inspector",
		Icon: Search,
	},
	{
		theirs: "Zombie tunnel processes",
		ours: "Close tab = instant kill",
		Icon: Power,
	},
];

function ComparisonRow({ item }: { item: (typeof COMPARISONS)[number] }) {
	const { Icon } = item;
	return (
		<div className="group grid grid-cols-[1fr_56px_1fr] items-center gap-4 md:gap-8 py-5 md:py-6 border-b border-border-subtle last:border-0 -mx-6 px-6 md:-mx-10 md:px-10">
			{/* Their way — muted, no strikethrough or italic */}
			<div className="text-right">
				<span className="text-on-surface-muted text-sm md:text-[15px] font-medium">
					{item.theirs}
				</span>
			</div>

			{/* Center icon */}
			<div className="relative flex items-center justify-center">
				<div className="w-10 h-10 rounded-lg bg-primary-soft border border-primary/30 flex items-center justify-center transition-colors group-hover:border-primary/60">
					<Icon className="text-primary" size={18} strokeWidth={1.75} />
				</div>
			</div>

			{/* Our way — crisp white, bold */}
			<div>
				<span className="text-on-surface text-sm md:text-[15px] font-semibold">{item.ours}</span>
			</div>
		</div>
	);
}

const STATS = [
	{ value: "0 bytes", label: "to install" },
	{ value: "24h", label: "auto-expiry" },
	{ value: "60/min", label: "rate limit" },
	{ value: "<200ms", label: "latency" },
	{ value: "1MB", label: "max body" },
];

export function Benefits() {
	return (
		<section className="max-w-5xl mx-auto px-6 py-32 relative">
			<div className="text-center mb-14 relative z-10">
				<div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface border border-border text-[10px] font-bold text-primary tracking-[0.2em] uppercase mb-6">
					<ArrowLeftRight size={12} strokeWidth={2} />
					vs Traditional Tunnels
				</div>
				<h2 className="text-4xl md:text-6xl font-extrabold text-on-surface tracking-[-0.035em] mb-4">
					The old way is over
				</h2>
				<p className="text-on-surface-variant text-lg max-w-xl mx-auto leading-relaxed">
					Every tunnel tool makes you install software, create accounts, and manage processes.
					BridgeHook eliminates all of it.
				</p>
			</div>

			{/* Column headers */}
			<div className="grid grid-cols-[1fr_56px_1fr] items-center gap-4 md:gap-8 mb-1 px-6 md:px-10 relative z-10">
				<div className="text-right">
					<span className="text-[11px] font-bold text-on-surface-muted uppercase tracking-[0.25em]">
						Traditional tunnels
					</span>
				</div>
				<div className="w-10" />
				<div>
					<span className="text-[11px] font-bold text-primary uppercase tracking-[0.25em]">
						BridgeHook
					</span>
				</div>
			</div>

			{/* Comparison rows */}
			<div className="relative z-10 bg-surface border border-border rounded-2xl p-6 md:p-10">
				{COMPARISONS.map((item) => (
					<ComparisonRow key={item.ours} item={item} />
				))}
			</div>

			{/* Stats strip */}
			<div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-10 relative z-10">
				{STATS.map((stat) => (
					<div
						key={stat.label}
						className="flex flex-col items-center text-center bg-surface border border-border rounded-xl py-5 px-2 hover:border-border-strong transition-colors"
					>
						<span className="text-xl md:text-2xl font-extrabold text-on-surface tracking-[-0.01em] mb-1">
							{stat.value}
						</span>
						<span className="text-[10px] font-bold text-on-surface-muted uppercase tracking-[0.15em]">
							{stat.label}
						</span>
					</div>
				))}
			</div>
		</section>
	);
}
