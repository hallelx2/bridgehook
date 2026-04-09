import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import type { ReplayResult, WebhookEventPayload } from "../hooks/useEvents";

interface EventDetailProps {
	event: WebhookEventPayload;
	onClose: () => void;
}

function tryPrettyJson(str: string | null | undefined): string {
	if (!str) return "";
	try {
		return JSON.stringify(JSON.parse(str), null, 2);
	} catch {
		return str;
	}
}

function HeadersTable({ headers }: { headers: Record<string, string> }) {
	const entries = Object.entries(headers);
	if (entries.length === 0) return <span className="text-gray-500 text-xs">No headers</span>;
	return (
		<div className="text-xs space-y-0.5">
			{entries.map(([key, value]) => (
				<div key={key} className="flex gap-2">
					<span className="text-cyan-400 font-mono shrink-0">{key}:</span>
					<span className="text-gray-300 font-mono truncate">{value}</span>
				</div>
			))}
		</div>
	);
}

export function EventDetail({ event, onClose }: EventDetailProps) {
	const [replayResult, setReplayResult] = useState<ReplayResult | null>(null);
	const [replaying, setReplaying] = useState(false);

	const requestHeaders =
		typeof event.request_headers === "string"
			? JSON.parse(event.request_headers || "{}")
			: event.request_headers;

	const responseHeaders = event.response_body
		? (() => {
				try {
					// For now, response headers aren't in the payload — show status only
					return {};
				} catch {
					return {};
				}
			})()
		: {};

	const handleReplay = async () => {
		setReplaying(true);
		try {
			const result = await invoke<ReplayResult>("replay_event", {
				eventId: event.id,
			});
			setReplayResult(result);
		} catch (err) {
			console.error("Replay failed:", err);
		} finally {
			setReplaying(false);
		}
	};

	const copyAsCurl = () => {
		const headers = Object.entries(requestHeaders)
			.map(([k, v]) => `-H '${k}: ${v}'`)
			.join(" \\\n  ");
		const bodyFlag = event.request_body ? `-d '${event.request_body.replace(/'/g, "'\\''")}'` : "";
		const curl = `curl -X ${event.method} \\\n  ${headers} \\\n  ${bodyFlag} \\\n  'http://localhost:???${event.path}'`;
		navigator.clipboard.writeText(curl);
	};

	return (
		<div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
			<div className="flex items-center justify-between mb-4">
				<div className="flex items-center gap-3">
					<span className="font-mono font-bold text-cyan-400">{event.method}</span>
					<span className="font-mono text-gray-300">{event.path}</span>
					{event.response_status && (
						<span
							className={`font-mono font-bold ${
								event.response_status < 300
									? "text-green-400"
									: event.response_status < 400
										? "text-yellow-400"
										: "text-red-400"
							}`}
						>
							{event.response_status}
						</span>
					)}
					{event.latency_ms !== null && (
						<span className="text-gray-500 text-xs">{event.latency_ms}ms</span>
					)}
				</div>
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={handleReplay}
						disabled={replaying}
						className="px-3 py-1 text-xs bg-cyan-600 hover:bg-cyan-700 disabled:bg-gray-600 text-white rounded transition-colors"
					>
						{replaying ? "Replaying..." : "Replay"}
					</button>
					<button
						type="button"
						onClick={copyAsCurl}
						className="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
					>
						Copy cURL
					</button>
					<button
						type="button"
						onClick={onClose}
						className="text-gray-500 hover:text-white transition-colors text-lg leading-none"
					>
						&times;
					</button>
				</div>
			</div>

			{event.error && (
				<div className="bg-red-900/30 text-red-400 rounded p-2 text-sm mb-4">{event.error}</div>
			)}

			<div className="grid grid-cols-2 gap-4">
				{/* Request */}
				<div>
					<h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">Request</h4>
					<div className="mb-3">
						<p className="text-xs text-gray-500 mb-1">Headers</p>
						<HeadersTable headers={requestHeaders} />
					</div>
					<div>
						<p className="text-xs text-gray-500 mb-1">Body</p>
						<pre className="bg-gray-900 rounded p-2 text-xs text-gray-300 font-mono overflow-auto max-h-48 whitespace-pre-wrap">
							{tryPrettyJson(event.request_body) || "(empty)"}
						</pre>
					</div>
				</div>

				{/* Response */}
				<div>
					<h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">Response</h4>
					<div className="mb-3">
						<p className="text-xs text-gray-500 mb-1">Headers</p>
						<HeadersTable headers={responseHeaders} />
					</div>
					<div>
						<p className="text-xs text-gray-500 mb-1">Body</p>
						<pre className="bg-gray-900 rounded p-2 text-xs text-gray-300 font-mono overflow-auto max-h-48 whitespace-pre-wrap">
							{tryPrettyJson(event.response_body) || "(empty)"}
						</pre>
					</div>
				</div>
			</div>

			{/* Replay result */}
			{replayResult && (
				<div className="mt-4 border-t border-gray-700 pt-4">
					<h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">Replay Result</h4>
					<div className="flex items-center gap-3 mb-2">
						<span
							className={`font-mono font-bold ${
								replayResult.status < 300
									? "text-green-400"
									: replayResult.status < 400
										? "text-yellow-400"
										: "text-red-400"
							}`}
						>
							{replayResult.status}
						</span>
						<span className="text-gray-500 text-xs">{replayResult.latency_ms}ms</span>
					</div>
					<pre className="bg-gray-900 rounded p-2 text-xs text-gray-300 font-mono overflow-auto max-h-32 whitespace-pre-wrap">
						{tryPrettyJson(replayResult.body) || "(empty)"}
					</pre>
				</div>
			)}
		</div>
	);
}
