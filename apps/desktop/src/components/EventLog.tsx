import type { WebhookEventPayload } from "../hooks/useEvents";

interface EventLogProps {
	events: WebhookEventPayload[];
	selectedEventId: string | null;
	onSelect: (eventId: string) => void;
}

function formatTime(isoString: string): string {
	try {
		const date = new Date(isoString);
		return date.toLocaleTimeString("en-US", { hour12: false });
	} catch {
		return isoString;
	}
}

function statusColor(status: number | null): string {
	if (status === null) return "text-red-400";
	if (status < 300) return "text-green-400";
	if (status < 400) return "text-yellow-400";
	return "text-red-400";
}

function statusBadgeClasses(status: number | null, hasError: boolean): string {
	if (hasError) return "bg-red-500/10 text-red-400 border border-red-500/20";
	if (status === null) return "bg-gray-500/10 text-gray-400 border border-gray-500/20";
	if (status < 300) return "bg-green-500/10 text-green-400 border border-green-500/20";
	if (status < 400) return "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20";
	return "bg-red-500/10 text-red-400 border border-red-500/20";
}

function methodColor(method: string): string {
	switch (method.toUpperCase()) {
		case "POST":
			return "text-cyan-400";
		case "PUT":
			return "text-yellow-400";
		case "PATCH":
			return "text-orange-400";
		case "DELETE":
			return "text-red-400";
		default:
			return "text-gray-400";
	}
}

function methodBgColor(method: string): string {
	switch (method.toUpperCase()) {
		case "POST":
			return "bg-cyan-500/5";
		case "PUT":
			return "bg-yellow-500/5";
		case "PATCH":
			return "bg-orange-500/5";
		case "DELETE":
			return "bg-red-500/5";
		default:
			return "bg-gray-500/5";
	}
}

export function EventLog({ events, selectedEventId, onSelect }: EventLogProps) {
	if (events.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center text-center py-16 px-6">
				<div className="w-12 h-12 rounded-xl bg-gray-800/80 border border-gray-700/50 flex items-center justify-center mb-4">
					<svg
						width="20"
						height="20"
						viewBox="0 0 20 20"
						fill="none"
						xmlns="http://www.w3.org/2000/svg"
					>
						<path
							d="M10 2L18 6v8l-8 4-8-4V6l8-4z"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinejoin="round"
							className="text-gray-600"
						/>
						<path
							d="M10 10v8M10 10l8-4M10 10L2 6"
							stroke="currentColor"
							strokeWidth="1.5"
							strokeLinejoin="round"
							className="text-gray-700"
						/>
					</svg>
				</div>
				<p className="text-sm font-medium text-gray-400 mb-1">No events yet</p>
				<p className="text-xs text-gray-600 max-w-[240px] leading-relaxed">
					Webhook events will appear here in real-time as they arrive at your endpoints
				</p>
			</div>
		);
	}

	return (
		<div className="overflow-auto max-h-80">
			<table className="w-full text-sm">
				<thead className="text-[11px] text-gray-500 border-b border-gray-700/80 sticky top-0 bg-gray-900 z-10">
					<tr>
						<th className="text-left py-2.5 px-3 font-semibold uppercase tracking-wider">Time</th>
						<th className="text-left py-2.5 px-3 font-semibold uppercase tracking-wider">Method</th>
						<th className="text-left py-2.5 px-3 font-semibold uppercase tracking-wider">
							Service
						</th>
						<th className="text-left py-2.5 px-3 font-semibold uppercase tracking-wider">Path</th>
						<th className="text-left py-2.5 px-3 font-semibold uppercase tracking-wider">Status</th>
						<th className="text-right py-2.5 px-3 font-semibold uppercase tracking-wider">
							Latency
						</th>
					</tr>
				</thead>
				<tbody>
					{events.map((event, index) => (
						<tr
							key={event.id}
							onClick={() => onSelect(event.id)}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") onSelect(event.id);
							}}
							className={`border-b border-gray-800/50 cursor-pointer transition-all duration-100 ${
								selectedEventId === event.id
									? "bg-cyan-500/5 border-l-2 border-l-cyan-500"
									: index % 2 === 0
										? "bg-transparent hover:bg-gray-800/40"
										: "bg-gray-800/20 hover:bg-gray-800/40"
							}`}
						>
							<td className="py-2 px-3 text-gray-500 font-mono text-xs">
								{formatTime(event.received_at)}
							</td>
							<td className="py-2 px-3">
								<span
									className={`font-mono font-semibold text-xs px-1.5 py-0.5 rounded ${methodColor(event.method)} ${methodBgColor(event.method)}`}
								>
									{event.method}
								</span>
							</td>
							<td className="py-2 px-3 text-gray-300 text-xs font-medium">
								{event.service_name || event.service_id.slice(0, 8)}
							</td>
							<td className="py-2 px-3 text-gray-400 font-mono text-xs truncate max-w-48">
								{event.path}
							</td>
							<td className="py-2 px-3">
								<span
									className={`inline-flex items-center font-mono text-[11px] font-semibold px-2 py-0.5 rounded-full ${statusBadgeClasses(event.response_status, !!event.error)}`}
								>
									{event.error ? "ERR" : (event.response_status ?? "---")}
								</span>
							</td>
							<td className="py-2 px-3 text-right text-gray-500 font-mono text-xs">
								{event.latency_ms !== null ? `${event.latency_ms}ms` : "---"}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
