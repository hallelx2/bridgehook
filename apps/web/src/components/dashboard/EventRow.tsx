import { ChevronDown, ChevronRight } from "lucide-react";
import type { LiveEvent } from "../../hooks/useBridge";
import { absoluteTime, relativeTime } from "../../lib/format";

interface EventRowProps {
	event: LiveEvent;
	expanded: boolean;
	onToggle: () => void;
}

/**
 * Single row in the event feed. Click to expand → renders <EventDetail/>
 * underneath in the parent container.
 */
export function EventRow({ event, expanded, onToggle }: EventRowProps) {
	const path = event.path.replace(/^\/hook\/[a-z0-9]+/, "") || "/";
	const status = event.responseStatus;
	const statusColor = event.error
		? "text-danger"
		: status === null
			? "text-on-surface-muted"
			: status >= 500
				? "text-danger"
				: status >= 400
					? "text-warning"
					: "text-success";
	const dotColor = event.error
		? "bg-danger"
		: status === null
			? "bg-on-surface-faint animate-pulse"
			: status >= 500
				? "bg-danger"
				: status >= 400
					? "bg-warning"
					: "bg-success";

	return (
		<button
			type="button"
			onClick={onToggle}
			aria-expanded={expanded}
			aria-label={`${event.method} ${path}, ${event.error ? "errored" : (status ?? "pending")}`}
			className="w-full text-left grid grid-cols-[16px_32px_56px_minmax(0,1fr)_minmax(0,140px)_56px_72px] gap-2 items-center px-5 py-3 hover:bg-surface focus:bg-surface focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 transition-colors cursor-pointer"
		>
			<span className="text-on-surface-muted">
				{expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
			</span>

			<span className="flex justify-center">
				<span className={`w-2 h-2 rounded-full ${dotColor}`} />
			</span>

			<span className="font-mono text-[10px] font-bold text-success bg-success/10 border border-success/20 rounded px-1.5 py-0.5 text-center">
				{event.method}
			</span>

			<span className="font-mono text-[12px] text-on-surface-variant truncate" title={path}>
				{path}
			</span>

			<span
				className="font-mono text-[11px] text-on-surface-muted"
				title={absoluteTime(event.receivedAt)}
			>
				{relativeTime(event.receivedAt)}
			</span>

			<span className={`font-mono text-[12px] font-bold text-right ${statusColor}`}>
				{event.error ? "ERR" : (status ?? "…")}
			</span>

			<span className="font-mono text-[11px] text-on-surface-muted text-right">
				{event.latencyMs !== null ? `${event.latencyMs}ms` : "—"}
			</span>
		</button>
	);
}

/** Header row matching EventRow's grid for the events table. */
export function EventRowHeader() {
	return (
		<div className="grid grid-cols-[16px_32px_56px_minmax(0,1fr)_minmax(0,140px)_56px_72px] gap-2 px-5 py-2 border-b border-border-subtle bg-surface-muted text-[9px] font-bold text-on-surface-muted uppercase tracking-[0.2em]">
			<span />
			<span />
			<span>Method</span>
			<span>Path</span>
			<span>Time</span>
			<span className="text-right">Status</span>
			<span className="text-right">Latency</span>
		</div>
	);
}
