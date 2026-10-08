import {
	ArrowLeftRight,
	Bot,
	Download,
	Inbox,
	Link as LinkIcon,
	Search,
	Unlock,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

const COMPARISONS: { theirs: string; ours: string; Icon: LucideIcon }[] = [
	{
		theirs: "Download a tunnel binary",
		ours: "Install an extension, or nothing",
		Icon: Download,
	},
	{
		theirs: "Webhooks fail while you are offline",
		ours: "Queued, delivered in order later",
		Icon: Inbox,
	},
	{
		theirs: "Blocked on corporate machines",
		ours: "Works anywhere with a browser",
		Icon: Unlock,
	},
	{
		theirs: "URL tied to a running process",
		ours: "Permanent URL per port",
		Icon: LinkIcon,
	},
	{
		theirs: "Shows the request only",
		ours: "Your handler's reply, with replay",
		Icon: Search,
	},
	{
		theirs: "Agents cannot see the result",
		ours: "MCP: agents test their own handlers",
		Icon: Bot,
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
	{ value: "0 bytes", label: "to install (tab mode)" },
	{ value: "1 URL", label: "per port, permanent" },
	{ value: "8", label: "MCP tools" },
	{ value: "100 s", label: "max sync reply wait" },
	{ value: "1 MB", label: "max body" },
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
					Tunnels expose a port.
					<br />
					BridgeHook keeps the webhooks.
				</h2>
				<p className="text-on-surface-variant text-lg max-w-xl mx-auto leading-relaxed">
					A tunnel only works while its process runs, and it shows you the request. BridgeHook holds
					every webhook until your machine can take it, and shows what your code answered.
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
