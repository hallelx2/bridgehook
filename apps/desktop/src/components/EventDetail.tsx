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

function JsonDisplay({ content }: { content: string }) {
	if (!content) {
		return <span className="text-gray-600 italic">{"(empty)"}</span>;
	}

	// Simple syntax coloring for JSON: keys in cyan, strings in green, numbers/booleans in yellow
	const colorized = content
		.replace(/("(?:[^"\\]|\\.)*")(\s*:)/g, '<span class="text-cyan-400">$1</span>$2')
		.replace(
			/:\s*("(?:[^"\\]|\\.)*")/g,
			(match, val) => `: <span class="text-green-400">${val}</span>`,
		)
		.replace(/:\s*(true|false|null)\b/g, ': <span class="text-yellow-400">$1</span>')
		.replace(/:\s*(-?\d+\.?\d*(?:[eE][+-]?\d+)?)\b/g, ': <span class="text-amber-400">$1</span>');

	return (
		<span
			// biome-ignore lint/security/noDangerouslySetInnerHtml: controlled JSON display
			dangerouslySetInnerHTML={{ __html: colorized }}
		/>
	);
}

function HeadersTable({ headers }: { headers: Record<string, string> }) {
	const entries = Object.entries(headers);
	if (entries.length === 0) return <span className="text-gray-600 text-xs italic">No headers</span>;
	return (
		<div className="text-xs space-y-1">
			{entries.map(([key, value]) => (
				<div key={key} className="flex gap-2 py-0.5">
					<span className="text-cyan-400/80 font-mono shrink-0">{key}:</span>
					<span className="text-gray-400 font-mono truncate">{value}</span>
				</div>
			))}
		</div>
	);
}

function StatusBadge({ status }: { status: number }) {
	const color =
		status < 300
			? "bg-green-500/10 text-green-400 border-green-500/20"
			: status < 400
				? "bg-yellow-500/10 text-yellow-400 border-yellow-500/20"
				: "bg-red-500/10 text-red-400 border-red-500/20";

	return (
		<span
			className={`inline-flex items-center font-mono font-bold text-sm px-2.5 py-0.5 rounded-full border ${color}`}
		>
			{status}
		</span>
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
		<div className="bg-gray-800/80 rounded-lg border border-gray-700/60 overflow-hidden">
			{/* Header bar */}
			<div className="flex items-center justify-between px-5 py-3 bg-gray-800 border-b border-gray-700/50">
				<div className="flex items-center gap-3">
					<span className="font-mono font-bold text-sm text-cyan-400 bg-cyan-500/5 px-2 py-0.5 rounded">
						{event.method}
					</span>
					<span className="font-mono text-sm text-gray-300">{event.path}</span>
					{event.response_status && <StatusBadge status={event.response_status} />}
					{event.latency_ms !== null && (
						<span className="text-gray-500 text-xs font-mono bg-gray-700/30 px-2 py-0.5 rounded">
							{event.latency_ms}ms
						</span>
					)}
				</div>
				<div className="flex items-center gap-2">
					<button
						type="button"
						onClick={handleReplay}
						disabled={replaying}
						className="px-3 py-1.5 text-xs bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 disabled:from-gray-600 disabled:to-gray-600 text-white rounded-md font-medium transition-all duration-150 shadow-sm shadow-cyan-500/10 disabled:shadow-none"
					>
						{replaying ? "Replaying..." : "Replay"}
					</button>
					<button
						type="button"
						onClick={copyAsCurl}
						className="px-3 py-1.5 text-xs bg-gray-700/60 hover:bg-gray-600/60 text-gray-300 rounded-md font-medium transition-all duration-150 border border-gray-600/40"
					>
						Copy cURL
					</button>
					<button
						type="button"
						onClick={onClose}
						className="w-7 h-7 flex items-center justify-center text-gray-500 hover:text-white hover:bg-gray-700/60 rounded-md transition-all duration-150 text-lg leading-none"
					>
						&times;
					</button>
				</div>
			</div>

			{/* Error banner */}
			{event.error && (
				<div className="mx-5 mt-4 flex items-start gap-2 bg-red-500/5 border border-red-500/10 rounded-lg px-4 py-3">
					<span className="text-red-400 text-sm shrink-0 mt-px font-bold">!</span>
					<span className="text-red-400 text-sm">{event.error}</span>
				</div>
			)}

			{/* Content */}
			<div className="grid grid-cols-2 gap-5 p-5">
				{/* Request */}
				<div>
					<div className="flex items-center gap-2 mb-3">
						<div className="w-1 h-4 rounded-full bg-cyan-500" />
						<h4 className="text-xs font-bold text-gray-300 uppercase tracking-wider">Request</h4>
					</div>
					<div className="mb-4">
						<p className="text-[11px] font-medium text-gray-500 uppercase tracking-wider mb-2">
							Headers
						</p>
						<div className="bg-gray-900/60 rounded-lg p-3 border border-gray-700/30">
							<HeadersTable headers={requestHeaders} />
						</div>
					</div>
					<div>
						<p className="text-[11px] font-medium text-gray-500 uppercase tracking-wider mb-2">
							Body
						</p>
						<pre className="bg-gray-900/60 rounded-lg p-3 text-xs font-mono overflow-auto max-h-48 whitespace-pre-wrap border border-gray-700/30 leading-relaxed">
							<JsonDisplay content={tryPrettyJson(event.request_body)} />
						</pre>
					</div>
				</div>

				{/* Response */}
				<div>
					<div className="flex items-center gap-2 mb-3">
						<div className="w-1 h-4 rounded-full bg-green-500" />
						<h4 className="text-xs font-bold text-gray-300 uppercase tracking-wider">Response</h4>
					</div>
					<div className="mb-4">
						<p className="text-[11px] font-medium text-gray-500 uppercase tracking-wider mb-2">
							Headers
						</p>
						<div className="bg-gray-900/60 rounded-lg p-3 border border-gray-700/30">
							<HeadersTable headers={responseHeaders} />
						</div>
					</div>
					<div>
						<p className="text-[11px] font-medium text-gray-500 uppercase tracking-wider mb-2">
							Body
						</p>
						<pre className="bg-gray-900/60 rounded-lg p-3 text-xs font-mono overflow-auto max-h-48 whitespace-pre-wrap border border-gray-700/30 leading-relaxed">
							<JsonDisplay content={tryPrettyJson(event.response_body)} />
						</pre>
					</div>
				</div>
			</div>

			{/* Replay result */}
			{replayResult && (
				<div className="mx-5 mb-5 border-t border-gray-700/50 pt-5">
					<div className="flex items-center gap-2 mb-3">
						<div className="w-1 h-4 rounded-full bg-purple-500" />
						<h4 className="text-xs font-bold text-gray-300 uppercase tracking-wider">
							Replay Result
						</h4>
					</div>
					<div className="flex items-center gap-3 mb-3">
						<StatusBadge status={replayResult.status} />
						<span className="text-gray-500 text-xs font-mono bg-gray-700/30 px-2 py-0.5 rounded">
							{replayResult.latency_ms}ms
						</span>
					</div>
					<pre className="bg-gray-900/60 rounded-lg p-3 text-xs font-mono overflow-auto max-h-32 whitespace-pre-wrap border border-gray-700/30 leading-relaxed">
						<JsonDisplay content={tryPrettyJson(replayResult.body)} />
					</pre>
				</div>
			)}
		</div>
	);
}
