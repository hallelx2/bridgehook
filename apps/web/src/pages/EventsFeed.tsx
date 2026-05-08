/**
 * Cross-channel unified event feed. Filters live in the URL query string
 * so views are shareable and back-button friendly. Cursor-paginated.
 *
 * Real-time: subscribes to the relay's per-user SSE stream (UserDO). Each
 * webhook / response / claim event triggers a debounced refetch of the
 * first page, which keeps the on-screen data filter-aware without merging
 * stream payload shapes into MeEvent rows. Polling stays as a fallback
 * when the stream fails (self-host, transient network drop, etc.).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { DashboardLayout } from "../components/DashboardLayout";
import {
	type EventsFeedFilters,
	type MeChannel,
	type MeDevice,
	type MeEvent,
	me,
	streamMeEvents,
} from "../lib/me-api";

const POLL_MS = 3000;
const STREAM_REFETCH_DEBOUNCE_MS = 250;
const PAGE_SIZE = 50;

export function EventsFeed() {
	return (
		<DashboardLayout>
			<EventsView />
		</DashboardLayout>
	);
}

function EventsView() {
	const [params, setParams] = useSearchParams();
	const [channels, setChannels] = useState<MeChannel[]>([]);
	const [devices, setDevices] = useState<MeDevice[]>([]);
	const [events, setEvents] = useState<MeEvent[]>([]);
	const [nextCursor, setNextCursor] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [loadingMore, setLoadingMore] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const filtersRef = useRef<EventsFeedFilters>({});

	// Pull channel/device options for the pickers (one-time on mount).
	useEffect(() => {
		let alive = true;
		Promise.all([me.channels.list(), me.devices.list()])
			.then(([c, d]) => {
				if (!alive) return;
				setChannels(c.channels);
				setDevices(d.devices);
			})
			.catch(() => {
				/* options aren't critical — fail silently */
			});
		return () => {
			alive = false;
		};
	}, []);

	// Build filters from URL.
	const filters = useMemo<EventsFeedFilters>(() => {
		const f: EventsFeedFilters = { limit: PAGE_SIZE };
		const channel = params.get("channel");
		if (channel) f.channel = channel.split(",").filter(Boolean);
		const device = params.get("device");
		if (device) f.device = device.split(",").filter(Boolean);
		const method = params.get("method");
		if (method) f.method = method.split(",").filter(Boolean);
		const status = params.get("status");
		if (status) f.status = status as EventsFeedFilters["status"];
		const q = params.get("q");
		if (q) f.q = q;
		return f;
	}, [params]);

	// Fetch the first page whenever filters change.
	useEffect(() => {
		filtersRef.current = filters;
		let alive = true;
		setLoading(true);
		setError(null);
		me.events
			.feed(filters)
			.then((page) => {
				if (!alive) return;
				setEvents(page.events);
				setNextCursor(page.nextCursor);
				setLoading(false);
			})
			.catch((err) => {
				if (alive) {
					setError(err instanceof Error ? err.message : String(err));
					setLoading(false);
				}
			});
		return () => {
			alive = false;
		};
	}, [filters]);

	// Real-time: SSE primary, polling fallback. The two coexist — even if
	// the stream is fine, polling at a slow cadence covers blackouts the
	// browser hasn't noticed yet (e.g. the laptop slept, EventSource hasn't
	// fired `error` yet but events have piled up).
	useEffect(() => {
		const refetch = async () => {
			try {
				const page = await me.events.feed({ ...filtersRef.current, limit: PAGE_SIZE });
				setEvents((prev) => {
					if (page.events.length === 0) return prev;
					if (prev.length === 0) return page.events;
					const seen = new Set(prev.map((e) => e.id));
					const fresh = page.events.filter((e) => !seen.has(e.id));
					if (fresh.length === 0) {
						// Update existing rows with any new response data without
						// re-ordering — covers `response` stream events.
						const byId = new Map(page.events.map((e) => [e.id, e]));
						return prev.map((e) => byId.get(e.id) ?? e);
					}
					return [...fresh, ...prev].slice(0, 1000);
				});
			} catch {
				/* keep showing stale data on transient errors */
			}
		};

		// Debounce: bursts of stream events collapse to one refetch.
		let debounceHandle: ReturnType<typeof setTimeout> | null = null;
		const scheduleRefetch = () => {
			if (debounceHandle) return;
			debounceHandle = setTimeout(() => {
				debounceHandle = null;
				refetch();
			}, STREAM_REFETCH_DEBOUNCE_MS);
		};

		const stream = streamMeEvents(
			(e) => {
				if (e.type === "webhook" || e.type === "response" || e.type === "claimed") {
					scheduleRefetch();
				}
			},
			() => {
				/* error fires repeatedly during reconnect; polling below covers it */
			},
		);

		const pollId = setInterval(refetch, POLL_MS);

		return () => {
			stream.close();
			clearInterval(pollId);
			if (debounceHandle) clearTimeout(debounceHandle);
		};
	}, []);

	const loadMore = useCallback(async () => {
		if (!nextCursor || loadingMore) return;
		setLoadingMore(true);
		try {
			const page = await me.events.feed({ ...filtersRef.current, cursor: nextCursor });
			setEvents((prev) => [...prev, ...page.events]);
			setNextCursor(page.nextCursor);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoadingMore(false);
		}
	}, [nextCursor, loadingMore]);

	function setParam(key: string, value: string | null) {
		const next = new URLSearchParams(params);
		if (value === null || value === "") next.delete(key);
		else next.set(key, value);
		setParams(next, { replace: true });
	}

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<h1 className="text-xl font-semibold">Events</h1>
				<div className="text-xs text-gray-500 font-mono">
					{events.length}
					{nextCursor ? "+" : ""} shown
				</div>
			</div>

			{/* Filters */}
			<div className="rounded-lg border border-gray-900 bg-gray-950 px-3 py-3 flex flex-wrap items-center gap-2">
				<input
					type="search"
					placeholder="Search path…"
					value={params.get("q") ?? ""}
					onChange={(e) => setParam("q", e.target.value)}
					className="bg-gray-900 border border-gray-800 rounded-md px-2.5 py-1 text-xs placeholder-gray-600 focus:outline-none focus:border-cyan-500 w-48"
				/>
				<Picker
					label="Channel"
					options={channels.map((c) => ({ value: c.id, label: c.label || c.id }))}
					value={params.get("channel")}
					onChange={(v) => setParam("channel", v)}
				/>
				<Picker
					label="Device"
					options={devices.map((d) => ({ value: d.id, label: d.label }))}
					value={params.get("device")}
					onChange={(v) => setParam("device", v)}
				/>
				<Picker
					label="Status"
					options={[
						{ value: "2xx", label: "2xx" },
						{ value: "4xx", label: "4xx" },
						{ value: "5xx", label: "5xx" },
						{ value: "error", label: "error" },
						{ value: "pending", label: "pending" },
						{ value: "live", label: "live only" },
						{ value: "replay", label: "replay only" },
					]}
					value={params.get("status")}
					onChange={(v) => setParam("status", v)}
					singleValue
				/>
				<Picker
					label="Method"
					options={[
						{ value: "GET", label: "GET" },
						{ value: "POST", label: "POST" },
						{ value: "PUT", label: "PUT" },
						{ value: "PATCH", label: "PATCH" },
						{ value: "DELETE", label: "DELETE" },
					]}
					value={params.get("method")}
					onChange={(v) => setParam("method", v)}
				/>
				{(params.get("channel") ||
					params.get("device") ||
					params.get("status") ||
					params.get("method") ||
					params.get("q")) && (
					<button
						type="button"
						onClick={() => setParams({}, { replace: true })}
						className="text-xs text-gray-400 hover:text-gray-200 ml-auto"
					>
						Clear filters
					</button>
				)}
			</div>

			{/* Table */}
			<div className="rounded-lg border border-gray-900 bg-gray-950 overflow-hidden">
				<div className="grid grid-cols-[64px_72px_minmax(0,1fr)_120px_72px_88px] gap-2 px-4 py-2 border-b border-gray-900 text-[10px] uppercase tracking-wider text-gray-500">
					<div>Method</div>
					<div>Status</div>
					<div>Path</div>
					<div>Channel</div>
					<div>Device</div>
					<div className="text-right">Time</div>
				</div>
				{loading ? (
					<div className="px-4 py-12 text-sm text-gray-500 font-mono text-center">loading…</div>
				) : error ? (
					<div className="px-4 py-3 text-sm text-red-300">{error}</div>
				) : events.length === 0 ? (
					<div className="px-4 py-12 text-sm text-gray-500 text-center">
						No events match these filters.
					</div>
				) : (
					<ul>
						{events.map((e) => {
							const channel = channels.find((c) => c.id === e.channelId);
							const device = devices.find((d) => d.id === e.deviceId);
							return (
								<li
									key={e.id}
									className="grid grid-cols-[64px_72px_minmax(0,1fr)_120px_72px_88px] gap-2 px-4 py-2 border-b border-gray-900 hover:bg-gray-900/40 text-sm items-center"
								>
									<MethodPill method={e.method} />
									<StatusPill status={e.responseStatus} kind={e.kind} />
									<Link
										to={`/dashboard/events/${e.id}`}
										className="font-mono text-gray-200 truncate hover:text-cyan-400"
										title={e.path}
									>
										{e.path}
									</Link>
									<span className="text-xs text-gray-400 truncate font-mono">
										{channel?.label || e.channelId.slice(0, 12)}
									</span>
									<span className="text-xs text-gray-500 truncate">
										{device?.label?.split(" ")[0] || (e.deviceId ? "—" : "—")}
									</span>
									<span className="text-xs text-gray-500 tabular-nums text-right">
										{formatRelative(e.receivedAt)}
									</span>
								</li>
							);
						})}
					</ul>
				)}
				{nextCursor ? (
					<div className="px-4 py-3 text-center">
						<button
							type="button"
							onClick={loadMore}
							disabled={loadingMore}
							className="text-xs text-cyan-400 hover:underline disabled:text-gray-600"
						>
							{loadingMore ? "Loading…" : "Load more"}
						</button>
					</div>
				) : null}
			</div>
		</div>
	);
}

function Picker({
	label,
	options,
	value,
	onChange,
	singleValue = false,
}: {
	label: string;
	options: Array<{ value: string; label: string }>;
	value: string | null;
	onChange: (next: string | null) => void;
	singleValue?: boolean;
}) {
	void singleValue;
	return (
		<select
			value={value ?? ""}
			onChange={(e) => onChange(e.target.value || null)}
			className="bg-gray-900 border border-gray-800 rounded-md px-2.5 py-1 text-xs text-gray-300 focus:outline-none focus:border-cyan-500"
		>
			<option value="">{label}: any</option>
			{options.map((o) => (
				<option key={o.value} value={o.value}>
					{label}: {o.label}
				</option>
			))}
		</select>
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
	kind,
}: {
	status: number | null;
	kind: "live" | "replay";
}) {
	if (status === null) {
		return (
			<span className="text-[10px] font-mono text-amber-400 border border-amber-900/60 rounded px-1.5 py-0.5 inline-block w-fit">
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
		<div className="flex items-center gap-1">
			<span className={`text-[10px] font-mono border rounded px-1.5 py-0.5 ${color}`}>
				{status}
			</span>
			{kind === "replay" ? (
				<span className="text-[10px] font-mono text-purple-400 border border-purple-900/60 rounded px-1 py-0.5">
					R
				</span>
			) : null}
		</div>
	);
}

function formatRelative(iso: string): string {
	const ms = Date.now() - Date.parse(iso);
	if (ms < 60_000) return `${Math.max(1, Math.floor(ms / 1000))}s`;
	if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`;
	if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
	return `${Math.floor(ms / 86_400_000)}d`;
}
