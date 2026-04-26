import { ArrowRight, Check, Clipboard, Loader2, RefreshCw, Terminal, Zap } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createChannel, pollEvents } from "../lib/relay";
import type { WebhookEventData } from "../lib/relay";

type DemoState =
	| { kind: "idle" }
	| { kind: "creating" }
	| { kind: "live"; channelId: string; webhookUrl: string }
	| { kind: "error"; message: string };

/**
 * Inline live demo that sits in the hero.
 *
 * A visitor clicks "Generate" → we hit the real relay and get a working
 * webhook URL. A copy-able curl snippet is shown. As soon as any HTTP
 * request lands at that URL, it appears below within ~2 seconds.
 *
 * We intentionally don't use the useBridge hook here — no localhost
 * forwarding, no response roundtrip. The demo is purely "show me a
 * webhook landing in real time", which is the shortest path to the
 * "aha" moment for the product.
 */
export function HeroLiveDemo() {
	const [state, setState] = useState<DemoState>({ kind: "idle" });
	const [events, setEvents] = useState<WebhookEventData[]>([]);
	const [copied, setCopied] = useState(false);
	const stopPollRef = useRef<(() => void) | null>(null);

	useEffect(() => {
		return () => {
			stopPollRef.current?.();
		};
	}, []);

	useEffect(() => {
		if (!copied) return;
		const t = setTimeout(() => setCopied(false), 2000);
		return () => clearTimeout(t);
	}, [copied]);

	const start = useCallback(async () => {
		try {
			setState({ kind: "creating" });
			setEvents([]);
			// port=3000 is a placeholder; relay requires 1-65535 but we don't forward.
			// allowedPaths=[] means "allow all" on the relay side.
			const channel = await createChannel(3000, []);
			setState({
				kind: "live",
				channelId: channel.channelId,
				webhookUrl: channel.webhookUrl,
			});
			const stop = pollEvents(
				channel.channelId,
				(evts) => {
					if (evts.length > 0) setEvents(evts);
				},
				() => {
					// Transient polling failures are not fatal — keep trying silently.
				},
				2000,
			);
			stopPollRef.current = stop;
		} catch (err) {
			setState({ kind: "error", message: (err as Error).message });
		}
	}, []);

	const reset = useCallback(() => {
		stopPollRef.current?.();
		stopPollRef.current = null;
		setEvents([]);
		setState({ kind: "idle" });
	}, []);

	const copyUrl = (url: string) => {
		navigator.clipboard
			.writeText(url)
			.then(() => setCopied(true))
			.catch(() => setCopied(false));
	};

	return (
		<div id="try" className="w-full max-w-3xl mx-auto px-6 scroll-mt-24">
			<div className="relative bg-surface border border-border rounded-2xl overflow-hidden shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)]">
				{/* Accent top strip */}
				<div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-primary to-transparent" />

				{/* Header */}
				<div className="flex items-center justify-between px-5 py-3 border-b border-border-subtle bg-surface-muted">
					<div className="flex items-center gap-2">
						<Terminal size={14} strokeWidth={2} className="text-primary" />
						<span className="text-[11px] font-bold text-on-surface uppercase tracking-[0.2em]">
							Try it live
						</span>
					</div>
					{state.kind === "live" && (
						<div className="flex items-center gap-2">
							<span className="w-1.5 h-1.5 rounded-full bg-success" />
							<span className="text-[11px] font-bold text-success">Channel live</span>
						</div>
					)}
					{state.kind === "error" && (
						<span className="text-[11px] font-bold text-danger">Error</span>
					)}
				</div>

				{/* Body */}
				{state.kind === "idle" && <IdleBody onStart={start} />}
				{state.kind === "creating" && <CreatingBody />}
				{state.kind === "live" && (
					<LiveBody
						webhookUrl={state.webhookUrl}
						events={events}
						onCopy={() => copyUrl(state.webhookUrl)}
						onReset={reset}
						copied={copied}
					/>
				)}
				{state.kind === "error" && <ErrorBody message={state.message} onRetry={start} />}
			</div>
		</div>
	);
}

function IdleBody({ onStart }: { onStart: () => void }) {
	return (
		<div className="px-6 py-8 text-left">
			<div className="flex items-start gap-4 mb-6">
				<div className="w-10 h-10 rounded-lg bg-primary-soft border border-primary/30 flex items-center justify-center shrink-0">
					<Zap className="text-primary" size={18} strokeWidth={1.75} />
				</div>
				<div>
					<h3 className="text-lg font-bold text-on-surface tracking-tight mb-1">
						Get a working webhook URL in 10 seconds
					</h3>
					<p className="text-[13px] text-on-surface-variant leading-relaxed">
						No signup. We spin up a real channel, you curl it, and the request appears here live.
					</p>
				</div>
			</div>
			<button
				type="button"
				onClick={onStart}
				className="inline-flex items-center gap-2 px-5 py-3 bg-primary text-background font-bold rounded-lg text-[14px] hover:bg-primary-dim transition-colors"
			>
				Generate demo URL
				<ArrowRight size={16} strokeWidth={2.25} />
			</button>
		</div>
	);
}

function CreatingBody() {
	return (
		<div className="px-6 py-16 flex flex-col items-center justify-center gap-3">
			<Loader2 className="animate-spin text-primary" size={22} strokeWidth={2} />
			<span className="text-[12px] text-on-surface-variant font-mono">provisioning channel…</span>
		</div>
	);
}

function LiveBody({
	webhookUrl,
	events,
	onCopy,
	onReset,
	copied,
}: {
	webhookUrl: string;
	events: WebhookEventData[];
	onCopy: () => void;
	onReset: () => void;
	copied: boolean;
}) {
	const curl = `curl -X POST ${webhookUrl} \\\n  -H "Content-Type: application/json" \\\n  -d '{"hello":"world"}'`;

	return (
		<div className="divide-y divide-border-subtle">
			{/* URL row */}
			<div className="px-5 py-4">
				<div className="text-[9px] font-bold text-on-surface-muted uppercase tracking-[0.25em] mb-2">
					Your webhook URL
				</div>
				<div className="flex items-stretch gap-2">
					<div className="flex-1 bg-background border border-border rounded-lg px-3 py-2.5 font-mono text-[12px] text-primary overflow-x-auto">
						{webhookUrl}
					</div>
					<button
						type="button"
						onClick={onCopy}
						aria-label={copied ? "Copied" : "Copy webhook URL"}
						className={`shrink-0 inline-flex items-center gap-1.5 px-3 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-colors ${
							copied
								? "bg-success/15 text-success border border-success/25"
								: "bg-primary-soft text-primary border border-primary/30 hover:bg-primary/20"
						}`}
					>
						{copied ? (
							<>
								<Check size={12} strokeWidth={2.5} />
								Copied
							</>
						) : (
							<>
								<Clipboard size={12} strokeWidth={2} />
								Copy
							</>
						)}
					</button>
				</div>
			</div>

			{/* Curl snippet */}
			<div className="px-5 py-4">
				<div className="text-[9px] font-bold text-on-surface-muted uppercase tracking-[0.25em] mb-2">
					Or paste this in your terminal
				</div>
				<pre className="bg-background border border-border rounded-lg px-3 py-2.5 font-mono text-[11.5px] leading-[1.7] text-on-surface-variant overflow-x-auto">
					{curl}
				</pre>
			</div>

			{/* Event feed */}
			<div className="px-5 py-4">
				<div className="flex items-center justify-between mb-2">
					<div className="text-[9px] font-bold text-on-surface-muted uppercase tracking-[0.25em]">
						Incoming requests
					</div>
					<button
						type="button"
						onClick={onReset}
						className="inline-flex items-center gap-1.5 text-[10px] font-bold text-on-surface-muted uppercase tracking-wider hover:text-on-surface transition-colors"
					>
						<RefreshCw size={11} strokeWidth={2} />
						Reset
					</button>
				</div>

				{events.length === 0 ? (
					<div className="bg-background border border-border-subtle rounded-lg px-4 py-5 flex items-center gap-3">
						<span className="relative flex h-2 w-2">
							<span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-60 animate-ping" />
							<span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
						</span>
						<span className="text-[12.5px] text-on-surface-variant">
							Listening for your first request…
						</span>
					</div>
				) : (
					<div className="space-y-2">
						{events.slice(0, 5).map((evt) => (
							<EventPreview key={evt.id} event={evt} />
						))}
					</div>
				)}
			</div>
		</div>
	);
}

function EventPreview({ event }: { event: WebhookEventData }) {
	const [expanded, setExpanded] = useState(false);
	const path = event.path.replace(/^\/hook\/[a-z0-9]+/, "") || "/";
	let prettyBody = event.requestBody || "";
	try {
		prettyBody = JSON.stringify(JSON.parse(event.requestBody || ""), null, 2);
	} catch {
		// leave as-is
	}

	return (
		<div className="bg-background border border-border-subtle rounded-lg overflow-hidden">
			<button
				type="button"
				onClick={() => setExpanded((v) => !v)}
				aria-expanded={expanded}
				className="w-full text-left px-3 py-2.5 flex items-center gap-3 hover:bg-surface transition-colors"
			>
				<span className="font-mono text-[10px] font-bold text-success bg-success/10 border border-success/20 rounded px-1.5 py-0.5 shrink-0">
					{event.method}
				</span>
				<span className="font-mono text-[12px] text-on-surface-variant truncate flex-1">
					{path}
				</span>
				<span className="font-mono text-[10.5px] text-on-surface-muted shrink-0">
					{new Date(event.receivedAt).toLocaleTimeString()}
				</span>
			</button>
			{expanded && (
				<div className="border-t border-border-subtle px-3 py-3 space-y-3 bg-surface-muted">
					<div>
						<div className="text-[9px] font-bold text-on-surface-muted uppercase tracking-[0.2em] mb-1.5">
							Headers
						</div>
						<pre className="font-mono text-[10.5px] text-on-surface-variant overflow-x-auto max-h-28 overflow-y-auto">
							{(() => {
								try {
									return JSON.stringify(JSON.parse(event.requestHeaders), null, 2);
								} catch {
									return event.requestHeaders;
								}
							})()}
						</pre>
					</div>
					{prettyBody && (
						<div>
							<div className="text-[9px] font-bold text-on-surface-muted uppercase tracking-[0.2em] mb-1.5">
								Body
							</div>
							<pre className="font-mono text-[10.5px] text-on-surface-variant overflow-x-auto max-h-36 overflow-y-auto">
								{prettyBody}
							</pre>
						</div>
					)}
				</div>
			)}
		</div>
	);
}

function ErrorBody({ message, onRetry }: { message: string; onRetry: () => void }) {
	return (
		<div className="px-6 py-6">
			<p className="text-[13px] text-danger font-mono mb-4">{message}</p>
			<button
				type="button"
				onClick={onRetry}
				className="inline-flex items-center gap-2 px-4 py-2 bg-surface border border-border-strong text-on-surface font-semibold rounded-lg text-[13px] hover:bg-surface-2 transition-colors"
			>
				<RefreshCw size={14} strokeWidth={2} />
				Try again
			</button>
		</div>
	);
}
