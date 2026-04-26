import { useEffect, useState } from "react";
import type { LiveEvent } from "../../hooks/useBridge";

/**
 * Always-on observability strip rendered above the FilterBar.
 *
 * Four primary metric tiles (throughput, p50, p95, error rate) plus a
 * full-width status distribution bar.  Every chart is CSS-only — no chart
 * library, no canvas — so the bundle stays small and the look stays
 * consistent with the rest of the dense, terminal-leaning UI.
 *
 * The component re-derives all stats from the events array on every render
 * and keeps a 5s tick so time-windowed metrics (throughput sparkline) don't
 * go stale when no new events arrive.
 */
interface StatsPanelProps {
	events: LiveEvent[];
}

const SPARKLINE_BUCKETS = 24;
const SPARKLINE_WINDOW_MS = 60_000; // last 60 seconds

export function StatsPanel({ events }: StatsPanelProps) {
	// 5s tick so time-relative numbers refresh even with an idle stream.
	const [, setTick] = useState(0);
	useEffect(() => {
		const id = setInterval(() => setTick((n) => n + 1), 5_000);
		return () => clearInterval(id);
	}, []);

	const stats = computeStats(events);

	return (
		<div className="border-b border-border-subtle bg-surface-muted">
			{/* ── Metric tiles ─────────────────────────────────────────── */}
			<div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-border-subtle border-b border-border-subtle">
				<MetricTile
					label="Throughput"
					value={stats.totalEvents.toString()}
					unit={stats.totalEvents === 1 ? "event" : "events"}
					detail={
						stats.recentRate > 0
							? `${stats.recentRate.toFixed(1)}/min`
							: stats.totalEvents > 0
								? "idle"
								: "—"
					}
					chart={<Sparkline buckets={stats.throughputBuckets} />}
				/>
				<MetricTile
					label="P50 latency"
					value={stats.p50 !== null ? stats.p50.toString() : "—"}
					unit={stats.p50 !== null ? "ms" : ""}
					detail={
						stats.completedCount > 0
							? `${stats.completedCount} sample${stats.completedCount === 1 ? "" : "s"}`
							: "no responses yet"
					}
					tone={tonForLatency(stats.p50, 100, 250)}
				/>
				<MetricTile
					label="P95 latency"
					value={stats.p95 !== null ? stats.p95.toString() : "—"}
					unit={stats.p95 !== null ? "ms" : ""}
					detail={stats.p99 !== null ? `p99  ${stats.p99}ms` : "—"}
					tone={tonForLatency(stats.p95, 250, 750)}
				/>
				<MetricTile
					label="Error rate"
					value={
						stats.totalEvents === 0
							? "—"
							: `${(stats.errorRate * 100).toFixed(stats.errorRate < 0.1 ? 1 : 0)}`
					}
					unit={stats.totalEvents === 0 ? "" : "%"}
					detail={`${stats.errorCount} of ${stats.totalEvents}`}
					tone={
						stats.errorRate >= 0.1
							? "danger"
							: stats.errorRate >= 0.02
								? "warning"
								: stats.totalEvents > 0
									? "success"
									: "neutral"
					}
				/>
			</div>

			{/* ── Status distribution stacked bar ──────────────────────── */}
			<DistributionBar
				success={stats.successCount}
				clientErr={stats.clientErrorCount}
				serverErr={stats.serverErrorCount}
				errored={stats.erroredCount}
				pending={stats.pendingCount}
				total={stats.totalEvents}
			/>
		</div>
	);
}

// ────────────────────────────────────────────────────────────────────────────
// Subcomponents
// ────────────────────────────────────────────────────────────────────────────

type Tone = "neutral" | "success" | "warning" | "danger";

function MetricTile({
	label,
	value,
	unit,
	detail,
	chart,
	tone = "neutral",
}: {
	label: string;
	value: string;
	unit: string;
	detail?: string;
	chart?: React.ReactNode;
	tone?: Tone;
}) {
	const valueClass =
		tone === "danger"
			? "text-danger"
			: tone === "warning"
				? "text-warning"
				: tone === "success"
					? "text-success"
					: "text-on-surface";

	return (
		<div className="px-5 py-3 flex flex-col gap-1.5 min-w-0">
			<div className="flex items-center justify-between gap-3">
				<span className="text-[9px] font-bold text-on-surface-muted uppercase tracking-[0.25em] truncate">
					{label}
				</span>
				{chart}
			</div>
			<div className="flex items-baseline gap-1.5">
				<span className={`font-mono font-extrabold text-2xl tracking-[-0.02em] ${valueClass}`}>
					{value}
				</span>
				{unit && (
					<span className="text-[11px] font-bold text-on-surface-muted tracking-wide">{unit}</span>
				)}
			</div>
			{detail && (
				<span className="text-[10px] font-mono text-on-surface-muted truncate" title={detail}>
					{detail}
				</span>
			)}
		</div>
	);
}

/**
 * CSS-only inline sparkline. Renders one ~3px bar per bucket. Empty buckets
 * still render at minimum height so the row stays visually anchored.
 */
function Sparkline({ buckets }: { buckets: number[] }) {
	const max = Math.max(1, ...buckets);
	return (
		<div
			className="flex items-end h-4 gap-[1px]"
			aria-hidden="true"
			title={`Last ${buckets.length * (SPARKLINE_WINDOW_MS / SPARKLINE_BUCKETS / 1000)}s`}
		>
			{buckets.map((v, i) => {
				const ratio = v / max;
				const heightPct = v === 0 ? 8 : Math.max(15, ratio * 100);
				return (
					<span
						key={`bar-${i}`}
						style={{ height: `${heightPct}%` }}
						className={`w-[3px] rounded-[1px] ${v === 0 ? "bg-border-strong" : "bg-primary"}`}
					/>
				);
			})}
		</div>
	);
}

/** Full-width horizontal stacked bar showing event status distribution. */
function DistributionBar({
	success,
	clientErr,
	serverErr,
	errored,
	pending,
	total,
}: {
	success: number;
	clientErr: number;
	serverErr: number;
	errored: number;
	pending: number;
	total: number;
}) {
	if (total === 0) {
		return (
			<div className="px-5 py-2 flex items-center gap-3">
				<span className="text-[9px] font-bold text-on-surface-muted uppercase tracking-[0.25em]">
					Status distribution
				</span>
				<div className="flex-1 h-1.5 bg-border-subtle rounded-full" />
				<span className="text-[10px] font-mono text-on-surface-muted">no events yet</span>
			</div>
		);
	}

	const pct = (n: number) => (n / total) * 100;
	const segments: { width: number; color: string; label: string; count: number }[] = [
		{ width: pct(success), color: "bg-success", label: "2xx", count: success },
		{ width: pct(clientErr), color: "bg-warning", label: "4xx", count: clientErr },
		{ width: pct(serverErr), color: "bg-danger", label: "5xx", count: serverErr },
		{
			width: pct(errored),
			color: "bg-danger/60",
			label: "errored",
			count: errored,
		},
		{
			width: pct(pending),
			color: "bg-on-surface-faint",
			label: "pending",
			count: pending,
		},
	].filter((s) => s.width > 0);

	return (
		<div className="px-5 py-2.5 flex items-center gap-3">
			<span className="text-[9px] font-bold text-on-surface-muted uppercase tracking-[0.25em] shrink-0">
				Status
			</span>
			<div className="flex-1 h-1.5 bg-background border border-border-subtle rounded-full overflow-hidden flex">
				{segments.map((s) => (
					<div
						key={s.label}
						className={s.color}
						style={{ width: `${s.width}%` }}
						title={`${s.label}: ${s.count} (${s.width.toFixed(1)}%)`}
					/>
				))}
			</div>
			<div className="flex items-center gap-3 text-[10px] font-mono shrink-0">
				{success > 0 && <LegendChip dot="bg-success" label={`${success} ok`} />}
				{clientErr > 0 && <LegendChip dot="bg-warning" label={`${clientErr} 4xx`} />}
				{serverErr > 0 && <LegendChip dot="bg-danger" label={`${serverErr} 5xx`} />}
				{errored > 0 && <LegendChip dot="bg-danger/60" label={`${errored} err`} />}
				{pending > 0 && <LegendChip dot="bg-on-surface-faint" label={`${pending} pend`} />}
			</div>
		</div>
	);
}

function LegendChip({ dot, label }: { dot: string; label: string }) {
	return (
		<span className="inline-flex items-center gap-1.5 text-on-surface-muted">
			<span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
			<span>{label}</span>
		</span>
	);
}

// ────────────────────────────────────────────────────────────────────────────
// Stats computation
// ────────────────────────────────────────────────────────────────────────────

interface ComputedStats {
	totalEvents: number;
	successCount: number;
	clientErrorCount: number;
	serverErrorCount: number;
	erroredCount: number;
	pendingCount: number;
	completedCount: number;
	errorCount: number;
	errorRate: number;
	p50: number | null;
	p95: number | null;
	p99: number | null;
	throughputBuckets: number[];
	recentRate: number;
}

function computeStats(events: LiveEvent[]): ComputedStats {
	const total = events.length;
	let success = 0;
	let clientErr = 0;
	let serverErr = 0;
	let errored = 0;
	let pending = 0;
	const latencies: number[] = [];

	for (const e of events) {
		if (e.error) {
			errored++;
			continue;
		}
		const s = e.responseStatus;
		if (s === null) {
			pending++;
			continue;
		}
		if (s >= 500) serverErr++;
		else if (s >= 400) clientErr++;
		else if (s >= 200) success++;
		// 1xx / 3xx fall through silently — rare for webhooks

		if (e.latencyMs !== null && Number.isFinite(e.latencyMs)) {
			latencies.push(e.latencyMs);
		}
	}

	const errorCount = clientErr + serverErr + errored;
	const completedCount = success + clientErr + serverErr;

	return {
		totalEvents: total,
		successCount: success,
		clientErrorCount: clientErr,
		serverErrorCount: serverErr,
		erroredCount: errored,
		pendingCount: pending,
		completedCount,
		errorCount,
		errorRate: total === 0 ? 0 : errorCount / total,
		p50: percentile(latencies, 0.5),
		p95: percentile(latencies, 0.95),
		p99: percentile(latencies, 0.99),
		throughputBuckets: bucketThroughput(events),
		recentRate: recentRatePerMinute(events),
	};
}

function percentile(values: number[], p: number): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const idx = Math.min(Math.floor((sorted.length - 1) * p), sorted.length - 1);
	return Math.round(sorted[idx]);
}

/** Bucket events by `SPARKLINE_BUCKETS` time slots over the last `SPARKLINE_WINDOW_MS`. */
function bucketThroughput(events: LiveEvent[]): number[] {
	const now = Date.now();
	const bucketMs = SPARKLINE_WINDOW_MS / SPARKLINE_BUCKETS;
	const start = now - SPARKLINE_WINDOW_MS;
	const buckets = new Array<number>(SPARKLINE_BUCKETS).fill(0);

	for (const e of events) {
		const t = new Date(e.receivedAt).getTime();
		if (Number.isNaN(t)) continue;
		if (t < start || t > now) continue;
		const idx = Math.min(Math.floor((t - start) / bucketMs), SPARKLINE_BUCKETS - 1);
		buckets[idx]++;
	}
	return buckets;
}

/** Events received in the last 60s, scaled to per-minute. */
function recentRatePerMinute(events: LiveEvent[]): number {
	const now = Date.now();
	const start = now - SPARKLINE_WINDOW_MS;
	let count = 0;
	for (const e of events) {
		const t = new Date(e.receivedAt).getTime();
		if (Number.isNaN(t)) continue;
		if (t >= start && t <= now) count++;
	}
	// Window IS one minute, so count IS per-minute.
	return count;
}

function tonForLatency(value: number | null, warnAt: number, dangerAt: number): Tone {
	if (value === null) return "neutral";
	if (value >= dangerAt) return "danger";
	if (value >= warnAt) return "warning";
	return "success";
}
