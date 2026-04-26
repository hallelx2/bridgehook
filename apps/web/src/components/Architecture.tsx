import { Cpu, Globe2, Layers } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Editorial-technical section that tells the *why-now* story:
 *  – three converging unlocks that made the browser-as-tunnel viable
 *  – the entire wire format on a postcard
 *  – an honest prior-art callout (smee.io) that disarms the "you're not first"
 *    critique up front and turns it into a strength.
 *
 * Slots between <ScrollFlow /> and <Benefits /> on the landing page.
 */
const UNLOCKS: {
	year: string;
	Icon: LucideIcon;
	title: string;
	body: string;
	code: string;
}[] = [
	{
		year: "2016",
		Icon: Globe2,
		title: "Browsers let HTTPS pages fetch localhost",
		body: "The W3C secure-contexts spec promoted localhost to a potentially-trustworthy origin. HTTPS pages can fetch http://localhost without mixed-content blocking. Without this, a browser tab cannot reach your dev server. Without this, BridgeHook cannot exist.",
		code: 'fetch("http://localhost:3000/webhook/stripe")',
	},
	{
		year: "2021",
		Icon: Cpu,
		title: "Cloudflare Durable Objects went GA",
		body: 'A single, persistent actor instance per channel ID. Workers max out at 30 seconds — Durable Objects hold SSE writers indefinitely and hibernate when idle. This is what makes "open the bridge all day on the free tier" actually feasible.',
		code: "env.CHANNEL.idFromName(channelId)",
	},
	{
		year: "now",
		Icon: Layers,
		title: "We wrapped both in an observability layer",
		body: "Filter, replay, edit-and-replay, signature verification, mock responses, percentiles, command palette. The same browser tab that proxies your webhooks also inspects them. Nobody else shipped this combination.",
		code: "<BridgeHook events={live} />",
	},
];

const WIRE_FORMAT = [
	{ method: "POST", path: "/api/channels", arrow: "{ channelId, secret }" },
	{ method: "GET", path: "/hook/:id/events?secret=…", arrow: "Server-Sent Events" },
	{ method: "POST", path: "/hook/:id/response", arrow: "204 No Content" },
	{ method: "DELETE", path: "/api/channels/:id", arrow: "{ deleted: true }" },
];

export function Architecture() {
	return (
		<section id="architecture" className="relative max-w-7xl mx-auto px-6 py-32">
			{/* Decorative grid texture, kept very subtle */}
			<div className="absolute inset-0 grid-overlay opacity-30 pointer-events-none" />

			{/* ── Header ─────────────────────────────────────────────── */}
			<div className="relative z-10 max-w-3xl mb-20">
				<div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface border border-border text-[10px] font-bold text-primary tracking-[0.2em] uppercase mb-6">
					<span className="w-1.5 h-1.5 rounded-full bg-primary" />
					Architecture, on the record
				</div>
				<h2 className="text-4xl md:text-6xl lg:text-7xl font-extrabold text-on-surface tracking-[-0.04em] leading-[0.95] mb-6">
					Three things lined up.
					<br />
					<span className="text-on-surface-variant">Then we shipped.</span>
				</h2>
				<p className="text-on-surface-variant text-lg md:text-xl leading-relaxed">
					Webhook tunnels are not new. Inspecting them in a browser tab is. Here's what changed —
					and what we built on top.
				</p>
			</div>

			{/* ── Three unlock cards ─────────────────────────────────── */}
			<div className="relative z-10 grid grid-cols-1 md:grid-cols-3 gap-4 mb-20">
				{UNLOCKS.map((u, i) => {
					const { Icon } = u;
					return (
						<article
							key={u.title}
							className="bg-surface border border-border rounded-2xl p-7 flex flex-col hover:border-border-strong transition-colors"
						>
							<div className="flex items-center justify-between mb-6">
								<span className="font-mono text-[10px] font-bold text-on-surface-muted uppercase tracking-[0.25em]">
									Unlock {String(i + 1).padStart(2, "0")} · {u.year}
								</span>
								<div className="w-9 h-9 rounded-lg bg-primary-soft border border-primary/30 flex items-center justify-center">
									<Icon className="text-primary" size={18} strokeWidth={1.75} />
								</div>
							</div>

							<h3 className="text-xl font-extrabold text-on-surface tracking-[-0.02em] mb-3 leading-tight">
								{u.title}
							</h3>
							<p className="text-on-surface-variant text-[14px] leading-relaxed mb-5 flex-1">
								{u.body}
							</p>

							<pre className="bg-background border border-border-subtle rounded-lg px-3 py-2.5 font-mono text-[11px] text-primary overflow-x-auto leading-relaxed">
								{u.code}
							</pre>
						</article>
					);
				})}
			</div>

			{/* ── Wire format card ───────────────────────────────────── */}
			<div className="relative z-10 grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] gap-6 mb-20">
				<div className="flex flex-col justify-between">
					<div>
						<span className="font-mono text-[10px] font-bold text-on-surface-muted uppercase tracking-[0.25em] mb-4 block">
							The whole protocol
						</span>
						<h3 className="text-3xl md:text-4xl font-extrabold text-on-surface tracking-[-0.03em] leading-[1.05] mb-5">
							Four endpoints.
							<br />
							<span className="text-on-surface-variant">No custom protocol.</span>
						</h3>
						<p className="text-on-surface-variant text-[15px] leading-relaxed mb-6">
							ngrok ships a binary that speaks muxado. cloudflared ships a binary that speaks QUIC.
							We ship a webpage that speaks HTTP. The agent — your browser, a CLI, anything — is
							just an HTTP client looping over four endpoints.
						</p>
						<p className="text-on-surface-muted text-[13px] leading-relaxed">
							Plain JSON on the wire. <code className="font-mono text-on-surface">curl</code> can
							debug it. Any language can be the client. The whole protocol fits on a postcard.
						</p>
					</div>
				</div>

				<div className="bg-surface border border-border rounded-2xl overflow-hidden">
					<div className="flex items-center justify-between px-5 py-3 border-b border-border-subtle bg-surface-muted">
						<span className="font-mono text-[10px] font-bold text-on-surface-muted uppercase tracking-[0.25em]">
							Wire format
						</span>
						<span className="font-mono text-[10px] text-on-surface-faint">v1</span>
					</div>
					<div className="p-2 sm:p-5 font-mono text-[12px] sm:text-[13px] leading-[2]">
						{WIRE_FORMAT.map((row) => (
							<div
								key={row.path}
								className="grid grid-cols-[60px_1fr_auto] sm:grid-cols-[72px_1fr_auto] items-baseline gap-3 sm:gap-4 px-2 py-1 hover:bg-surface-2 rounded transition-colors"
							>
								<span className="font-bold text-primary uppercase">{row.method}</span>
								<span className="text-on-surface truncate" title={row.path}>
									{row.path}
								</span>
								<span className="text-on-surface-muted text-[11px] text-right whitespace-nowrap">
									→ {row.arrow}
								</span>
							</div>
						))}
					</div>
					<div className="px-5 py-3 border-t border-border-subtle bg-surface-muted text-[11px] text-on-surface-muted">
						That's the entire protocol. The browser dashboard, a CLI, a mobile app — they all run
						these same four calls.
					</div>
				</div>
			</div>

			{/* ── Prior art / honesty block ──────────────────────────── */}
			<div className="relative z-10 bg-surface border border-border rounded-2xl p-8 md:p-12">
				<div className="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-6 md:gap-10 items-start">
					<div className="md:max-w-[180px]">
						<span className="font-mono text-[10px] font-bold text-primary uppercase tracking-[0.25em] block mb-3">
							On the record
						</span>
						<h3 className="text-2xl md:text-3xl font-extrabold text-on-surface tracking-[-0.025em] leading-[1.05]">
							Prior art
							<br />
							<span className="text-on-surface-variant">matters.</span>
						</h3>
					</div>

					<div className="space-y-4 text-[15px] leading-relaxed text-on-surface-variant">
						<p>
							We did not invent SSE-based webhook relaying.{" "}
							<a
								href="https://smee.io"
								target="_blank"
								rel="noreferrer"
								className="text-primary font-semibold no-underline hover:underline"
							>
								smee.io
							</a>{" "}
							by the Probot team has been doing this since 2017. We owe them the wire shape and a
							lot of clarity about what's possible. If you want a minimal, mature SSE relay, use
							smee.io — it's good.
						</p>
						<p className="text-on-surface">
							What's actually new in BridgeHook is the combination:{" "}
							<strong>browser as the localhost forwarder</strong> (only viable since browsers
							relaxed mixed-content rules for localhost),{" "}
							<strong>Cloudflare Durable Objects holding the SSE</strong> (hibernating, free,
							global), and a <strong>full observability UI</strong> on top. All three lined up, so
							we shipped the product.
						</p>
						<div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-4 mt-2 border-t border-border-subtle">
							<PriorArtPill name="smee.io" kind="SSE relay (2017)" link="https://smee.io" />
							<PriorArtPill
								name="ngrok / cloudflared"
								kind="Install-required tunnels"
								link="https://ngrok.com"
							/>
							<PriorArtPill
								name="webhook.site"
								kind="Capture-only inspector"
								link="https://webhook.site"
							/>
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}

function PriorArtPill({ name, kind, link }: { name: string; kind: string; link: string }) {
	return (
		<a
			href={link}
			target="_blank"
			rel="noreferrer"
			className="group bg-background border border-border-subtle rounded-lg px-4 py-3 hover:border-border-strong transition-colors no-underline"
		>
			<div className="font-mono text-[12px] font-bold text-on-surface group-hover:text-primary transition-colors mb-0.5">
				{name}
			</div>
			<div className="text-[11px] text-on-surface-muted">{kind}</div>
		</a>
	);
}
