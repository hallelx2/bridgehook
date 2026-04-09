import { useMemo, useState } from "react";

const NAV_SECTIONS = [
	{
		title: "Getting Started",
		items: [
			{ id: "introduction", label: "Introduction" },
			{ id: "quickstart", label: "Quickstart" },
		],
	},
	{
		title: "Core Concepts",
		items: [
			{ id: "how-it-works", label: "How It Works" },
			{ id: "sse-technology", label: "SSE Technology" },
			{ id: "browser-bridge", label: "The Browser Bridge" },
		],
	},
	{
		title: "Security",
		items: [
			{ id: "security-model", label: "Security Model" },
			{ id: "channel-secrets", label: "Channel Secrets" },
			{ id: "path-allowlist", label: "Path Allowlist" },
		],
	},
	{
		title: "Comparison",
		items: [
			{ id: "vs-ngrok", label: "vs ngrok" },
			{ id: "vs-cloudflare-tunnel", label: "vs Cloudflare Tunnel" },
			{ id: "vs-localtunnel", label: "vs localtunnel" },
			{ id: "tradeoffs", label: "Tradeoffs" },
		],
	},
	{
		title: "API Reference",
		items: [
			{ id: "relay-api", label: "Relay API" },
			{ id: "sse-events", label: "SSE Events" },
		],
	},
	{
		title: "Deployment",
		items: [
			{ id: "self-hosting", label: "Self-Hosting" },
			{ id: "architecture", label: "Architecture" },
		],
	},
];

/** Flat ordered list of all page IDs for prev/next */
const ALL_PAGES = NAV_SECTIONS.flatMap((s) => s.items);

function CopyAllDocs() {
	const [copied, setCopied] = useState(false);

	const handleCopy = () => {
		// Grab all rendered doc content from the main area
		const mainEl = document.querySelector("[data-docs-content]") as HTMLElement | null;
		if (!mainEl) return;
		const text = mainEl.innerText || mainEl.textContent || "";
		navigator.clipboard.writeText(text).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 3000);
		});
	};

	return (
		<button
			type="button"
			onClick={handleCopy}
			className={`flex items-center gap-2 w-full px-3 py-2 rounded-lg text-[11px] font-bold transition-all font-label ${
				copied
					? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
					: "bg-white/[0.03] text-zinc-500 border border-white/[0.06] hover:text-zinc-300 hover:bg-white/[0.06]"
			}`}
		>
			<svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
				{copied ? (
					<path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
				) : (
					<path strokeLinecap="round" strokeLinejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
				)}
			</svg>
			{copied ? "Copied to clipboard!" : "Copy page for LLM"}
		</button>
	);
}

function PrevNextNav({
	currentPage,
	onNavigate,
}: { currentPage: string; onNavigate: (id: string) => void }) {
	const currentIndex = ALL_PAGES.findIndex((p) => p.id === currentPage);
	const prev = currentIndex > 0 ? ALL_PAGES[currentIndex - 1] : null;
	const next =
		currentIndex < ALL_PAGES.length - 1 ? ALL_PAGES[currentIndex + 1] : null;

	return (
		<div className="not-prose flex items-stretch gap-4 mt-16 pt-8 border-t border-white/[0.06]">
			{/* Previous */}
			{prev ? (
				<button
					type="button"
					onClick={() => onNavigate(prev.id)}
					className="flex-1 group text-left p-5 rounded-xl border border-white/[0.06] bg-white/[0.01] hover:bg-white/[0.03] hover:border-white/[0.1] transition-all"
				>
					<div className="text-[9px] font-black text-zinc-600 uppercase tracking-[0.25em] font-label mb-1.5 flex items-center gap-1">
						<svg className="w-3 h-3 group-hover:-translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
							<path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
						</svg>
						Previous
					</div>
					<div className="text-sm font-bold text-zinc-300 group-hover:text-white transition-colors font-headline">
						{prev.label}
					</div>
				</button>
			) : (
				<div className="flex-1" />
			)}

			{/* Next */}
			{next ? (
				<button
					type="button"
					onClick={() => onNavigate(next.id)}
					className="flex-1 group text-right p-5 rounded-xl border border-white/[0.06] bg-white/[0.01] hover:bg-white/[0.03] hover:border-primary/20 transition-all"
				>
					<div className="text-[9px] font-black text-zinc-600 uppercase tracking-[0.25em] font-label mb-1.5 flex items-center gap-1 justify-end">
						Next
						<svg className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
							<path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
						</svg>
					</div>
					<div className="text-sm font-bold text-zinc-300 group-hover:text-primary transition-colors font-headline">
						{next.label}
					</div>
				</button>
			) : (
				<div className="flex-1" />
			)}
		</div>
	);
}

export function Layout({
	currentPage,
	onNavigate,
	children,
}: {
	currentPage: string;
	onNavigate: (page: string) => void;
	children: React.ReactNode;
}) {
	const currentLabel = useMemo(
		() => ALL_PAGES.find((p) => p.id === currentPage)?.label || "",
		[currentPage],
	);

	return (
		<div className="min-h-screen flex">
			{/* Sidebar */}
			<aside className="w-[260px] shrink-0 border-r border-white/[0.06] bg-[#08080a] fixed top-0 left-0 bottom-0 flex flex-col">
				{/* Logo */}
				<div className="px-6 py-5 border-b border-white/[0.06]">
					<a
						href="/"
						className="font-headline text-lg font-extrabold tracking-[-0.04em] text-white no-underline"
					>
						bridge<span className="text-primary">hook</span>
					</a>
					<div className="text-[9px] font-bold text-zinc-600 uppercase tracking-[0.2em] mt-1 font-label">
						Documentation
					</div>
				</div>

				{/* Nav (scrollable) */}
				<nav className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
					{NAV_SECTIONS.map((section) => (
						<div key={section.title}>
							<div className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] px-2 mb-2 font-label">
								{section.title}
							</div>
							<ul className="space-y-0.5">
								{section.items.map((item) => (
									<li key={item.id}>
										<button
											type="button"
											onClick={() => onNavigate(item.id)}
											className={`w-full text-left px-3 py-1.5 rounded-lg text-[13px] font-medium transition-all font-body ${
												currentPage === item.id
													? "bg-primary/10 text-primary border border-primary/20"
													: "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.03] border border-transparent"
											}`}
										>
											{item.label}
										</button>
									</li>
								))}
							</ul>
						</div>
					))}
				</nav>

				{/* Sidebar footer */}
				<div className="px-4 py-4 border-t border-white/[0.06] space-y-3">
					<CopyAllDocs />
					<a
						href="#"
						className="flex items-center gap-2 px-3 py-1.5 text-[11px] text-zinc-500 hover:text-primary transition-colors font-body no-underline"
					>
						<svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
							<path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
						</svg>
						GitHub
					</a>
				</div>
			</aside>

			{/* Main content */}
			<main className="flex-1 ml-[260px]">
				{/* Top bar */}
				<div className="sticky top-0 z-10 bg-background/80 backdrop-blur-xl border-b border-white/[0.04] px-12 py-3 flex items-center justify-between">
					<div className="text-[11px] font-bold text-zinc-500 font-body">
						{currentLabel}
					</div>
					<div className="text-[10px] text-zinc-600 font-mono">
						docs.bridgehook.dev
					</div>
				</div>

				<div
					className="max-w-3xl mx-auto px-12 py-12 prose"
					data-docs-content
				>
					{children}
					<PrevNextNav
						currentPage={currentPage}
						onNavigate={onNavigate}
					/>
				</div>
			</main>
		</div>
	);
}

export { ALL_PAGES, NAV_SECTIONS };
