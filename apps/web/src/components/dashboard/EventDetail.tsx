import { Check, Pencil, RefreshCw, Terminal } from "lucide-react";
import { useEffect, useState } from "react";
import type { LiveEvent } from "../../hooks/useBridge";
import { toCurl } from "../../lib/curl";
import { absoluteTime } from "../../lib/format";
import { RELAY_URL } from "../../lib/relay";
import { JsonTree } from "./JsonTree";
import { SignatureBadge } from "./SignatureBadge";

interface EventDetailProps {
	event: LiveEvent;
	secrets: Record<string, string>;
	onReplay: () => Promise<void>;
	onEdit: () => void;
	onConfigureSecret: (providerId: string) => void;
}

/**
 * Expanded detail panel for a single event.
 * Shows: action bar (replay, edit-replay, copy as cURL), signature badge,
 * timing strip, request headers (json tree), request body (json tree),
 * response status + body.
 */
export function EventDetail({
	event,
	secrets,
	onReplay,
	onEdit,
	onConfigureSecret,
}: EventDetailProps) {
	const [replaying, setReplaying] = useState(false);
	const [copied, setCopied] = useState<"curl" | null>(null);

	useEffect(() => {
		if (!copied) return;
		const t = setTimeout(() => setCopied(null), 2000);
		return () => clearTimeout(t);
	}, [copied]);

	const handleReplay = async () => {
		setReplaying(true);
		try {
			await onReplay();
		} finally {
			// small delay so the spinner is visible even on fast networks
			setTimeout(() => setReplaying(false), 400);
		}
	};

	const handleCopyCurl = () => {
		const cmd = toCurl(event, RELAY_URL);
		navigator.clipboard.writeText(cmd).then(() => setCopied("curl"));
	};

	return (
		<div className="px-5 py-4 bg-surface-muted border-y border-border-subtle space-y-4">
			{/* Action bar */}
			<div className="flex items-center gap-2 flex-wrap">
				<button
					type="button"
					onClick={handleReplay}
					disabled={replaying}
					className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-background font-bold rounded-md text-[11px] uppercase tracking-wider hover:bg-primary-dim transition-colors disabled:opacity-60"
				>
					<RefreshCw size={12} strokeWidth={2.25} className={replaying ? "animate-spin" : ""} />
					{replaying ? "Replaying" : "Replay"}
				</button>

				<button
					type="button"
					onClick={onEdit}
					className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface border border-border text-on-surface font-semibold rounded-md text-[11px] uppercase tracking-wider hover:bg-surface-2 transition-colors"
				>
					<Pencil size={12} strokeWidth={2.25} />
					Edit & replay
				</button>

				<button
					type="button"
					onClick={handleCopyCurl}
					className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold uppercase tracking-wider border transition-colors ${
						copied === "curl"
							? "bg-success/15 text-success border-success/25"
							: "bg-surface border-border text-on-surface hover:bg-surface-2"
					}`}
				>
					{copied === "curl" ? (
						<Check size={12} strokeWidth={2.5} />
					) : (
						<Terminal size={12} strokeWidth={2.25} />
					)}
					{copied === "curl" ? "Copied" : "Copy cURL"}
				</button>

				<div className="ml-auto">
					<SignatureBadge
						headers={event.requestHeaders}
						body={event.requestBody}
						secrets={secrets}
						onConfigureSecret={onConfigureSecret}
					/>
				</div>
			</div>

			{/* Metadata strip */}
			<div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px]">
				<MetaCell label="Received" value={absoluteTime(event.receivedAt)} mono />
				<MetaCell
					label="Status"
					value={event.error ? "ERROR" : (event.responseStatus?.toString() ?? "Pending")}
					tone={event.error || (event.responseStatus ?? 0) >= 400 ? "danger" : "success"}
				/>
				<MetaCell
					label="Latency"
					value={event.latencyMs !== null ? `${event.latencyMs}ms` : "—"}
					mono
				/>
				<MetaCell label="Event ID" value={event.id} mono truncate />
			</div>

			{/* Headers */}
			<Section label="Request headers">
				<JsonTree value={event.requestHeaders} collapseAfter={0} />
			</Section>

			{/* Body */}
			{event.requestBody && (
				<Section label="Request body">
					<JsonTree value={event.requestBody} collapseAfter={2} />
				</Section>
			)}

			{/* Response */}
			{event.responseBody && (
				<Section label="Response body">
					<JsonTree value={event.responseBody} collapseAfter={1} />
				</Section>
			)}

			{event.error && (
				<Section label="Error" tone="danger">
					<pre className="font-mono text-[11.5px] text-danger bg-danger/5 border border-danger/15 rounded-md p-3 overflow-x-auto whitespace-pre-wrap">
						{event.error}
					</pre>
				</Section>
			)}
		</div>
	);
}

function MetaCell({
	label,
	value,
	mono,
	truncate,
	tone,
}: {
	label: string;
	value: string;
	mono?: boolean;
	truncate?: boolean;
	tone?: "danger" | "success";
}) {
	const valueClass =
		tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : "text-on-surface";
	return (
		<div>
			<div className="text-[9px] font-bold text-on-surface-muted uppercase tracking-[0.25em] mb-1">
				{label}
			</div>
			<div
				className={`${valueClass} font-bold ${mono ? "font-mono" : ""} ${
					truncate ? "truncate" : ""
				}`}
				title={truncate ? value : undefined}
			>
				{value}
			</div>
		</div>
	);
}

function Section({
	label,
	children,
	tone,
}: {
	label: string;
	children: React.ReactNode;
	tone?: "danger";
}) {
	return (
		<div>
			<div
				className={`text-[9px] font-bold uppercase tracking-[0.25em] mb-2 ${
					tone === "danger" ? "text-danger" : "text-on-surface-muted"
				}`}
			>
				{label}
			</div>
			{children}
		</div>
	);
}

/** Inline copy-cURL helper exposed for command palette consumers. */
export function copyCurlForEvent(event: LiveEvent): string {
	return toCurl(event, RELAY_URL);
}
