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

export function EventLog({ events, selectedEventId, onSelect }: EventLogProps) {
	if (events.length === 0) {
		return (
			<div className="text-center text-gray-500 py-8">
				<p className="text-sm">No events yet</p>
				<p className="text-xs mt-1">Webhook events will appear here in real-time</p>
			</div>
		);
	}

	return (
		<div className="overflow-auto max-h-80">
			<table className="w-full text-sm">
				<thead className="text-xs text-gray-500 border-b border-gray-700 sticky top-0 bg-gray-900">
					<tr>
						<th className="text-left py-2 px-2 font-medium">Time</th>
						<th className="text-left py-2 px-2 font-medium">Method</th>
						<th className="text-left py-2 px-2 font-medium">Service</th>
						<th className="text-left py-2 px-2 font-medium">Path</th>
						<th className="text-left py-2 px-2 font-medium">Status</th>
						<th className="text-right py-2 px-2 font-medium">Latency</th>
					</tr>
				</thead>
				<tbody>
					{events.map((event) => (
						<tr
							key={event.id}
							onClick={() => onSelect(event.id)}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") onSelect(event.id);
							}}
							className={`border-b border-gray-800 cursor-pointer transition-colors ${
								selectedEventId === event.id ? "bg-gray-800" : "hover:bg-gray-800/50"
							}`}
						>
							<td className="py-1.5 px-2 text-gray-500 font-mono text-xs">
								{formatTime(event.received_at)}
							</td>
							<td
								className={`py-1.5 px-2 font-mono font-semibold text-xs ${methodColor(event.method)}`}
							>
								{event.method}
							</td>
							<td className="py-1.5 px-2 text-gray-300 text-xs">
								{event.service_name || event.service_id.slice(0, 8)}
							</td>
							<td className="py-1.5 px-2 text-gray-400 font-mono text-xs truncate max-w-48">
								{event.path}
							</td>
							<td className={`py-1.5 px-2 font-mono text-xs ${statusColor(event.response_status)}`}>
								{event.error ? "ERR" : (event.response_status ?? "---")}
							</td>
							<td className="py-1.5 px-2 text-right text-gray-500 font-mono text-xs">
								{event.latency_ms !== null ? `${event.latency_ms}ms` : "---"}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
