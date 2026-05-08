/**
 * Single event detail page (/dashboard/events/:id).
 *
 * Shows full headers + body for both request and response, with the
 * replay chain rendered inline: the parent (if this event is itself a
 * replay), this event, and any children replayed off it. The Replay
 * action opens the existing ReplayEditor modal and posts to the
 * authenticated /api/me/events/:id/replay endpoint.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { DashboardLayout } from "../components/DashboardLayout";
import { JsonTree } from "../components/dashboard/JsonTree";
import { ReplayEditor } from "../components/dashboard/ReplayEditor";
import type { LiveEvent } from "../hooks/useBridge";
import { type MeEventDetail, me } from "../lib/me-api";

const POLL_MS = 2000;

export function EventDetail() {
	return (
		<DashboardLayout>
			<EventDetailView />
		</DashboardLayout>
	);
}

function EventDetailView() {
	const { id } = useParams<{ id: string }>();
	const navigate = useNavigate();
	const [data, setData] = useState<MeEventDetail | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [editorOpen, setEditorOpen] = useState(false);
	const [busy, setBusy] = useState(false);

	const load = useCallback(async () => {
		if (!id) return;
		try {
			const d = await me.events.get(id);
			setData(d);
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}, [id]);

	// Initial fetch + refetch on id change.
	useEffect(() => {
		setData(null);
		setError(null);
		load();
	}, [load]);

	// Light polling so a queued replay's response shows up without a manual
	// refresh. Stops after the response settles or if the chain is fully
	// resolved (no pending children).
	useEffect(() => {
		if (!data) return;
		const hasPending =
			data.event.responseStatus === null ||
			data.replays.some((r) => r.responseStatus === null && !r.error);
		if (!hasPending) return;
		const timer = setInterval(load, POLL_MS);
		return () => clearInterval(timer);
	}, [data, load]);

	if (!id) return null;

	if (error) {
		return (
			<div className="rounded-md border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">
				{error}
			</div>
		);
	}
	if (!data) {
		return <div className="text-sm text-gray-500 py-12 text-center font-mono">loading…</div>;
	}

	const { event, replays, original } = data;
	const liveEvent: LiveEvent = {
		id: event.id,
		method: event.method,
		path: event.path,
		requestHeaders: event.requestHeaders,
		requestBody: event.requestBody,
		responseStatus: event.responseStatus,
		responseBody: event.responseBody,
		latencyMs: event.latencyMs,
		error: event.error,
		receivedAt: event.receivedAt,
	};

	async function onReplaySubmit(edits: { body?: string; headers?: Record<string, string> }) {
		if (!id) return;
		setBusy(true);
		try {
			const r = await me.events.replay(id, edits);
			setEditorOpen(false);
			// Optimistic: refetch to surface the new replay row in the chain.
			await load();
			// Then jump the user to the new replay so they can watch it execute.
			navigate(`/dashboard/events/${r.replayId}`);
		} finally {
			setBusy(false);
		}
	}

	async function onCancel() {
		if (!id) return;
		if (!window.confirm("Cancel this queued replay?")) return;
		setBusy(true);
		try {
			await me.events.cancel(id);
			navigate("/dashboard/events");
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setBusy(false);
		}
	}

	const isCancelable = event.kind === "replay" && event.responseStatus === null && !event.error;

	return (
		<div className="space-y-4">
			<button
				type="button"
				onClick={() => navigate(-1)}
				className="text-xs text-gray-500 hover:text-gray-300"
			>
				← Back
			</button>

			{/* Header */}
			<div className="rounded-lg border border-gray-900 bg-gray-950 px-4 py-3 flex items-start justify-between gap-4">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2 mb-1">
						<MethodPill method={event.method} />
						<StatusPill status={event.responseStatus} error={event.error} kind={event.kind} />
					</div>
					<div className="font-mono text-sm text-gray-200 break-all">{event.path}</div>
					<div className="text-xs text-gray-500 mt-1 font-mono">
						{event.id} · channel{" "}
						<Link
							to={`/dashboard/events?channel=${event.channelId}`}
							className="text-cyan-400 hover:underline"
						>
							{event.channelId}
						</Link>
						{event.deviceId ? ` · device ${event.deviceId}` : ""} ·{" "}
						{new Date(event.receivedAt).toLocaleString()}
						{event.latencyMs !== null ? ` · ${event.latencyMs}ms` : ""}
					</div>
				</div>
				<div className="shrink-0 flex gap-2">
					{isCancelable ? (
						<button
							type="button"
							onClick={onCancel}
							disabled={busy}
							className="rounded-md border border-gray-800 hover:border-red-700 hover:bg-red-950/30 hover:text-red-300 px-3 py-1.5 text-xs text-gray-300"
						>
							Cancel
						</button>
					) : null}
					<button
						type="button"
						onClick={() => setEditorOpen(true)}
						disabled={busy}
						className="rounded-md bg-cyan-500 hover:bg-cyan-400 disabled:bg-gray-700 disabled:cursor-not-allowed text-gray-950 font-medium px-3 py-1.5 text-xs"
					>
						Replay
					</button>
				</div>
			</div>

			{/* Replay chain context */}
			{original || replays.length > 0 ? (
				<ReplayChain
					thisId={event.id}
					thisKind={event.kind}
					original={original}
					replays={replays}
				/>
			) : null}

			{/* Request */}
			<section className="rounded-lg border border-gray-900 bg-gray-950">
				<h2 className="px-4 py-2.5 text-sm font-medium text-gray-200 border-b border-gray-900">
					Request
				</h2>
				<div className="p-4 space-y-4">
					<div>
						<div className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">Headers</div>
						<JsonTree value={event.requestHeaders} />
					</div>
					<div>
						<div className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">Body</div>
						{event.requestBody ? (
							<JsonTree value={event.requestBody} />
						) : (
							<div className="text-xs text-gray-600 italic">(empty)</div>
						)}
					</div>
				</div>
			</section>

			{/* Response */}
			<section className="rounded-lg border border-gray-900 bg-gray-950">
				<h2 className="px-4 py-2.5 text-sm font-medium text-gray-200 border-b border-gray-900">
					Response
				</h2>
				<div className="p-4 space-y-4">
					{event.responseStatus === null ? (
						event.error ? (
							<div className="rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-xs text-red-300">
								{event.error}
							</div>
						) : (
							<div className="text-xs text-amber-400 font-mono">
								Pending — waiting for executor (extension or desktop) to forward this.
							</div>
						)
					) : (
						<>
							<div>
								<div className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">
									Headers
								</div>
								<JsonTree value={event.responseHeaders ?? {}} />
							</div>
							<div>
								<div className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">Body</div>
								{event.responseBody ? (
									<JsonTree value={event.responseBody} />
								) : (
									<div className="text-xs text-gray-600 italic">(empty)</div>
								)}
							</div>
						</>
					)}
				</div>
			</section>

			{editorOpen ? (
				<ReplayEditor
					event={liveEvent}
					onClose={() => setEditorOpen(false)}
					onSubmit={onReplaySubmit}
				/>
			) : null}
		</div>
	);
}

function ReplayChain({
	thisId,
	thisKind,
	original,
	replays,
}: {
	thisId: string;
	thisKind: "live" | "replay";
	original: MeEventDetail["original"];
	replays: MeEventDetail["replays"];
}) {
	return (
		<section className="rounded-lg border border-gray-900 bg-gray-950 overflow-hidden">
			<h2 className="px-4 py-2.5 text-sm font-medium text-gray-200 border-b border-gray-900">
				Replay chain
			</h2>
			<ul className="divide-y divide-gray-900">
				{original ? (
					<li className="px-4 py-2.5 text-sm flex items-center gap-3 hover:bg-gray-900/40">
						<span className="text-[10px] font-mono text-gray-500 w-12">parent</span>
						<MethodPill method={original.method} />
						<Link
							to={`/dashboard/events/${original.id}`}
							className="font-mono text-gray-300 truncate flex-1 hover:text-cyan-400"
						>
							{original.path}
						</Link>
						<span className="text-xs text-gray-500 tabular-nums">
							{formatRelative(original.receivedAt)}
						</span>
					</li>
				) : null}
				<li className="px-4 py-2.5 text-sm flex items-center gap-3 bg-gray-900/30">
					<span className="text-[10px] font-mono text-cyan-400 w-12">this</span>
					<span className="text-[10px] font-mono text-gray-500">{thisKind}</span>
					<span className="font-mono text-gray-200 truncate flex-1">{thisId}</span>
				</li>
				{replays.map((r) => (
					<li
						key={r.id}
						className="px-4 py-2.5 text-sm flex items-center gap-3 hover:bg-gray-900/40 pl-12"
					>
						<span className="text-[10px] font-mono text-gray-500 w-10">replay</span>
						<MethodPill method={r.method} />
						<Link
							to={`/dashboard/events/${r.id}`}
							className="font-mono text-gray-300 truncate flex-1 hover:text-cyan-400"
						>
							{r.path}
						</Link>
						<StatusPill status={r.responseStatus} error={r.error} kind="replay" />
						<span className="text-xs text-gray-500 tabular-nums">
							{formatRelative(r.receivedAt)}
						</span>
					</li>
				))}
			</ul>
		</section>
	);
}

function MethodPill({ method }: { method: string }) {
	const color =
		method === "GET"
			? "text-blue-400 border-blue-900/60"
			: method === "POST"
				? "text-green-400 border-green-900/60"
				: method === "DELETE"
					? "text-red-400 border-red-900/60"
					: "text-gray-400 border-gray-800";
	return (
		<span
			className={`text-[10px] font-mono uppercase border rounded px-1.5 py-0.5 inline-block w-fit ${color}`}
		>
			{method}
		</span>
	);
}

function StatusPill({
	status,
	error,
	kind,
}: {
	status: number | null;
	error?: string | null;
	kind: "live" | "replay";
}) {
	if (status === null) {
		if (error) {
			return (
				<span className="text-[10px] font-mono text-red-400 border border-red-900/60 rounded px-1.5 py-0.5">
					error
				</span>
			);
		}
		return (
			<span className="text-[10px] font-mono text-amber-400 border border-amber-900/60 rounded px-1.5 py-0.5">
				pending
			</span>
		);
	}
	const color =
		status >= 200 && status < 300
			? "text-green-400 border-green-900/60"
			: status >= 400 && status < 500
				? "text-amber-400 border-amber-900/60"
				: status >= 500
					? "text-red-400 border-red-900/60"
					: "text-gray-400 border-gray-800";
	return (
		<span className="flex items-center gap-1">
			<span className={`text-[10px] font-mono border rounded px-1.5 py-0.5 ${color}`}>
				{status}
			</span>
			{kind === "replay" ? (
				<span className="text-[10px] font-mono text-purple-400 border border-purple-900/60 rounded px-1 py-0.5">
					R
				</span>
			) : null}
		</span>
	);
}

function formatRelative(iso: string): string {
	const ms = Date.now() - Date.parse(iso);
	if (ms < 60_000) return `${Math.max(1, Math.floor(ms / 1000))}s`;
	if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
	if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
	return `${Math.floor(ms / 86_400_000)}d`;
}
