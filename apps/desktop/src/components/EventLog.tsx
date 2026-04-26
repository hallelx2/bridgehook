import { useEffect, useRef } from "react";
import type { WebhookEventPayload } from "../hooks/useEvents";
import { cn } from "../lib/cn";
import { formatTime } from "../lib/format";

interface EventLogProps {
	events: WebhookEventPayload[];
	selectedEventId: string | null;
	onSelect: (eventId: string) => void;
	loading?: boolean;
	serviceNameById?: Record<string, string>;
}

function methodClass(method: string): string {
	switch (method.toUpperCase()) {
		case "GET":
			return "method-get";
		case "POST":
			return "method-post";
		case "PUT":
			return "method-put";
		case "PATCH":
			return "method-patch";
		case "DELETE":
			return "method-delete";
		default:
			return "method-default";
	}
}

function statusToken(status: number | null, hasError: boolean) {
	if (hasError) return { text: "ERR", className: "text-err", glyph: "✕" };
	if (status === null) return { text: "···", className: "text-fg-ghost", glyph: "○" };
	if (status < 300) return { text: String(status), className: "text-ok", glyph: "✓" };
	if (status < 400) return { text: String(status), className: "text-warn", glyph: "↗" };
	if (status < 500) return { text: String(status), className: "text-warn", glyph: "!" };
	return { text: String(status), className: "text-err", glyph: "✕" };
}

function formatLatency(ms: number | null): string {
	if (ms === null || ms === undefined) return "—";
	if (ms < 1) return "<1";
	if (ms < 1000) return `${Math.round(ms)}`;
	return `${(ms / 1000).toFixed(1)}k`;
}

export function EventLog({
	events,
	selectedEventId,
	onSelect,
	loading,
	serviceNameById,
}: EventLogProps) {
	const containerRef = useRef<HTMLDivElement>(null);

	// Keyboard navigation: j/k or Arrow Down/Up
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if (e.target instanceof HTMLElement) {
				const tag = e.target.tagName;
				if (tag === "INPUT" || tag === "TEXTAREA" || e.target.isContentEditable) return;
			}
			if (events.length === 0) return;
			const currentIdx = selectedEventId ? events.findIndex((ev) => ev.id === selectedEventId) : -1;

			if (e.key === "j" || e.key === "ArrowDown") {
				e.preventDefault();
				const next = Math.min(events.length - 1, currentIdx + 1);
				if (events[next]) onSelect(events[next].id);
			} else if (e.key === "k" || e.key === "ArrowUp") {
				e.preventDefault();
				const next = Math.max(0, currentIdx === -1 ? 0 : currentIdx - 1);
				if (events[next]) onSelect(events[next].id);
			} else if (e.key === "Escape" && selectedEventId) {
				onSelect(selectedEventId);
			}
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [events, selectedEventId, onSelect]);

	if (!loading && events.length === 0) {
		return (
			<div className="h-full grid place-items-center grid-texture">
				<div className="text-center px-8 py-12 max-w-sm">
					<div className="relative w-16 h-16 mx-auto mb-6">
						<div className="absolute inset-0 border border-uranium/20 rounded-sm rotate-45" />
						<div className="absolute inset-2 border border-uranium/10 rotate-45" />
						<div className="absolute inset-0 flex items-center justify-center">
							<span className="w-2 h-2 bg-uranium/50 animate-pulse-soft" />
						</div>
					</div>
					<p className="text-display text-fg mb-2">stdin: idle</p>
					<p className="text-caption text-fg-faint leading-relaxed">
						Webhook events stream here as they arrive at your bridges.
					</p>
					<div className="mt-6 inline-flex items-center gap-2 text-micro text-fg-ghost uppercase tracking-widest">
						<KbdMicro>j</KbdMicro>
						<KbdMicro>k</KbdMicro>
						<span>navigate</span>
						<span className="text-edge-strong">·</span>
						<KbdMicro>esc</KbdMicro>
						<span>close</span>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div ref={containerRef} className="h-full overflow-auto font-sans">
			{/* Column header — sticky */}
			<div className="sticky top-0 z-10 grid grid-cols-[14px_72px_56px_140px_1fr_64px_64px] gap-2 px-3 h-7 items-center bg-ink-0 border-b border-edge text-micro text-fg-faint uppercase tracking-[0.18em] select-none">
				<span />
				<span>time</span>
				<span>verb</span>
				<span>service</span>
				<span>path</span>
				<span className="text-right">status</span>
				<span className="text-right">ms</span>
			</div>

			<ol aria-label="Webhook events" className="list-none m-0 p-0">
				{events.map((event, index) => {
					const selected = selectedEventId === event.id;
					const serviceLabel =
						event.service_name ||
						serviceNameById?.[event.service_id] ||
						event.service_id.slice(0, 8);
					const status = statusToken(event.response_status, !!event.error);
					return (
						<li
							key={event.id}
							onClick={() => onSelect(event.id)}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.preventDefault();
									onSelect(event.id);
								}
							}}
							// biome-ignore lint/a11y/noNoninteractiveTabindex: row is intentionally focusable for j/k navigation
							tabIndex={0}
							className={cn(
								"group grid grid-cols-[14px_72px_56px_140px_1fr_64px_64px] gap-2 px-3 h-7 items-center border-b border-edge/40 cursor-pointer outline-none transition-colors text-body",
								selected
									? "bg-uranium/5 rule-accent"
									: "hover:bg-ink-3/50 focus-visible:bg-ink-3/50",
								index === 0 && "animate-event-flash",
							)}
							aria-current={selected}
						>
							{/* Marker — pending: dim dot, ok: filled, error: filled red */}
							<span className="flex items-center justify-center">
								<span
									className={cn(
										"w-1 h-1 rounded-full",
										event.error
											? "bg-err"
											: event.response_status === null
												? "bg-fg-ghost animate-pulse-soft"
												: event.response_status < 400
													? "bg-uranium/70 group-hover:bg-uranium"
													: "bg-warn",
									)}
								/>
							</span>

							{/* Time */}
							<span className="text-fg-faint tabular text-micro tracking-tight">
								{formatTime(event.received_at)}
							</span>

							{/* Method */}
							<span
								className={cn(
									"justify-self-start px-1.5 py-px rounded-sm text-micro font-bold uppercase tracking-wider tabular",
									methodClass(event.method),
								)}
							>
								{event.method}
							</span>

							{/* Service */}
							<span className="text-fg-muted truncate text-caption">
								<span className="text-fg-ghost mr-1">›</span>
								{serviceLabel}
							</span>

							{/* Path */}
							<span className="text-fg truncate text-caption tabular tracking-tight">
								{event.path}
							</span>

							{/* Status */}
							<span className="justify-self-end flex items-center gap-1.5 text-caption tabular">
								<span className={cn("text-micro", status.className)}>{status.glyph}</span>
								<span className={cn("font-semibold", status.className)}>{status.text}</span>
							</span>

							{/* Latency */}
							<span className="justify-self-end text-fg-faint text-caption tabular">
								{formatLatency(event.latency_ms)}
								<span className="text-fg-ghost ml-0.5">ms</span>
							</span>
						</li>
					);
				})}
			</ol>

			{/* Footer caret — feels like a tail-following log */}
			<div className="px-3 h-6 flex items-center text-micro text-fg-ghost uppercase tracking-widest select-none border-t border-edge/40">
				<span className="text-uranium animate-caret-blink mr-1">▍</span>
				waiting on stream
			</div>
		</div>
	);
}

function KbdMicro({ children }: { children: React.ReactNode }) {
	return (
		<kbd className="px-1.5 py-0.5 rounded-sm border border-edge bg-ink-2 text-fg-muted normal-case tracking-normal">
			{children}
		</kbd>
	);
}
